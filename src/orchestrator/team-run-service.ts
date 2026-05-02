import { randomUUID } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import type {
  AgentEvent,
  AgentEventType,
  AgentRoleConfig,
  BlockerReasonV0,
  FinalArtifact,
  OrchestrationMode,
  ProvenancePinRef,
  RetryEventPayloadV0,
  StageDependencyTrace,
  TeamConfig,
  TeamPlaybookV0,
  TeamRunPlaybookMetadataV0,
  TeamRunResult,
  TeamTask,
  WorkerContribution,
  WorkerContributionProvenancePins,
  WorkerRequestedPayload,
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
import { createDefaultCoordinationTranscript } from "./coordination-transcript.js";
import { selectTeamPlaybook } from "./team-playbook.js";

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
    const orchestrationMode: OrchestrationMode = task.orchestrationMode ?? "teamlead_direct";
    let selectedPlaybook: TeamPlaybookV0;
    try {
      selectedPlaybook = selectTeamPlaybook(this.team, task.playbookId);
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : String(cause);
      return {
        runId,
        status: "failed",
        events: collected,
        runtimeResultRefs,
        blockerReason: "validation_failed",
        failure: { message, cause },
      };
    }
    const playbookMetadata: TeamRunPlaybookMetadataV0 = {
      id: selectedPlaybook.id,
      title: selectedPlaybook.title,
      schemaVersion: selectedPlaybook.schemaVersion,
      orchestrationSource: selectedPlaybook.orchestrationSource,
    };

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
    const transcript = createDefaultCoordinationTranscript({
      runId,
      runDir: this.store.runDir(runId),
    });
    const primaryStageForRole = (roleId: string) =>
      selectedPlaybook.stages.find((stage) => stage.roleId === roleId);
    await emit("run_started", {
      taskId: task.id,
      title: task.title,
      teamId: this.team.id,
      prompt: task.prompt,
      playbook: playbookMetadata,
      playbookId: selectedPlaybook.id,
      playbookTitle: selectedPlaybook.title,
      orchestrationMode,
      orchestrationSource: selectedPlaybook.orchestrationSource,
      legacyMarkerDispatch: "fallback_only",
      transcript: transcript.ref,
    });
    await transcript.append({
      runId,
      ts: this.clock().toISOString(),
      source: "pluto",
      type: "run_metadata",
      message: "Coordination transcript started for the run.",
      payload: {
        runId,
        taskId: task.id,
        playbookId: selectedPlaybook.id,
        orchestrationMode,
        transcript: transcript.ref,
      },
    });
    await emit("coordination_transcript_created", {
      playbookId: selectedPlaybook.id,
      orchestrationMode,
      orchestrationSource: selectedPlaybook.orchestrationSource,
      transcript: transcript.ref,
    });

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
          transcript.ref,
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
          transcript.ref,
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

      await adapter.startRun({ runId, task, team: this.team, playbook: selectedPlaybook, transcript: transcript.ref });
      const leadRole = getRole(this.team, this.team.leadRoleId);
      const lead = await adapter.createLeadSession({
        runId,
        task,
        role: leadRole,
        playbook: selectedPlaybook,
        transcript: transcript.ref,
      });

      await transcript.append({
        runId,
        ts: this.clock().toISOString(),
        source: "pluto",
        type: "teamlead_started",
        message: "TeamLead session created with selected playbook and transcript details.",
        payload: { sessionId: lead.sessionId, playbookId: selectedPlaybook.id, transcript: transcript.ref },
      });

      const expectedWorkerRoles = selectedPlaybook.stages.map((stage) => getRole(this.team, stage.roleId));
      const expectedWorkers = expectedWorkerRoles.length;
      const requiredCompletions = Math.max(task.minWorkers, expectedWorkers);

      let leadSummaryMd: string | undefined;
      let validationFailureMessage: string | null = null;
      let dependencyTrace: StageDependencyTrace[] = [];
      let revisions: Array<{ stageId: string; attempt: number; evaluatorVerdict: string; escalated?: boolean }> = [];
      let escalation: { stageId: string; attempts: number; lastVerdict: string } | undefined;
      let finalReconciliation = {
        citations: [] as Array<{ stageId: string; present: boolean; snippet?: string }>,
        valid: true,
      };

      if (orchestrationMode === "teamlead_direct") {
        const directResult = await this.runTeamleadDirectFlow({
          runId,
          task,
          leadSessionId: lead.sessionId,
          adapter,
          playbook: selectedPlaybook,
          transcript,
          contributions,
          workerSelectionsBySession,
          recordAdapterEvent,
          emit,
          callbackNormalizer,
        });
        leadSummaryMd = directResult.leadSummaryMd;
        validationFailureMessage = directResult.validationFailureMessage;
        dependencyTrace = directResult.dependencyTrace;
        revisions = directResult.revisions;
        escalation = directResult.escalation;
        finalReconciliation = directResult.finalReconciliation;
      } else {
        let summarized = false;
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
            const stage = primaryStageForRole(role.id);
            const instructions = [
              `Fallback assignment for ${role.name}.`,
              `Task: ${task.title}`,
              `Goal: ${task.prompt}`,
              "Return a concise contribution for the final artifact.",
            ].join("\n");
            const payload: WorkerRequestedPayload = {
              targetRole: role.id,
              instructions,
              orchestratorSource: "pluto_fallback",
              ...(stage ? { playbookStageId: stage.id, dependsOn: stage.dependsOn } : {}),
              source: "pluto_fallback",
            };
            await emit("worker_requested", payload);
            await transcript.append({
              runId,
              ts: this.clock().toISOString(),
              source: "pluto",
              type: "stage_request",
              message: `Pluto fallback requested ${role.id} for playbook ${selectedPlaybook.id}.`,
              payload: {
                playbookId: selectedPlaybook.id,
                stageId: stage?.id ?? null,
                roleId: role.id,
                dependsOn: stage?.dependsOn ?? [],
                orchestratorSource: "pluto_fallback",
              },
            });
            await this.dispatchWorkerWithRetry(
              runId, task, role, instructions,
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
              const stage = primaryStageForRole(targetRole);
              workersDispatched.add(targetRole);
              await transcript.append({
                runId,
                ts: this.clock().toISOString(),
                source: "teamlead",
                type: "stage_request",
                message: `TeamLead requested ${targetRole} via ${String(ev.payload?.["source"] ?? ev.payload?.["orchestratorSource"] ?? "playbook/legacy bridge")}.`,
                payload: {
                  targetRole,
                  playbookId: selectedPlaybook.id,
                  stageId: typeof ev.payload?.["playbookStageId"] === "string" ? ev.payload["playbookStageId"] : stage?.id ?? null,
                  dependsOn: Array.isArray(ev.payload?.["dependsOn"]) ? ev.payload["dependsOn"] : stage?.dependsOn ?? [],
                  instructions,
                  orchestratorSource: ev.payload?.["orchestratorSource"] ?? null,
                },
              });
              await this.dispatchWorkerWithRetry(
                runId, task, role, instructions,
                contributions, workerAttempts, workerSelectionsBySession, emit, recordAdapterEvent, adapter,
              );
            } else if (ev.type === "worker_completed") {
              const roleId = String(ev.roleId ?? ev.payload?.["targetRole"] ?? "");
              const sessionId = String(ev.sessionId ?? "");
              const output = String(this.readEventPayloadValue(ev, "output") ?? "");
              const stage = primaryStageForRole(roleId);
              const transcriptType = roleId === "evaluator" && /^(PASS:|FAIL:)/.test(output.trimStart())
                ? "verdict"
                : "stage_output";
              const selection = this.resolveCatalogSelection(ev, workerSelectionsBySession);
              contributions.push({
                roleId: roleId as WorkerContribution["roleId"],
                sessionId,
                output,
                ...this.toContributionProvenancePins(selection),
              });
              await transcript.append({
                runId,
                ts: this.clock().toISOString(),
                source: "worker",
                type: transcriptType,
                message: `${roleId} completed contribution for playbook ${selectedPlaybook.id}.`,
                payload: {
                  roleId,
                  sessionId,
                  playbookId: selectedPlaybook.id,
                  stageId: stage?.id ?? null,
                  output,
                },
              });
              if (roleId === "evaluator" && output.trimStart().startsWith("FAIL:")) {
                validationFailureMessage = output.trim();
              }
            } else if (ev.type === "lead_message") {
              const kind = String(ev.payload?.["kind"] ?? "");
              if (kind === "summary") {
                leadSummaryMd = String(this.readEventPayloadValue(ev, "markdown") ?? "");
                await transcript.append({
                  runId,
                  ts: this.clock().toISOString(),
                  source: "teamlead",
                  type: "final_reconciliation",
                  message: "TeamLead produced the final reconciliation summary.",
                  payload: {
                    playbookId: selectedPlaybook.id,
                    markdown: leadSummaryMd,
                  },
                });
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
              message: this.buildSummaryRequest(task, contributions, selectedPlaybook, transcript.ref.path),
            });
          }
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

      if (validationFailureMessage && orchestrationMode === "lead_marker") {
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
      await transcript.append({
        runId,
        ts: this.clock().toISOString(),
        source: "pluto",
        type: "artifact_persisted",
        message: "Pluto persisted the final artifact after TeamLead reconciliation.",
        payload: { playbookId: selectedPlaybook.id, artifactPath },
      });
      await emit("artifact_created", {
        path: artifactPath,
        bytes: artifact.markdown.length,
        playbookId: selectedPlaybook.id,
        orchestrationMode,
        dependencyTrace,
        revisions,
        ...(escalation ? { escalation } : {}),
        finalReconciliation,
        transcript: transcript.ref,
        orchestrationSource: selectedPlaybook.orchestrationSource,
      });

      const finishedAt = this.clock();
      let result: TeamRunResult = blockerReason
        ? { runId, status: "failed", artifact, events: collected, runtimeResultRefs, blockerReason, failure: { message: `Blocker: ${blockerReason}` } }
        : {
            runId,
            status: escalation
              ? "completed_with_escalation"
              : (!finalReconciliation.valid ? "completed_with_warnings" : "completed"),
            artifact,
            events: collected,
            runtimeResultRefs,
            blockerReason: null,
          };

      const evidenceFailure = await this.writeEvidencePacket(task, result, collected, startedAt, finishedAt, blockerReason, transcript.ref);
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
          playbookId: selectedPlaybook.id,
          orchestrationMode,
          dependencyTrace,
          revisions,
          ...(escalation ? { escalation } : {}),
          finalReconciliation,
          status: result.status,
          transcript: transcript.ref,
          orchestrationSource: selectedPlaybook.orchestrationSource,
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
        transcript.ref,
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
    transcriptRef?: { kind: "file" | "shared_channel"; path: string; roomRef: string },
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
        transcriptRef,
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

  /**
   * Pluto-mediated bridge for the shipped `teamlead_direct` lane.
   *
   * Pluto deterministically enforces the TeamLead-authored playbook against the
   * transcript and uses `spawnTeammate()` only when an adapter/runtime can
   * actually delegate host spawning. The default implementation remains the
   * bridge over `createWorkerSession()`. See
   * `docs/plans/active/teamlead-orchestrated-agent-team-architecture.md`
   * "Acceptable only as a transitional fallback".
   */
  private async runTeamleadDirectFlow(input: {
    runId: string;
    task: TeamTask;
    leadSessionId: string;
    adapter: PaseoTeamAdapter;
    playbook: TeamPlaybookV0;
    transcript: { ref: { kind: "file" | "shared_channel"; path: string; roomRef: string }; append: (record: {
      runId: string;
      ts: string;
      source: "pluto" | "teamlead" | "worker" | "adapter";
      type: string;
      message: string;
      payload?: Record<string, unknown>;
    }) => Promise<unknown> };
    contributions: WorkerContribution[];
    workerSelectionsBySession: Map<string, RoleCatalogSelection>;
    recordAdapterEvent: (ev: AgentEvent) => Promise<void>;
    emit: (type: AgentEventType, payload?: Record<string, unknown>) => Promise<AgentEvent>;
    callbackNormalizer: CallbackNormalizer;
  }): Promise<{
    leadSummaryMd: string;
    validationFailureMessage: string | null;
    dependencyTrace: StageDependencyTrace[];
    revisions: Array<{ stageId: string; attempt: number; evaluatorVerdict: string; escalated?: boolean }>;
    escalation?: { stageId: string; attempts: number; lastVerdict: string };
    finalReconciliation: { citations: Array<{ stageId: string; present: boolean; snippet?: string }>; valid: boolean };
  }> {
    const orderedStages = this.topologicallySortStages(input.playbook);
    const stageOutputs = new Map<string, { output: string; completedAt: string; outputRef: PortableRuntimeResultAnyRefV0 | null }>();
    const dependencyTrace: StageDependencyTrace[] = [];
    const stageAttempts = new Map<string, number>();
    const revisionFeedbackByStage = new Map<string, string>();
    const revisions: Array<{ stageId: string; attempt: number; evaluatorVerdict: string; escalated?: boolean }> = [];
    let pendingRevision: { stageId: string; attempt: number } | null = null;
    let escalation: { stageId: string; attempts: number; lastVerdict: string } | undefined;
    let validationFailureMessage: string | null = null;

    let stageIndex = 0;
    while (stageIndex < orderedStages.length) {
      const stage = orderedStages[stageIndex]!;
      const unresolved = stage.dependsOn.filter((dependency) => !stageOutputs.has(dependency));
      if (unresolved.length > 0) {
        throw new Error(`teamlead_direct_dependency_unresolved:${stage.id}:${unresolved.join(",")}`);
      }
      const role = getRole(this.team, stage.roleId);
      const attempt = (stageAttempts.get(stage.id) ?? 0) + 1;
      stageAttempts.set(stage.id, attempt);
      const instructions = this.buildTeamleadDirectStageInstructions(
        input.task,
        input.playbook,
        stage,
        stageOutputs,
        revisionFeedbackByStage.get(stage.id),
      );
      const workerRequestedPayload: WorkerRequestedPayload = {
        targetRole: role.id,
        instructions,
        orchestratorSource: "teamlead_direct",
        playbookId: input.playbook.id,
        playbookStageId: stage.id,
        attempt,
        dependsOn: stage.dependsOn,
        source: "teamlead_direct",
      };
      await input.emit("worker_requested", workerRequestedPayload);
      await input.transcript.append({
        runId: input.runId,
        ts: this.clock().toISOString(),
        source: "teamlead",
        type: "stage_request",
        message: `TeamLead-direct requested ${role.id} for stage ${stage.id}.`,
        payload: {
          targetRole: role.id,
          playbookId: input.playbook.id,
          stageId: stage.id,
          attempt,
          dependsOn: stage.dependsOn,
          orchestratorSource: "teamlead_direct",
        },
      });

      let spawnedDirectly = false;
      let workerSessionId: string | null = null;
      if (input.adapter.spawnTeammate) {
        try {
          const spawned = await input.adapter.spawnTeammate({
            runId: input.runId,
            stageId: stage.id,
            role,
            instructions,
            dependencies: [...stage.dependsOn],
            transcript: input.transcript.ref,
          });
          workerSessionId = spawned.workerSessionId;
          spawnedDirectly = true;
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          if (!message.includes("spawnTeammate not supported in this runtime")) {
            throw error;
          }
        }
      }
      if (!spawnedDirectly) {
        const session = await input.adapter.createWorkerSession({
          runId: input.runId,
          role,
          instructions,
        });
        workerSessionId = session.sessionId;
      }
      const catalogSelection = getRoleCatalogSelection(this.team, role.id);
      if (catalogSelection && workerSessionId) {
        input.workerSelectionsBySession.set(workerSessionId, catalogSelection);
      }

      const completedEvent = await this.waitForTeamleadDirectWorkerCompletion({
        runId: input.runId,
        roleId: role.id,
        adapter: input.adapter,
        callbackNormalizer: input.callbackNormalizer,
        recordAdapterEvent: input.recordAdapterEvent,
      });
      const output = String(this.readEventPayloadValue(completedEvent, "output") ?? "");
      const sessionId = String(completedEvent.sessionId ?? "");
      const selection = this.resolveCatalogSelection(completedEvent, input.workerSelectionsBySession);
      const nextContribution: WorkerContribution = {
        roleId: role.id,
        sessionId,
        output,
        ...this.toContributionProvenancePins(selection),
      };
      const existingContributionIndex = input.contributions.findIndex((contribution) => contribution.roleId === role.id);
      if (existingContributionIndex >= 0) {
        input.contributions[existingContributionIndex] = nextContribution;
      } else {
        input.contributions.push(nextContribution);
      }
      const transcriptType = role.id === "evaluator" && /^(PASS:|FAIL:)/.test(output.trimStart())
        ? "verdict"
        : "stage_output";
      await input.transcript.append({
        runId: input.runId,
        ts: this.clock().toISOString(),
        source: "worker",
        type: transcriptType,
        message: `${role.id} completed contribution for stage ${stage.id}.`,
        payload: {
          roleId: role.id,
          sessionId,
          playbookId: input.playbook.id,
          stageId: stage.id,
          attempt,
          output,
        },
      });
      const traceEntry: StageDependencyTrace = {
        stageId: stage.id,
        role: role.id,
        completedAt: completedEvent.ts,
        outputRef: (completedEvent.payload["outputRef"] as PortableRuntimeResultAnyRefV0 | undefined) ?? null,
      };
      dependencyTrace.push(traceEntry);
      stageOutputs.set(stage.id, {
        output,
        completedAt: completedEvent.ts,
        outputRef: traceEntry.outputRef ?? null,
      });
      const revisionRule = input.playbook.revisionRules.find(
        (rule) => rule.fromStageId === stage.id && output.trimStart().startsWith(rule.failureSignal),
      );
      if (revisionRule) {
        validationFailureMessage = output.trim();
        const revisionAttempt = revisions.filter((revision) => revision.stageId === revisionRule.targetStageId).length + 1;
        const rerunStageIds = this.collectDependentStages(input.playbook, revisionRule.targetStageId);
        if (revisionAttempt <= revisionRule.maxRevisionCycles) {
          const revisionRecord = {
            stageId: revisionRule.targetStageId,
            attempt: revisionAttempt,
            evaluatorVerdict: output.trim(),
          };
          revisions.push(revisionRecord);
          await input.emit("revision_started", {
            orchestrationMode: "teamlead_direct",
            fromStageId: revisionRule.fromStageId,
            stageId: revisionRule.targetStageId,
            attempt: revisionAttempt,
            evaluatorVerdict: output.trim(),
          });
          await input.transcript.append({
            runId: input.runId,
            ts: this.clock().toISOString(),
            source: "teamlead",
            type: "revision_request",
            message: `Evaluator requested revision ${revisionAttempt} for ${revisionRule.targetStageId}.`,
            payload: {
              fromStageId: revisionRule.fromStageId,
              stageId: revisionRule.targetStageId,
              attempt: revisionAttempt,
              evaluatorVerdict: output.trim(),
            },
          });
          for (const stageId of rerunStageIds) {
            stageOutputs.delete(stageId);
          }
          for (let i = dependencyTrace.length - 1; i >= 0; i--) {
            if (rerunStageIds.includes(dependencyTrace[i]!.stageId)) {
              dependencyTrace.splice(i, 1);
            }
          }
          const affectedRoles = new Set(
            input.playbook.stages
              .filter((playbookStage) => rerunStageIds.includes(playbookStage.id))
              .map((playbookStage) => playbookStage.roleId),
          );
          for (let i = input.contributions.length - 1; i >= 0; i--) {
            if (affectedRoles.has(input.contributions[i]!.roleId)) {
              input.contributions.splice(i, 1);
            }
          }
          revisionFeedbackByStage.set(revisionRule.targetStageId, output.trim());
          pendingRevision = { stageId: revisionRule.targetStageId, attempt: revisionAttempt };
          stageIndex = orderedStages.findIndex((candidate) => candidate.id === revisionRule.targetStageId);
          continue;
        }

        const revisionRecord = {
          stageId: revisionRule.targetStageId,
          attempt: revisionAttempt,
          evaluatorVerdict: output.trim(),
          escalated: true,
        };
        revisions.push(revisionRecord);
        escalation = {
          stageId: revisionRule.targetStageId,
          attempts: revisionAttempt - 1,
          lastVerdict: output.trim(),
        };
        await input.emit("revision_completed", {
          orchestrationMode: "teamlead_direct",
          stageId: revisionRule.targetStageId,
          attempt: revisionAttempt,
          evaluatorVerdict: output.trim(),
          escalated: true,
        });
        await input.emit("escalation", {
          orchestrationMode: "teamlead_direct",
          stageId: revisionRule.targetStageId,
          attempts: revisionAttempt - 1,
          lastVerdict: output.trim(),
        });
        await input.transcript.append({
          runId: input.runId,
          ts: this.clock().toISOString(),
          source: "teamlead",
          type: "escalation",
          message: `Revision budget exhausted for ${revisionRule.targetStageId}.`,
          payload: {
            stageId: revisionRule.targetStageId,
            attempts: revisionAttempt - 1,
            lastVerdict: output.trim(),
          },
        });
        pendingRevision = null;
        break;
      }

      if (role.id === "evaluator" && pendingRevision) {
        const activeRevision = pendingRevision;
        pendingRevision = null;
        if (activeRevision) {
          await input.emit("revision_completed", {
            orchestrationMode: "teamlead_direct",
            stageId: activeRevision.stageId,
            attempt: activeRevision.attempt,
            evaluatorVerdict: output.trim(),
            escalated: false,
          });
        }
      }
      stageIndex += 1;
    }

    await input.adapter.sendMessage({
      runId: input.runId,
      sessionId: input.leadSessionId,
      message: this.buildSummaryRequest(input.task, input.contributions, input.playbook, input.transcript.ref.path),
    });
    const leadSummaryEvent = await this.waitForTeamleadDirectLeadSummary({
      runId: input.runId,
      adapter: input.adapter,
      callbackNormalizer: input.callbackNormalizer,
      recordAdapterEvent: input.recordAdapterEvent,
    });
    const leadSummaryMd = String(this.readEventPayloadValue(leadSummaryEvent, "markdown") ?? "");
    await input.transcript.append({
      runId: input.runId,
      ts: this.clock().toISOString(),
      source: "teamlead",
      type: "final_reconciliation",
      message: "TeamLead produced the final reconciliation summary.",
      payload: {
        playbookId: input.playbook.id,
        markdown: leadSummaryMd,
      },
    });
    const finalReconciliation = this.evaluateTeamleadDirectCitations(input.playbook, stageOutputs, leadSummaryMd);
    await input.emit(finalReconciliation.valid ? "final_reconciliation_validated" : "final_reconciliation_invalid", {
      orchestrationMode: "teamlead_direct",
      finalReconciliation,
    });

    return {
      leadSummaryMd,
      validationFailureMessage: escalation ? null : validationFailureMessage,
      dependencyTrace,
      revisions,
      escalation,
      finalReconciliation,
    };
  }

  private topologicallySortStages(playbook: TeamPlaybookV0): TeamPlaybookV0["stages"] {
    const sorted: TeamPlaybookV0["stages"] = [];
    const remaining = [...playbook.stages];
    const resolved = new Set<string>();

    while (remaining.length > 0) {
      const nextIndex = remaining.findIndex((stage) => stage.dependsOn.every((dependency) => resolved.has(dependency)));
      if (nextIndex < 0) {
        throw new Error(`teamlead_direct_topology_invalid:${playbook.id}`);
      }
      const [stage] = remaining.splice(nextIndex, 1);
      if (!stage) continue;
      sorted.push(stage);
      resolved.add(stage.id);
    }

    return sorted;
  }

  private buildTeamleadDirectStageInstructions(
    task: TeamTask,
    playbook: TeamPlaybookV0,
    stage: TeamPlaybookV0["stages"][number],
    stageOutputs: Map<string, { output: string; completedAt: string; outputRef: PortableRuntimeResultAnyRefV0 | null }>,
    revisionFeedback?: string,
  ): string {
    const dependencyLines = stage.dependsOn.map((dependencyId) => {
      const output = stageOutputs.get(dependencyId)?.output ?? "";
      return `Dependency ${dependencyId}: ${output}`;
    });
    return [
      `Playbook ${playbook.id} stage ${stage.id}: ${stage.instructions}`,
      stage.dependsOn.length > 0
        ? `Depends on stage(s): ${stage.dependsOn.join(", ")}. Consume the dependency outputs before responding.`
        : "No upstream stage dependencies.",
      ...(revisionFeedback ? [`Revision feedback: ${revisionFeedback}`] : []),
      `Task: ${task.title}`,
      `Goal: ${task.prompt}`,
      ...dependencyLines,
    ].join("\n");
  }

  private collectDependentStages(playbook: TeamPlaybookV0, rootStageId: string): string[] {
    const dependents = new Set<string>([rootStageId]);
    let changed = true;
    while (changed) {
      changed = false;
      for (const stage of playbook.stages) {
        if (dependents.has(stage.id)) continue;
        if (stage.dependsOn.some((dependency) => dependents.has(dependency))) {
          dependents.add(stage.id);
          changed = true;
        }
      }
    }
    return playbook.stages.filter((stage) => dependents.has(stage.id)).map((stage) => stage.id);
  }

  private async waitForTeamleadDirectWorkerCompletion(input: {
    runId: string;
    roleId: AgentRoleConfig["id"];
    adapter: PaseoTeamAdapter;
    callbackNormalizer: CallbackNormalizer;
    recordAdapterEvent: (ev: AgentEvent) => Promise<void>;
  }): Promise<AgentEvent> {
    const startedAt = Date.now();
    while (true) {
      if (Date.now() - startedAt > this.timeoutMs) {
        throw new Error(`teamlead_direct_worker_timeout:${input.roleId}`);
      }
      const batch = input.callbackNormalizer.normalize(await input.adapter.readEvents({ runId: input.runId }));
      if (batch.length === 0) {
        await delay(this.pumpIntervalMs);
        continue;
      }
      for (const event of batch) {
        await input.recordAdapterEvent(event);
        if (event.type === "worker_completed" && event.roleId === input.roleId) {
          return event;
        }
      }
    }
  }

  private async waitForTeamleadDirectLeadSummary(input: {
    runId: string;
    adapter: PaseoTeamAdapter;
    callbackNormalizer: CallbackNormalizer;
    recordAdapterEvent: (ev: AgentEvent) => Promise<void>;
  }): Promise<AgentEvent> {
    const startedAt = Date.now();
    while (true) {
      if (Date.now() - startedAt > this.timeoutMs) {
        throw new Error("teamlead_direct_summary_timeout");
      }
      const batch = input.callbackNormalizer.normalize(await input.adapter.readEvents({ runId: input.runId }));
      if (batch.length === 0) {
        await delay(this.pumpIntervalMs);
        continue;
      }
      for (const event of batch) {
        await input.recordAdapterEvent(event);
        if (event.type === "lead_message" && String(event.payload?.["kind"] ?? "") === "summary") {
          return event;
        }
      }
    }
  }

  private evaluateTeamleadDirectCitations(
    playbook: TeamPlaybookV0,
    stageOutputs: Map<string, { output: string; completedAt: string; outputRef: PortableRuntimeResultAnyRefV0 | null }>,
    leadSummaryMd: string,
  ): { citations: Array<{ stageId: string; present: boolean; snippet?: string }>; valid: boolean } {
    const citations: Array<{ stageId: string; present: boolean; snippet?: string }> = [];

    for (const stageId of playbook.finalCitationMetadata.requiredStageIds) {
      const output = stageOutputs.get(stageId)?.output ?? "";
      const citationSnippet = this.firstNonEmptyLine(output).slice(0, 80);
      const present = citationSnippet.length > 0 && leadSummaryMd.includes(citationSnippet);
      citations.push({
        stageId,
        present,
        ...(citationSnippet.length > 0 ? { snippet: citationSnippet } : {}),
      });
    }

    return {
      citations,
      valid: citations.every((citation) => citation.present),
    };
  }

  private buildSummaryRequest(task: TeamTask, contributions: WorkerContribution[], playbook: TeamPlaybookV0, transcriptFile: string): string {
    const lines = contributions.map(
      (c) => `- ${c.roleId}: ${c.output.slice(0, 280)}`,
    );
    return [
      `All ${contributions.length} workers have reported.`,
      "Synthesize the final artifact in markdown.",
      "Include each role's contribution clearly.",
      `Selected playbook: ${playbook.id} (${playbook.title}).`,
      `Coordination transcript path: ${transcriptFile}.`,
      `Final reconciliation must cite required playbook stages: ${playbook.finalCitationMetadata.requiredStageIds.join(", ")}.`,
      "Explicitly quote or reproduce each required stage output snippet and mention the transcript path.",
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
