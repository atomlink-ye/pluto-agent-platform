import { randomUUID } from "node:crypto";
import type {
  AgentEvent,
  AgentEventType,
  AgentRoleConfig,
  AgentSession,
  TeamConfig,
  TeamTask,
} from "../../contracts/types.js";
import type { PaseoTeamAdapter } from "../../contracts/adapter.js";

/**
 * Deterministic in-memory adapter. Used by unit tests and any environment
 * where Paseo / OpenCode is unavailable.
 *
 * The fake mirrors the protocol the live adapter is expected to honor:
 *   - lead_started after createLeadSession.
 *   - worker_requested events for every non-lead role (in team-config order).
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
  private readonly summaryBuilder?: (
    contributions: ReadonlyArray<{ roleId: string; output: string }>,
    task: TeamTask,
  ) => string;
  private readonly clock: () => Date;
  private readonly idGen: () => string;

  private runs = new Map<
    string,
    {
      task: TeamTask;
      events: AgentEvent[];
      cursor: number;
      leadSessionId?: string;
      workerSessions: Map<string, AgentSession>;
      contributions: Map<string, string>;
      ended: boolean;
    }
  >();

  constructor(opts: {
    team: TeamConfig;
    workerOutputs?: Partial<Record<string, string>>;
    summaryBuilder?: (
      contributions: ReadonlyArray<{ roleId: string; output: string }>,
      task: TeamTask,
    ) => string;
    clock?: () => Date;
    idGen?: () => string;
  }) {
    this.team = opts.team;
    this.workerOutputs = opts.workerOutputs;
    this.summaryBuilder = opts.summaryBuilder;
    this.clock = opts.clock ?? (() => new Date());
    this.idGen = opts.idGen ?? (() => randomUUID());
  }

  async startRun(input: { runId: string; task: TeamTask; team: TeamConfig }): Promise<void> {
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
      events: [],
      cursor: 0,
      workerSessions: new Map(),
      contributions: new Map(),
      ended: false,
    });
  }

  async createLeadSession(input: {
    runId: string;
    task: TeamTask;
    role: AgentRoleConfig;
  }): Promise<AgentSession> {
    const run = this.expectRun(input.runId);
    if (input.role.kind !== "team_lead") {
      throw new Error(`fake_adapter_lead_role_kind_mismatch: ${input.role.id}`);
    }
    const sessionId = `fake-lead-${this.idGen()}`;
    run.leadSessionId = sessionId;
    this.appendEvent(input.runId, {
      type: "lead_started",
      roleId: input.role.id,
      sessionId,
      payload: { systemPrompt: input.role.systemPrompt },
    });

    // Simulate the lead deciding to dispatch every non-lead role in config order.
    const workerRoles = this.team.roles.filter((r) => r.kind === "worker");
    for (const worker of workerRoles) {
      this.appendEvent(input.runId, {
        type: "worker_requested",
        roleId: worker.id,
        sessionId,
        payload: {
          targetRole: worker.id,
          instructions: this.workerInstructionsFor(input.task, worker),
        },
      });
    }

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
    const session: AgentSession = { sessionId, role: input.role };
    run.workerSessions.set(sessionId, session);

    this.appendEvent(input.runId, {
      type: "worker_started",
      roleId: input.role.id,
      sessionId,
      payload: { instructions: input.instructions },
    });

    const output = this.workerOutputFor(input.role, input.instructions);
    run.contributions.set(input.role.id, output);

    this.appendEvent(input.runId, {
      type: "worker_completed",
      roleId: input.role.id,
      sessionId,
      payload: { output },
    });

    return session;
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
    this.appendEvent(input.runId, {
      type: "lead_message",
      roleId: this.team.leadRoleId,
      sessionId: input.sessionId,
      payload: { kind: "summary", markdown: summary },
    });
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
    partial: { type: AgentEventType; roleId?: string; sessionId?: string; payload: Record<string, unknown> },
  ) {
    const run = this.expectRun(runId);
    const event: AgentEvent = {
      id: this.idGen(),
      runId,
      ts: this.clock().toISOString(),
      type: partial.type,
      ...(partial.roleId
        ? { roleId: partial.roleId as AgentEvent["roleId"] }
        : {}),
      ...(partial.sessionId ? { sessionId: partial.sessionId } : {}),
      payload: partial.payload,
    };
    run.events.push(event);
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

  private workerOutputFor(role: AgentRoleConfig, instructions: string): string {
    const override = this.workerOutputs?.[role.id];
    if (override !== undefined) return override;
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
    for (const [roleId, output] of contributions.entries()) {
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
