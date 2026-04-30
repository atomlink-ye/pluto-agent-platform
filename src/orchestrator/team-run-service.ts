import { randomUUID } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import type {
  AgentEvent,
  AgentEventType,
  AgentRoleConfig,
  BlockerReasonV0,
  FinalArtifact,
  ProvenancePinRef,
  RetryEventPayloadV0,
  TeamConfig,
  TeamRunResult,
  TeamTask,
  WorkerContribution,
  WorkerContributionProvenancePins,
} from "../contracts/types.js";
import type { PaseoTeamAdapter } from "../contracts/adapter.js";
import {
  selectEligibleRuntime,
  type RuntimeRegistry,
  type RuntimeSelectionResultV0,
} from "../runtime/index.js";
import { getRole, getRoleCatalogSelection, type RoleCatalogSelection } from "./team-config.js";
import { RunStore, sanitizeEventForPersistence } from "./run-store.js";
import { classifyBlocker, isRetryable } from "./blocker-classifier.js";
import { generateEvidencePacket, redactSecrets, writeEvidence } from "./evidence.js";
import { CallbackNormalizer } from "../runtime/callback-normalizer.js";
import {
  buildPortableRuntimeResultRefV0,
  readPortableRuntimeResultValueRefs,
  type PortableRuntimeResultAnyRefV0,
} from "../runtime/result-contract.js";
import { ObservabilityStore } from "../observability/observability-store.js";
import {
  DEFAULT_BUDGET_SNAPSHOT_MAX_AGE_MS,
  evaluateBudgetGateV0,
  recordBudgetDecisionV0,
} from "../observability/budgets.js";
import type { BudgetSnapshotV0, BudgetV0, UsageMeterV0 } from "../contracts/observability.js";

export interface TeamRunServiceOptions {
  adapter: PaseoTeamAdapter;
  team: TeamConfig;
  runtimeRegistry?: RuntimeRegistry;
  store?: RunStore;
  /** Hard ceiling on the whole run. Defaults to 10 minutes. */
  timeoutMs?: number;
  /** Pump interval when no events were returned. */
  pumpIntervalMs?: number;
  /** ID generator override (tests). */
  idGen?: () => string;
  /** Clock override (tests). */
  clock?: () => Date;
  /**
   * Grace period before the orchestrator deterministically dispatches worker
   * roles that a stochastic live lead forgot to request. Set low in tests.
   */
  underdispatchFallbackMs?: number;
  /** Per-worker retry count for retryable blocker reasons. 0–3, default 1. */
  maxRetries?: number;
  observabilityStore?: ObservabilityStore;
  budgetSnapshotMaxAgeMs?: number;
}

const MAX_RETRIES_HARD_CAP = 3;

export class TeamRunService {
  private readonly adapter: PaseoTeamAdapter;
  private readonly team: TeamConfig;
  private readonly store: RunStore;
  private readonly runtimeRegistry?: RuntimeRegistry;
  private readonly timeoutMs: number;
  private readonly pumpIntervalMs: number;
  private readonly underdispatchFallbackMs: number;
  private readonly idGen: () => string;
  private readonly clock: () => Date;
  private readonly maxRetries: number;
  private readonly observabilityStore: ObservabilityStore;
  private readonly budgetSnapshotMaxAgeMs: number;

  constructor(opts: TeamRunServiceOptions) {
    this.adapter = opts.adapter;
    this.team = opts.team;
    this.runtimeRegistry = opts.runtimeRegistry;
    this.store = opts.store ?? new RunStore();
    this.timeoutMs = opts.timeoutMs ?? 10 * 60 * 1000;
    this.pumpIntervalMs = opts.pumpIntervalMs ?? 25;
    this.underdispatchFallbackMs = opts.underdispatchFallbackMs ?? 15_000;
    this.idGen = opts.idGen ?? (() => randomUUID());
    this.clock = opts.clock ?? (() => new Date());
    this.maxRetries = Math.min(
      Math.max(opts.maxRetries ?? 1, 0),
      MAX_RETRIES_HARD_CAP,
    );
    this.observabilityStore = opts.observabilityStore ?? new ObservabilityStore({ dataDir: this.store.dataDirPath() });
    this.budgetSnapshotMaxAgeMs = opts.budgetSnapshotMaxAgeMs ?? DEFAULT_BUDGET_SNAPSHOT_MAX_AGE_MS;
  }

  async run(task: TeamTask): Promise<TeamRunResult> {
    if (task.minWorkers < 2) {
      throw new Error(
        `team_task_min_workers_too_low: MVP requires >=2 workers, got ${task.minWorkers}`,
      );
    }
    const runId = this.idGen();
    const collected: AgentEvent[] = [];
    const workersDispatched = new Set<string>();
    const contributions: WorkerContribution[] = [];
    const workerAttempts = new Map<string, number>();
    const workerSelectionsBySession = new Map<string, RoleCatalogSelection>();
    const startedAt = this.clock();
    const callbackNormalizer = new CallbackNormalizer();
    const runtimeResultRefs: PortableRuntimeResultAnyRefV0[] = [];
    let adapter = this.adapter;

    const emit = async (
      type: AgentEventType,
      payload: Record<string, unknown> = {},
    ): Promise<AgentEvent> => {
      const rawEvent: AgentEvent = {
        id: this.idGen(),
        runId,
        ts: this.clock().toISOString(),
        type,
        payload,
      };
      this.captureRuntimeResultRef(rawEvent, runtimeResultRefs);
      const ev = sanitizeEventForPersistence(rawEvent);
      collected.push(ev);
      await this.store.appendEvent(ev);
      return ev;
    };

    const recordAdapterEvent = async (ev: AgentEvent) => {
      this.captureRuntimeResultRef(ev, runtimeResultRefs);
      const roleId = ev.roleId ?? (typeof ev.payload?.["targetRole"] === "string" ? ev.payload["targetRole"] as AgentEvent["roleId"] : undefined);
      const stampedAttempt = typeof ev.payload?.["attempt"] === "number"
        ? ev.payload["attempt"]
        : undefined;
      const attempt = stampedAttempt ?? (roleId ? (workerAttempts.get(roleId) ?? 1) : 1);
      const catalogSelection = this.resolveCatalogSelection(ev, workerSelectionsBySession);
      const eventToRecord = sanitizeEventForPersistence(
        (ev.type === "worker_started" || ev.type === "worker_completed")
          ? {
              ...ev,
              payload: {
                ...ev.payload,
                attempt,
                ...(catalogSelection ? { catalogSelection } : {}),
              },
            }
          : ev,
      );
      collected.push(eventToRecord);
      await this.store.appendEvent(eventToRecord);
    };

    await this.store.ensure(runId);
    await emit("run_started", { taskId: task.id, title: task.title, teamId: this.team.id, prompt: task.prompt });

    let blockerReason: BlockerReasonV0 | null = null;

    try {
      const runtimeSelection = this.selectRuntime(task);
      if (runtimeSelection && !runtimeSelection.ok) {
        blockerReason = runtimeSelection.blocker.reason;
        await emit("blocker", {
          reason: runtimeSelection.blocker.reason,
          classifierVersion: runtimeSelection.blocker.classifierVersion,
          message: runtimeSelection.blocker.message,
          providerProfileId: runtimeSelection.blocker.providerProfileId,
          runtimeIds: runtimeSelection.blocker.runtimeIds,
          mismatchFields: runtimeSelection.blocker.mismatchFields,
        });
        await emit("run_failed", { message: runtimeSelection.blocker.message });

        const finishedAt = this.clock();
        const result: TeamRunResult = {
          runId,
          status: "failed",
          events: collected,
          runtimeResultRefs,
          blockerReason,
          failure: { message: runtimeSelection.blocker.message },
        };

        const evidenceFailure = await this.writeEvidencePacket(
          task,
          result,
          collected,
          startedAt,
          finishedAt,
          blockerReason,
        );
        if (!evidenceFailure) {
          return result;
        }

        blockerReason = evidenceFailure.reason;
        await emit("blocker", {
          reason: evidenceFailure.reason,
          classifierVersion: evidenceFailure.classifierVersion,
          message: evidenceFailure.message,
        });
        await emit("run_failed", { message: evidenceFailure.message });
        return {
          ...result,
          blockerReason,
          failure: { message: evidenceFailure.message, cause: evidenceFailure.cause },
        };
      }

      if (runtimeSelection?.ok) {
        adapter = await runtimeSelection.candidate.adapter.factory.create();
      }

      const budgetFailure = await this.enforceBudgetGate(runId, task, emit);
      if (budgetFailure) {
        blockerReason = "quota_exceeded";
        await emit("blocker", {
          reason: blockerReason,
          classifierVersion: 0,
          message: budgetFailure.message,
          budgetBehavior: budgetFailure.behavior,
          budgetDecisionIds: budgetFailure.decisionIds,
          localApproximation: true,
        });
        await emit("run_failed", {
          message: budgetFailure.message,
          budgetBehavior: budgetFailure.behavior,
          budgetDecisionIds: budgetFailure.decisionIds,
        });

        const finishedAt = this.clock();
        const result: TeamRunResult = {
          runId,
          status: "failed",
          events: collected,
          runtimeResultRefs,
          blockerReason,
          failure: { message: budgetFailure.message },
        };

        const evidenceFailure = await this.writeEvidencePacket(
          task,
          result,
          collected,
          startedAt,
          finishedAt,
          blockerReason,
        );
        if (!evidenceFailure) {
          return result;
        }

        blockerReason = evidenceFailure.reason;
        await emit("blocker", {
          reason: evidenceFailure.reason,
          classifierVersion: evidenceFailure.classifierVersion,
          message: evidenceFailure.message,
        });
        await emit("run_failed", { message: evidenceFailure.message });
        return {
          ...result,
          blockerReason,
          failure: { message: evidenceFailure.message, cause: evidenceFailure.cause },
        };
      }

      await adapter.startRun({ runId, task, team: this.team });
      const leadRole = getRole(this.team, this.team.leadRoleId);
      const lead = await adapter.createLeadSession({
        runId,
        task,
        role: leadRole,
      });

      const expectedWorkerRoles = this.team.roles.filter((r) => r.kind === "worker");
      const expectedWorkers = expectedWorkerRoles.length;
      const requiredCompletions = Math.max(task.minWorkers, expectedWorkers);

      let summarized = false;
      let leadSummaryMd: string | undefined;
      let validationFailureMessage: string | null = null;
      const loopStartedAt = Date.now();
      let lastProgressAt = loopStartedAt;
      let fallbackTriggered = false;

      const maybeDispatchUnderdispatchFallback = async () => {
        if (fallbackTriggered || summarized) return;
        if (contributions.length >= requiredCompletions) return;
        if (Date.now() - lastProgressAt < this.underdispatchFallbackMs) return;

        const alreadyHandled = new Set([
          ...Array.from(workersDispatched.values()),
          ...contributions.map((c) => c.roleId),
        ]);
        const missingRoles = expectedWorkerRoles.filter((r) => !alreadyHandled.has(r.id));
        if (missingRoles.length === 0) return;

        fallbackTriggered = true;
        await emit("orchestrator_underdispatch_fallback", {
          missingRoles: missingRoles.map((r) => r.id),
          dispatchedRoles: Array.from(workersDispatched.values()),
          completedRoles: contributions.map((c) => c.roleId),
          reason: "lead_underdispatched_required_workers",
        });

        for (const role of missingRoles) {
          workersDispatched.add(role.id);
          await this.dispatchWorkerWithRetry(
            runId, task, role, [
              `Fallback assignment for ${role.name}.`,
              `Task: ${task.title}`,
              `Goal: ${task.prompt}`,
              "Return a concise contribution for the final artifact.",
            ].join("\n"),
            contributions, workerAttempts, workerSelectionsBySession, emit, recordAdapterEvent, adapter,
          );
        }
        lastProgressAt = Date.now();
      };

      while (true) {
        if (Date.now() - loopStartedAt > this.timeoutMs) {
          throw new Error("team_run_timeout");
        }
        const batch = callbackNormalizer.normalize(await adapter.readEvents({ runId }));
        if (batch.length === 0) {
          await maybeDispatchUnderdispatchFallback();
          if (leadSummaryMd !== undefined) break;
          await delay(this.pumpIntervalMs);
          continue;
        }
        lastProgressAt = Date.now();

        for (const ev of batch) {
          await recordAdapterEvent(ev);

          if (ev.type === "worker_requested") {
            const targetRole = String(
              ev.payload?.["targetRole"] ?? ev.roleId ?? "",
            );
            if (!targetRole || workersDispatched.has(targetRole)) continue;
            const role = getRole(this.team, targetRole);
            const instructions = String(
              this.readEventPayloadValue(ev, "instructions") ?? `Work on: ${task.prompt}`,
            );
            workersDispatched.add(targetRole);
            await this.dispatchWorkerWithRetry(
              runId, task, role, instructions,
              contributions, workerAttempts, workerSelectionsBySession, emit, recordAdapterEvent, adapter,
            );
          } else if (ev.type === "worker_completed") {
            const roleId = String(ev.roleId ?? ev.payload?.["targetRole"] ?? "");
            const sessionId = String(ev.sessionId ?? "");
            const output = String(this.readEventPayloadValue(ev, "output") ?? "");
            const selection = this.resolveCatalogSelection(ev, workerSelectionsBySession);
            contributions.push({
              roleId: roleId as WorkerContribution["roleId"],
              sessionId,
              output,
              ...this.toContributionProvenancePins(selection),
            });
            if (roleId === "evaluator" && output.trimStart().startsWith("FAIL:")) {
              validationFailureMessage = output.trim();
            }
          } else if (ev.type === "lead_message") {
            const kind = String(ev.payload?.["kind"] ?? "");
            if (kind === "summary") {
              leadSummaryMd = String(this.readEventPayloadValue(ev, "markdown") ?? "");
            }
          }
        }

        await maybeDispatchUnderdispatchFallback();

        if (
          !summarized &&
          contributions.length >= requiredCompletions
        ) {
          summarized = true;
          await adapter.sendMessage({
            runId,
            sessionId: lead.sessionId,
            message: this.buildSummaryRequest(task, contributions),
          });
        }
      }

      if (contributions.length < requiredCompletions) {
        throw new Error(
          `team_run_underdispatched: required=${requiredCompletions} got=${contributions.length}`,
        );
      }
      if (!leadSummaryMd) {
        throw new Error("team_run_missing_summary");
      }

      if (validationFailureMessage) {
        const classification = classifyBlocker({
          errorMessage: validationFailureMessage,
          source: "evaluator",
        });
        blockerReason = classification.reason;
        await emit("blocker", {
          reason: classification.reason,
          classifierVersion: classification.classifierVersion,
          sourceRole: "evaluator",
          message: classification.message,
        });
      }

      const artifact: FinalArtifact = {
        runId,
        markdown: leadSummaryMd,
        leadSummary: this.firstNonEmptyLine(leadSummaryMd),
        contributions,
      };

      if (artifact.markdown.trim().length === 0) {
        const classification = classifyBlocker({
          errorMessage: "empty_artifact: run completed but artifact.md is empty / whitespace-only",
          source: "artifact_check",
        });
        blockerReason = classification.reason;
        await emit("blocker", {
          reason: classification.reason,
          classifierVersion: classification.classifierVersion,
          message: classification.message,
        });
      }

      const artifactPath = await this.store.writeArtifact(artifact);
      await emit("artifact_created", {
        path: artifactPath,
        bytes: artifact.markdown.length,
      });

      const finishedAt = this.clock();
      let result: TeamRunResult = blockerReason
        ? { runId, status: "failed", artifact, events: collected, runtimeResultRefs, blockerReason, failure: { message: `Blocker: ${blockerReason}` } }
        : { runId, status: "completed", artifact, events: collected, runtimeResultRefs, blockerReason: null };

      const evidenceFailure = await this.writeEvidencePacket(task, result, collected, startedAt, finishedAt, blockerReason);
      if (evidenceFailure) {
        blockerReason = evidenceFailure.reason;
        await emit("blocker", {
          reason: evidenceFailure.reason,
          classifierVersion: evidenceFailure.classifierVersion,
          message: evidenceFailure.message,
        });
        await emit("run_failed", { message: evidenceFailure.message });
        result = {
          runId,
          status: "failed",
          artifact,
          events: collected,
          runtimeResultRefs,
          blockerReason,
          failure: { message: evidenceFailure.message, cause: evidenceFailure.cause },
        };
      } else if (blockerReason) {
        await emit("run_failed", { message: `Blocker: ${blockerReason}` });
      } else {
        await emit("run_completed", {
          workerCount: contributions.length,
          roles: contributions.map((c) => c.roleId),
        });
      }

      return result;
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : String(cause);
      const classification = classifyBlocker({ errorMessage: message, source: "orchestrator" });
      blockerReason = classification.reason;

      await emit("blocker" as AgentEventType, {
        reason: classification.reason,
        classifierVersion: classification.classifierVersion,
        message: classification.message,
      });
      await emit("run_failed", { message });

      const finishedAt = this.clock();
      const result: TeamRunResult = {
        runId,
        status: "failed",
        events: collected,
        runtimeResultRefs,
        failure: { message, cause },
        blockerReason,
      };

      const evidenceFailure = await this.writeEvidencePacket(
        task,
        result,
        collected,
        startedAt,
        finishedAt,
        blockerReason,
      );
      if (!evidenceFailure) {
        return result;
      }

      blockerReason = evidenceFailure.reason;
      await emit("blocker" as AgentEventType, {
        reason: evidenceFailure.reason,
        classifierVersion: evidenceFailure.classifierVersion,
        message: evidenceFailure.message,
      });
      await emit("run_failed", { message: evidenceFailure.message });
      return {
        ...result,
        blockerReason,
        failure: { message: evidenceFailure.message, cause: evidenceFailure.cause },
      };
    } finally {
      await adapter.endRun({ runId }).catch(() => {});
    }
  }

  private async dispatchWorkerWithRetry(
    runId: string,
    task: TeamTask,
    role: AgentRoleConfig,
    instructions: string,
    contributions: WorkerContribution[],
    workerAttempts: Map<string, number>,
    workerSelectionsBySession: Map<string, RoleCatalogSelection>,
    emit: (type: AgentEventType, payload?: Record<string, unknown>) => Promise<AgentEvent>,
    _recordAdapterEvent: (ev: AgentEvent) => Promise<void>,
    adapter: PaseoTeamAdapter,
  ): Promise<void> {
    const currentAttempt = (workerAttempts.get(role.id) ?? 0) + 1;
    workerAttempts.set(role.id, currentAttempt);

    try {
      const session = await adapter.createWorkerSession({ runId, role, instructions });
      const selection = getRoleCatalogSelection(this.team, role.id);
      if (selection) {
        workerSelectionsBySession.set(session.sessionId, selection);
      }
    } catch (workerError) {
      const errMsg = workerError instanceof Error ? workerError.message : String(workerError);
      const classification = classifyBlocker({ errorMessage: errMsg, source: "adapter" });

      if (isRetryable(classification.reason) && currentAttempt <= this.maxRetries) {
        const delayMs = Math.min(1000 * currentAttempt, 5000);
        const blockerEvent = await emit("blocker", {
          reason: classification.reason,
          classifierVersion: classification.classifierVersion,
          sourceRole: role.id,
          message: classification.message,
          attempt: currentAttempt,
        });
        const retryPayload: RetryEventPayloadV0 = {
          attempt: currentAttempt + 1,
          reason: classification.reason,
          originalEventId: blockerEvent.id,
          delayMs,
          roleId: role.id,
        };
        await emit("retry", {
          ...retryPayload,
        });

        await delay(Math.min(delayMs, 100));

        workerAttempts.set(role.id, currentAttempt);
        return this.dispatchWorkerWithRetry(
          runId, task, role, instructions,
          contributions, workerAttempts, workerSelectionsBySession, emit, _recordAdapterEvent, adapter,
        );
      }

      throw workerError;
    }
  }

  private async writeEvidencePacket(
    task: TeamTask,
    result: TeamRunResult,
    events: AgentEvent[],
    startedAt: Date,
    finishedAt: Date,
    blockerReason: BlockerReasonV0 | null,
  ): Promise<{
    reason: BlockerReasonV0;
    classifierVersion: 0;
    message: string;
    cause: unknown;
  } | null> {
    try {
      const packet = generateEvidencePacket({
        task,
        result,
        events,
        startedAt,
        finishedAt,
        blockerReason,
        runtimeResultRefs: result.runtimeResultRefs,
      });
      await writeEvidence(this.store.runDir(result.runId), packet);
      return null;
    } catch (cause) {
      const message = redactSecrets(
        cause instanceof Error ? cause.message : String(cause),
      );
      return {
        reason: "runtime_error",
        classifierVersion: 0,
        message,
        cause,
      };
    }
  }

  private buildSummaryRequest(task: TeamTask, contributions: WorkerContribution[]): string {
    const lines = contributions.map(
      (c) => `- ${c.roleId}: ${c.output.slice(0, 280)}`,
    );
    return [
      `All ${contributions.length} workers have reported.`,
      "Synthesize the final artifact in markdown.",
      "Include each role's contribution clearly.",
      "Begin with a single-line summary.",
      "Keyword: SUMMARIZE.",
      "",
      `Task: ${task.title}`,
      `Goal: ${task.prompt}`,
      "",
      "Contributions:",
      ...lines,
    ].join("\n");
  }

  private firstNonEmptyLine(md: string): string {
    for (const raw of md.split(/\r?\n/)) {
      const line = raw.trim();
      if (line.length === 0) continue;
      if (line.startsWith("#")) return line.replace(/^#+\s*/, "");
      return line;
    }
    return "";
  }

  private readEventPayloadValue(ev: AgentEvent, key: string): unknown {
    return ev.transient?.rawPayload?.[key] ?? ev.payload?.[key];
  }

  private resolveCatalogSelection(
    ev: AgentEvent,
    workerSelectionsBySession: Map<string, RoleCatalogSelection>,
  ): RoleCatalogSelection | null {
    if (ev.sessionId) {
      return workerSelectionsBySession.get(ev.sessionId) ?? null;
    }
    if (ev.roleId) {
      return getRoleCatalogSelection(this.team, ev.roleId) ?? null;
    }
    return null;
  }

  private toContributionProvenancePins(
    selection: RoleCatalogSelection | null,
  ): WorkerContributionProvenancePins {
    if (!selection) {
      return {};
    }

    return {
      workerRoleRef: this.cloneRef(selection.workerRole),
      skillRef: this.cloneRef(selection.skill),
      ...(selection.template ? { templateRef: this.cloneRef(selection.template) } : {}),
      ...(selection.policyPack ? { policyPackRefs: [this.cloneRef(selection.policyPack)] } : {}),
      catalogEntryRef: this.cloneRef(selection.entry),
    };
  }

  private cloneRef(ref: ProvenancePinRef): ProvenancePinRef {
    return { id: ref.id, version: ref.version };
  }

  private captureRuntimeResultRef(
    event: AgentEvent,
    runtimeResultRefs: PortableRuntimeResultAnyRefV0[],
  ): void {
    const ref = buildPortableRuntimeResultRefV0(event);
    if (ref && !runtimeResultRefs.some((existing) => existing.kind === ref.kind && existing.callback.eventId === ref.callback.eventId)) {
      runtimeResultRefs.push(ref);
    }

    for (const valueRef of readPortableRuntimeResultValueRefs(event)) {
      if (runtimeResultRefs.some((existing) => existing.kind === "value" && existing.eventId === valueRef.eventId && existing.valueKey === valueRef.valueKey)) {
        continue;
      }
      runtimeResultRefs.push(valueRef);
    }
  }

  private selectRuntime(task: TeamTask): RuntimeSelectionResultV0 | null {
    if (!task.runtimeRequirements && !task.providerProfileId) {
      return null;
    }
    if (!this.runtimeRegistry) {
      return {
        ok: false,
        blocker: {
          reason: "runtime_error" as const,
          classifierVersion: 0 as const,
          message: "runtime_selector_unconfigured",
        },
      };
    }

    return selectEligibleRuntime(this.runtimeRegistry, {
      requirements: task.runtimeRequirements,
      providerProfileId: task.providerProfileId,
    });
  }

  private async enforceBudgetGate(
    runId: string,
    task: TeamTask,
    _emit: (type: AgentEventType, payload?: Record<string, unknown>) => Promise<AgentEvent>,
  ): Promise<{ behavior: "block" | "require_override"; message: string; decisionIds: string[] } | null> {
    const workspaceId = task.workspacePath;
    const records = await this.observabilityStore.query({
      workspaceId,
      kind: ["budget", "budget_snapshot", "usage_meter"],
    });
    const budgets = records.filter((record): record is BudgetV0 => record.kind === "budget");
    if (budgets.length === 0) {
      return null;
    }

    const evaluation = evaluateBudgetGateV0({
      scopeRef: { kind: "workspace", id: workspaceId },
      subjectRef: { kind: "team_run", id: runId },
      budgets,
      snapshots: records.filter((record): record is BudgetSnapshotV0 => record.kind === "budget_snapshot"),
      usageMeters: records.filter((record): record is UsageMeterV0 => record.kind === "usage_meter"),
      now: this.clock(),
      snapshotMaxAgeMs: this.budgetSnapshotMaxAgeMs,
    });

    const decisionIds: string[] = [];
    for (const decision of evaluation.decisions) {
      const effectiveDecision = task.budgetOverride && decision.behavior === "require_override"
        ? {
            ...decision,
            overrideRequired: false,
            reason: `${decision.reason} Governed override applied: ${task.budgetOverride.reason}`,
          }
        : decision;
      const record = await recordBudgetDecisionV0({
        store: this.observabilityStore,
        workspaceId,
        correlationId: runId,
        decision: effectiveDecision,
        actorId: task.budgetOverride?.actorId,
        principalId: task.budgetOverride?.principalId ?? "pluto.orchestrator",
        runId,
        runAttempt: 1,
        idGen: this.idGen,
        clock: this.clock,
      });
      decisionIds.push(record.id);
    }

    if (evaluation.behavior === "block") {
      return {
        behavior: evaluation.behavior,
        message: evaluation.reason,
        decisionIds,
      };
    }

    if (evaluation.behavior === "require_override") {
      if (task.budgetOverride) {
        return null;
      }

      return {
        behavior: evaluation.behavior,
        message: evaluation.reason,
        decisionIds,
      };
    }

    return null;
  }
}
