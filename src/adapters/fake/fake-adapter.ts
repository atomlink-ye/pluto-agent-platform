import { randomUUID } from "node:crypto";
import type {
  AgentEvent,
  AgentEventType,
  AgentRoleConfig,
  AgentSession,
  CoordinationTranscriptRefV0,
  OrchestrationMode,
  TeamConfig,
  TeamPlaybookV0,
  TeamTask,
  WorkerRequestedPayload,
} from "../../contracts/types.js";
import type { PaseoTeamAdapter } from "../../contracts/adapter.js";
import { redactObject } from "../../orchestrator/redactor.js";
import {
  buildAdapterCallbackIdentity,
  type AdapterCallbackIdentity,
  type AdapterCallbackStatus,
} from "../../runtime/callback-normalizer.js";
import { buildPortableRuntimeResultValueRefV0 } from "../../runtime/result-contract.js";

/**
 * Deterministic in-memory adapter. Used by unit tests and any environment
 * where Paseo / OpenCode is unavailable.
 *
 * The fake mirrors the v1.6 runtime surface used by the harness:
 *   - lead_started after createLeadSession.
 *   - worker_started + worker_completed when createWorkerSession is called.
 *   - lead_message(kind="summary") in response to a sendMessage that contains
 *     the keyword `SUMMARIZE`.
 *
 * Lifecycle events (run_started, artifact_created, run_completed, run_failed)
 * are owned by the orchestrator, not the adapter.
 */
export class FakeAdapter implements PaseoTeamAdapter {
  private readonly team: TeamConfig;
  private readonly workerOutputs?: Partial<Record<string, string>>;
  private readonly stageOutputResolver?: (input: {
    task: TeamTask;
    role: AgentRoleConfig;
    instructions: string;
    stageId?: string;
    stageAttempt?: number;
    workerAttempt: number;
    dependencies: string[];
  }) => string | undefined;
  private readonly summaryBuilder?: (
    contributions: ReadonlyArray<{ roleId: string; output: string }>,
    task: TeamTask,
  ) => string;
  private readonly clock: () => Date;
  private readonly idGen: () => string;
  private readonly sentMessages: Array<{
    runId: string;
    sessionId: string;
    roleId?: string;
    message: string;
    via: "session" | "role";
  }> = [];
  private readonly sessionIdle = new Map<string, boolean>();

  private runs = new Map<
    string,
    {
      task: TeamTask;
      orchestrationMode: OrchestrationMode;
      playbook?: TeamPlaybookV0;
      transcript?: CoordinationTranscriptRefV0;
      events: AgentEvent[];
      cursor: number;
      leadSessionId?: string;
      roleSessionIds: Map<string, string>;
      workerSessions: Map<string, AgentSession>;
      workerAttempts: Map<string, number>;
      directStageAttempts: Map<string, number>;
      directStageByRole: Map<string, { stageId: string; attempt: number; dependencies: string[] }>;
      contributions: Map<string, string>;
      callbackSequence: number;
      ended: boolean;
    }
  >();

  constructor(opts: {
    team: TeamConfig;
    workerOutputs?: Partial<Record<string, string>>;
    stageOutputResolver?: (input: {
      task: TeamTask;
      role: AgentRoleConfig;
      instructions: string;
      stageId?: string;
      stageAttempt?: number;
      workerAttempt: number;
      dependencies: string[];
    }) => string | undefined;
    summaryBuilder?: (
      contributions: ReadonlyArray<{ roleId: string; output: string }>,
      task: TeamTask,
    ) => string;
    clock?: () => Date;
    idGen?: () => string;
  }) {
    this.team = opts.team;
    this.workerOutputs = opts.workerOutputs;
    this.stageOutputResolver = opts.stageOutputResolver;
    this.summaryBuilder = opts.summaryBuilder;
    this.clock = opts.clock ?? (() => new Date());
    this.idGen = opts.idGen ?? (() => randomUUID());
  }

  async startRun(input: { runId: string; task: TeamTask; team: TeamConfig; playbook?: TeamPlaybookV0; transcript?: CoordinationTranscriptRefV0 }): Promise<void> {
    if (input.team.id !== this.team.id) {
      throw new Error(
        `fake_adapter_team_mismatch: expected ${this.team.id}, got ${input.team.id}`,
      );
    }
    if (this.runs.has(input.runId)) {
      throw new Error(`fake_adapter_run_already_started: ${input.runId}`);
    }
    this.runs.set(input.runId, {
      task: input.task,
      orchestrationMode: input.task.orchestrationMode ?? "teamlead_direct",
      playbook: input.playbook,
      transcript: input.transcript,
      events: [],
      cursor: 0,
      roleSessionIds: new Map(),
      workerSessions: new Map(),
      workerAttempts: new Map(),
      directStageAttempts: new Map(),
      directStageByRole: new Map(),
      contributions: new Map(),
      callbackSequence: 0,
      ended: false,
    });
  }

  async createLeadSession(input: {
    runId: string;
    task: TeamTask;
    role: AgentRoleConfig;
    playbook?: TeamPlaybookV0;
    transcript?: CoordinationTranscriptRefV0;
  }): Promise<AgentSession> {
    const run = this.expectRun(input.runId);
    if (input.role.kind !== "team_lead") {
      throw new Error(`fake_adapter_lead_role_kind_mismatch: ${input.role.id}`);
    }
    const sessionId = `fake-lead-${this.idGen()}`;
    run.leadSessionId = sessionId;
    run.roleSessionIds.set(input.role.id, sessionId);
    this.sessionIdle.set(sessionId, true);
    const leadBatchId = this.nextBatchId(input.runId, "lead");
    this.appendEvent(input.runId, {
      type: "lead_started",
      roleId: input.role.id,
      sessionId,
      payload: {
        systemPrompt: input.role.systemPrompt,
        playbookId: input.playbook?.id ?? run.playbook?.id ?? null,
        transcript: input.transcript ?? run.transcript ?? null,
        orchestrationSource: input.playbook?.orchestrationSource ?? run.playbook?.orchestrationSource ?? "teamlead_direct",
      },
      callback: this.callbackIdentity({
        source: "fake_adapter",
        batchId: leadBatchId,
        lineageKey: `lead:${sessionId}`,
        status: "in_progress",
        dedupeParts: ["lead_started", sessionId],
      }),
    });

    return { sessionId, role: input.role };
  }

  async createWorkerSession(input: {
    runId: string;
    role: AgentRoleConfig;
    instructions: string;
  }): Promise<AgentSession> {
    const run = this.expectRun(input.runId);
    if (input.role.kind !== "worker") {
      throw new Error(`fake_adapter_worker_role_kind_mismatch: ${input.role.id}`);
    }
    const sessionId = `fake-worker-${input.role.id}-${this.idGen()}`;
    const attempt = (run.workerAttempts.get(input.role.id) ?? 0) + 1;
    run.workerAttempts.set(input.role.id, attempt);
    const workerBatchId = this.nextBatchId(input.runId, `worker-${input.role.id}`);
    const session: AgentSession = { sessionId, role: input.role };
    run.roleSessionIds.set(input.role.id, sessionId);
    run.workerSessions.set(sessionId, session);
    this.sessionIdle.set(sessionId, true);

    this.appendEvent(input.runId, {
      type: "worker_started",
      roleId: input.role.id,
      sessionId,
      payload: { instructions: input.instructions, attempt },
      callback: this.callbackIdentity({
        source: "fake_adapter",
        batchId: workerBatchId,
        lineageKey: `worker:${input.role.id}:attempt:${attempt}`,
        status: "in_progress",
        dedupeParts: ["worker_started", input.role.id, attempt, input.instructions],
      }),
    });

    const output = this.workerOutputFor(run, input.role, input.instructions, attempt);
    run.contributions.set(input.role.id, output);

    this.appendEvent(input.runId, {
      type: "worker_completed",
      roleId: input.role.id,
      sessionId,
      payload: { output, attempt },
      rawPayloadKeys: ["output"],
      callback: this.callbackIdentity({
        source: "fake_adapter",
        batchId: workerBatchId,
        lineageKey: `worker:${input.role.id}:attempt:${attempt}`,
        status: "completed",
        dedupeParts: ["worker_completed", input.role.id, attempt, output],
      }),
    });

    return session;
  }

  async spawnTeammate(input: {
    runId: string;
    stageId: string;
    role: AgentRoleConfig;
    instructions: string;
    dependencies: string[];
    transcript: CoordinationTranscriptRefV0;
  }): Promise<{ workerSessionId: string }> {
    const run = this.expectRun(input.runId);
    const stageAttempt = (run.directStageAttempts.get(input.stageId) ?? 0) + 1;
    run.directStageAttempts.set(input.stageId, stageAttempt);
    run.directStageByRole.set(input.role.id, {
      stageId: input.stageId,
      attempt: stageAttempt,
      dependencies: [...input.dependencies],
    });
    void input.transcript;
    const session = await this.createWorkerSession({
      runId: input.runId,
      role: input.role,
      instructions: input.instructions,
    });
    return { workerSessionId: session.sessionId };
  }

  async sendMessage(input: {
    runId: string;
    sessionId: string;
    message: string;
  }): Promise<void> {
    const run = this.expectRun(input.runId);
    if (run.leadSessionId !== input.sessionId) {
      // MVP-alpha only supports follow-ups to the lead.
      throw new Error(`fake_adapter_unknown_session: ${input.sessionId}`);
    }
    if (!input.message.includes("SUMMARIZE")) {
      // No-op for non-summary messages in the fake.
      return;
    }
    const summary = this.buildSummary(run.task, run.contributions);
    const summaryBatchId = this.nextBatchId(input.runId, "lead-summary");
    this.appendEvent(input.runId, {
      type: "lead_message",
      roleId: this.team.leadRoleId,
      sessionId: input.sessionId,
      payload: { kind: "summary", markdown: summary },
      rawPayloadKeys: ["markdown"],
      callback: this.callbackIdentity({
        source: "fake_adapter",
        batchId: summaryBatchId,
        lineageKey: `lead_summary:${input.sessionId}`,
        status: "completed",
        dedupeParts: ["lead_message", input.sessionId, "summary", summary],
      }),
    });
  }

  async sendSessionMessage(input: {
    runId: string;
    sessionId: string;
    message: string;
    wait?: boolean;
  }): Promise<void> {
    const run = this.expectRun(input.runId);
    this.expectKnownSession(run, input.sessionId);
    this.sentMessages.push({
      runId: input.runId,
      sessionId: input.sessionId,
      message: input.message,
      via: "session",
    });
    if (input.wait === true) {
      this.sessionIdle.set(input.sessionId, true);
    }
  }

  async sendRoleMessage(input: {
    runId: string;
    roleId: string;
    message: string;
    wait?: boolean;
  }): Promise<void> {
    const run = this.expectRun(input.runId);
    const sessionId = run.roleSessionIds.get(input.roleId);
    if (!sessionId) {
      throw new Error(`fake_adapter_unknown_role: ${input.roleId}`);
    }
    this.sentMessages.push({
      runId: input.runId,
      sessionId,
      roleId: input.roleId,
      message: input.message,
      via: "role",
    });
    if (input.wait === true) {
      this.sessionIdle.set(sessionId, true);
    }
  }

  async readEvents(input: { runId: string }): Promise<AgentEvent[]> {
    const run = this.expectRun(input.runId);
    const next = run.events.slice(run.cursor);
    run.cursor = run.events.length;
    return next;
  }

  async waitForCompletion(input: {
    runId: string;
    timeoutMs: number;
  }): Promise<AgentEvent[]> {
    void input.timeoutMs; // fake is synchronous; no real wait needed.
    return this.readEvents({ runId: input.runId });
  }

  async endRun(input: { runId: string }): Promise<void> {
    const run = this.runs.get(input.runId);
    if (!run) return;
    run.ended = true;
  }

  getSentMessages(): Array<{
    runId: string;
    sessionId: string;
    roleId?: string;
    message: string;
    via: "session" | "role";
  }> {
    return this.sentMessages.map((entry) => ({ ...entry }));
  }

  setSessionIdle(sessionId: string, idle: boolean): void {
    this.sessionIdle.set(sessionId, idle);
  }

  async isSessionIdle(input: { runId: string; sessionId: string }): Promise<boolean> {
    this.expectRun(input.runId);
    return this.sessionIdle.get(input.sessionId) ?? false;
  }

  // ---------- helpers ----------

  private expectRun(runId: string) {
    const run = this.runs.get(runId);
    if (!run) {
      throw new Error(`fake_adapter_unknown_run: ${runId}`);
    }
    return run;
  }

  private appendEvent(
    runId: string,
    partial: {
      type: AgentEventType;
      roleId?: string;
      sessionId?: string;
      payload: Record<string, unknown>;
      rawPayloadKeys?: string[];
      callback?: AdapterCallbackIdentity;
    },
  ) {
    const run = this.expectRun(runId);
    const redactedPayload = redactObject(partial.payload) as Record<string, unknown>;
    const rawPayload = partial.rawPayloadKeys?.length
      ? Object.fromEntries(
          partial.rawPayloadKeys.map((key) => [key, partial.payload[key]]),
        )
      : undefined;
    const event: AgentEvent = {
      id: this.idGen(),
      runId,
      ts: this.clock().toISOString(),
      type: partial.type,
      ...(partial.roleId
        ? { roleId: partial.roleId as AgentEvent["roleId"] }
        : {}),
      ...(partial.sessionId ? { sessionId: partial.sessionId } : {}),
      payload: redactedPayload,
      ...((rawPayload || partial.callback)
        ? {
            transient: {
              ...(rawPayload ? { rawPayload } : {}),
              ...(partial.callback ? { callback: partial.callback } : {}),
            },
          }
        : {}),
    };
    this.attachValueRefs(event, partial.rawPayloadKeys);
    run.events.push(event);
  }

  private expectKnownSession(
    run: {
      leadSessionId?: string;
      workerSessions: Map<string, AgentSession>;
    },
    sessionId: string,
  ): void {
    if (run.leadSessionId === sessionId) return;
    if (run.workerSessions.has(sessionId)) return;
    throw new Error(`fake_adapter_unknown_session: ${sessionId}`);
  }

  private attachValueRefs(event: AgentEvent, rawPayloadKeys?: readonly string[]) {
    if (!rawPayloadKeys?.length) return;
    if (rawPayloadKeys.includes("output")) {
      event.payload.outputRef = buildPortableRuntimeResultValueRefV0(event, "output");
    }
    if (rawPayloadKeys.includes("markdown")) {
      event.payload.markdownRef = buildPortableRuntimeResultValueRefV0(event, "markdown");
    }
  }

  private nextBatchId(runId: string, label: string): string {
    const run = this.expectRun(runId);
    run.callbackSequence += 1;
    return `fake:${runId}:${label}:${run.callbackSequence}`;
  }

  private callbackIdentity(input: {
    source: string;
    batchId: string;
    lineageKey: string;
    status: AdapterCallbackStatus;
    dedupeParts: ReadonlyArray<unknown>;
  }): AdapterCallbackIdentity {
    return buildAdapterCallbackIdentity(input);
  }

  private workerInstructionsFor(task: TeamTask, worker: AgentRoleConfig): string {
    switch (worker.id) {
      case "planner":
        return `Plan how to satisfy: ${task.prompt}`;
      case "generator":
        return `Generate the artifact body for: ${task.prompt}`;
      case "evaluator":
        return `Evaluate the generated artifact against: ${task.prompt}`;
      default:
        return `Contribute to: ${task.prompt}`;
    }
  }

  private shouldDeferTeamLeadDirectRequestsToService(playbook: TeamPlaybookV0 | undefined): boolean {
    return Boolean(playbook?.id.startsWith("teamlead-direct-"));
  }

  private stageInstructionsFor(
    task: TeamTask,
    stage: { id: string; instructions: string; dependsOn: string[] },
    playbook: TeamPlaybookV0 | undefined,
  ): string {
    if (!playbook) return stage.instructions;
    return [
      `Playbook ${playbook.id} stage ${stage.id}: ${stage.instructions}`,
      stage.dependsOn.length > 0 ? `Depends on stage(s): ${stage.dependsOn.join(", ")}. Consume their transcript evidence before responding.` : "No upstream stage dependencies.",
      `Task: ${task.title}`,
    ].join("\n");
  }

  private workerOutputFor(
    run: {
      task: TeamTask;
      directStageByRole: Map<string, { stageId: string; attempt: number; dependencies: string[] }>;
    },
    role: AgentRoleConfig,
    instructions: string,
    workerAttempt: number,
  ): string {
    const override = this.workerOutputs?.[role.id];
    if (override !== undefined) return override;
    const stageMeta = run.directStageByRole.get(role.id);
    const resolved = this.stageOutputResolver?.({
      task: run.task,
      role,
      instructions,
      stageId: stageMeta?.stageId,
      stageAttempt: stageMeta?.attempt,
      workerAttempt,
      dependencies: stageMeta?.dependencies ?? [],
    });
    if (resolved !== undefined) return resolved;
    switch (role.id) {
      case "planner":
        return `1. Outline the artifact.\n2. Cover acceptance criteria.\n3. Flag risks.`;
      case "generator":
        return `Generated body for instructions: ${instructions}`;
      case "evaluator":
        return `PASS: deliverable matches the team goal.`;
      default:
        return `Contribution from ${role.id}.`;
    }
  }

  private buildSummary(task: TeamTask, contributions: Map<string, string>): string {
    if (this.summaryBuilder) {
      return this.summaryBuilder(
        Array.from(contributions.entries()).map(([roleId, output]) => ({ roleId, output })),
        task,
      );
    }
    const lines: string[] = [];
    lines.push(`# ${task.title}`);
    lines.push("");
    lines.push(`Goal: ${task.prompt}`);
    lines.push("");
    lines.push("## Worker contributions");
    for (const [roleId, output] of Array.from(contributions.entries())) {
      lines.push(`### ${roleId}`);
      lines.push(output);
      lines.push("");
    }
    lines.push("## Lead summary");
    lines.push(
      `Lead aggregated ${contributions.size} worker outputs (${Array.from(contributions.keys()).join(", ")}).`,
    );
    return lines.join("\n");
  }
}
