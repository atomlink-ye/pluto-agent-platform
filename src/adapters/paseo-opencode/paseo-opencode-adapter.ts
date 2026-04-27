import { randomUUID } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import type {
  AgentEvent,
  AgentEventType,
  AgentRoleConfig,
  AgentSession,
  TeamConfig,
  TeamTask,
} from "../../contracts/types.js";
import type { PaseoTeamAdapter } from "../../contracts/adapter.js";
import { DEFAULT_RUNNER, type ProcessRunner } from "./process-runner.js";

/**
 * Live adapter that drives Paseo CLI agents whose model runtime is OpenCode.
 *
 * Status: best-effort scaffold. End-to-end execution requires:
 *   - `paseo` CLI on PATH with a working provider that targets OpenCode.
 *   - OpenCode runtime reachable at $OPENCODE_BASE_URL using
 *     `opencode/minimax-m2.5-free` (or another free profile).
 *   - lead/worker session prompts cooperating with the line-based protocol.
 *
 * See `.paseo-pluto-mvp/root/integration-plan.md` for what's missing.
 *
 * Protocol contract with the lead agent:
 *   - The lead prompt instructs the lead to emit, on its own line, markers
 *     of the form:
 *         WORKER_REQUEST: <roleId> :: <instructions>
 *     once for each non-lead role in dispatch order.
 *   - The lead's final summary, after orchestrator sends a SUMMARIZE message,
 *     is delivered as the agent's final stdout text and surfaced as a
 *     `lead_message` event with payload `{ kind: "summary", markdown }`.
 *
 * Worker output is captured by reading the worker session's final text after
 * `paseo wait` returns.
 */
export interface PaseoOpenCodeAdapterOptions {
  paseoBin?: string;
  provider?: string;
  /** Working directory passed to paseo as --cwd. */
  workspaceCwd?: string;
  /** Override exec/spawn for tests. */
  runner?: ProcessRunner;
  /** Defaults for thinking/mode flags. */
  thinking?: string;
  mode?: string;
  /** ms to wait for worker outputs after `paseo wait` returns. */
  workerSettleMs?: number;
  /** ms to give a follow stream to drain before disposing. */
  followDrainMs?: number;
  /** Clock + idGen overrides for tests. */
  clock?: () => Date;
  idGen?: () => string;
}

interface RunState {
  task: TeamTask;
  team: TeamConfig;
  events: AgentEvent[];
  cursor: number;
  leadAgentId?: string;
  followers: Array<{ dispose: () => Promise<void> }>;
  workerAgentIds: Map<string, string>; // roleId → paseo agent id
}

const WORKER_REQUEST_RE = /^WORKER_REQUEST:\s*([a-zA-Z0-9_-]+)\s*::\s*(.*)$/;

export class PaseoOpenCodeAdapter implements PaseoTeamAdapter {
  private readonly bin: string;
  private readonly provider: string;
  private readonly workspaceCwd?: string;
  private readonly runner: ProcessRunner;
  private readonly thinking?: string;
  private readonly mode?: string;
  private readonly workerSettleMs: number;
  private readonly followDrainMs: number;
  private readonly clock: () => Date;
  private readonly idGen: () => string;
  private runs = new Map<string, RunState>();

  constructor(opts: PaseoOpenCodeAdapterOptions = {}) {
    this.bin = opts.paseoBin ?? process.env["PASEO_BIN"] ?? "paseo";
    this.provider =
      opts.provider ??
      process.env["PASEO_PROVIDER"] ??
      "opencode/minimax-m2.5-free";
    this.workspaceCwd = opts.workspaceCwd;
    this.runner = opts.runner ?? DEFAULT_RUNNER;
    this.thinking = opts.thinking;
    this.mode = opts.mode ?? "bypassPermissions";
    this.workerSettleMs = opts.workerSettleMs ?? 1_500;
    this.followDrainMs = opts.followDrainMs ?? 250;
    this.clock = opts.clock ?? (() => new Date());
    this.idGen = opts.idGen ?? (() => randomUUID());
  }

  async startRun(input: { runId: string; task: TeamTask; team: TeamConfig }): Promise<void> {
    if (this.runs.has(input.runId)) {
      throw new Error(`paseo_adapter_run_already_started:${input.runId}`);
    }
    this.runs.set(input.runId, {
      task: input.task,
      team: input.team,
      events: [],
      cursor: 0,
      followers: [],
      workerAgentIds: new Map(),
    });
  }

  async createLeadSession(input: {
    runId: string;
    task: TeamTask;
    role: AgentRoleConfig;
  }): Promise<AgentSession> {
    const run = this.expectRun(input.runId);
    const prompt = this.buildLeadPrompt(input.task, input.role, run.team);
    const args = this.runArgs({
      title: `Pluto MVP-alpha Lead [${input.runId}]`,
    });
    const result = await this.runner.exec(this.bin, [...args, prompt], {
      cwd: this.workspaceCwd ?? input.task.workspacePath,
    });
    if (result.exitCode !== 0) {
      throw new Error(
        `paseo_lead_spawn_failed: exit=${result.exitCode} stderr=${result.stderr.slice(0, 400)}`,
      );
    }
    const agentId = this.parseAgentId(result.stdout);
    if (!agentId) {
      throw new Error(
        `paseo_lead_agent_id_missing: stdout=${result.stdout.slice(0, 400)}`,
      );
    }
    run.leadAgentId = agentId;

    this.appendEvent(input.runId, {
      type: "lead_started",
      roleId: input.role.id,
      sessionId: agentId,
      payload: { provider: this.provider, paseoAgentId: agentId },
    });

    // Subscribe to lead text stream and translate WORKER_REQUEST markers.
    const follower = this.runner.follow(
      this.bin,
      ["logs", agentId, "--follow", "--filter", "text"],
      {
        onLine: (line) => this.onLeadLogLine(input.runId, agentId, line),
      },
    );
    run.followers.push(follower);

    return { sessionId: agentId, role: input.role, external: { paseoAgentId: agentId } };
  }

  async createWorkerSession(input: {
    runId: string;
    role: AgentRoleConfig;
    instructions: string;
  }): Promise<AgentSession> {
    const run = this.expectRun(input.runId);
    const prompt = this.buildWorkerPrompt(input.role, input.instructions);
    const args = this.runArgs({
      title: `Pluto MVP-alpha Worker [${input.role.id}] [${input.runId}]`,
    });
    const result = await this.runner.exec(this.bin, [...args, prompt], {
      cwd: this.workspaceCwd ?? run.task.workspacePath,
    });
    if (result.exitCode !== 0) {
      throw new Error(
        `paseo_worker_spawn_failed:${input.role.id} exit=${result.exitCode} stderr=${result.stderr.slice(0, 400)}`,
      );
    }
    const agentId = this.parseAgentId(result.stdout);
    if (!agentId) {
      throw new Error(
        `paseo_worker_agent_id_missing:${input.role.id} stdout=${result.stdout.slice(0, 400)}`,
      );
    }
    run.workerAgentIds.set(input.role.id, agentId);

    this.appendEvent(input.runId, {
      type: "worker_started",
      roleId: input.role.id,
      sessionId: agentId,
      payload: { paseoAgentId: agentId, instructions: input.instructions },
    });

    // Block until the worker is idle, then read its final output.
    const wait = await this.runner.exec(this.bin, ["wait", agentId, "--json"], {
      cwd: this.workspaceCwd ?? run.task.workspacePath,
    });
    if (wait.exitCode !== 0) {
      throw new Error(
        `paseo_worker_wait_failed:${input.role.id} exit=${wait.exitCode} stderr=${wait.stderr.slice(0, 400)}`,
      );
    }
    await delay(this.workerSettleMs);
    const inspect = await this.runner.exec(
      this.bin,
      ["inspect", agentId, "--json"],
      { cwd: this.workspaceCwd ?? run.task.workspacePath },
    );
    const output = this.extractFinalText(inspect.stdout) ?? "";

    this.appendEvent(input.runId, {
      type: "worker_completed",
      roleId: input.role.id,
      sessionId: agentId,
      payload: { paseoAgentId: agentId, output },
    });

    return { sessionId: agentId, role: input.role, external: { paseoAgentId: agentId } };
  }

  async sendMessage(input: { runId: string; sessionId: string; message: string }): Promise<void> {
    const run = this.expectRun(input.runId);
    if (run.leadAgentId !== input.sessionId) {
      throw new Error(`paseo_adapter_unknown_session:${input.sessionId}`);
    }
    const result = await this.runner.exec(
      this.bin,
      ["send", input.sessionId, input.message],
      { cwd: this.workspaceCwd ?? run.task.workspacePath },
    );
    if (result.exitCode !== 0) {
      throw new Error(
        `paseo_send_failed: exit=${result.exitCode} stderr=${result.stderr.slice(0, 400)}`,
      );
    }
    if (input.message.includes("SUMMARIZE")) {
      // Wait for the lead to settle, then read its final text and emit summary event.
      await this.runner.exec(this.bin, ["wait", input.sessionId, "--json"], {
        cwd: this.workspaceCwd ?? run.task.workspacePath,
      });
      const inspect = await this.runner.exec(
        this.bin,
        ["inspect", input.sessionId, "--json"],
        { cwd: this.workspaceCwd ?? run.task.workspacePath },
      );
      const markdown = this.extractFinalText(inspect.stdout) ?? "";
      this.appendEvent(input.runId, {
        type: "lead_message",
        roleId: run.team.leadRoleId,
        sessionId: input.sessionId,
        payload: { kind: "summary", markdown },
      });
    }
  }

  async readEvents(input: { runId: string }): Promise<AgentEvent[]> {
    const run = this.expectRun(input.runId);
    const next = run.events.slice(run.cursor);
    run.cursor = run.events.length;
    return next;
  }

  async waitForCompletion(input: { runId: string; timeoutMs: number }): Promise<AgentEvent[]> {
    void input.timeoutMs;
    return this.readEvents({ runId: input.runId });
  }

  async endRun(input: { runId: string }): Promise<void> {
    const run = this.runs.get(input.runId);
    if (!run) return;
    await delay(this.followDrainMs);
    for (const f of run.followers) {
      try {
        await f.dispose();
      } catch {
        // best-effort
      }
    }
    run.followers = [];
  }

  // ---------- helpers ----------

  private runArgs(opts: { title: string }): string[] {
    const args = [
      "run",
      "--detach",
      "--json",
      "--provider",
      this.provider,
      "--mode",
      this.mode ?? "bypassPermissions",
      "--title",
      opts.title,
    ];
    if (this.thinking) args.push("--thinking", this.thinking);
    if (this.workspaceCwd) args.push("--cwd", this.workspaceCwd);
    return args;
  }

  private parseAgentId(stdout: string): string | undefined {
    const trimmed = stdout.trim();
    if (!trimmed) return undefined;
    try {
      const parsed = JSON.parse(trimmed);
      if (typeof parsed === "string") return parsed;
      if (parsed && typeof parsed === "object") {
        if (typeof parsed.id === "string") return parsed.id;
        if (typeof parsed.agentId === "string") return parsed.agentId;
      }
    } catch {
      // fall through to regex fallback
    }
    const m = trimmed.match(/"id"\s*:\s*"([^"]+)"/);
    return m ? m[1] : undefined;
  }

  private extractFinalText(stdout: string): string | undefined {
    const trimmed = stdout.trim();
    if (!trimmed) return undefined;
    try {
      const parsed = JSON.parse(trimmed);
      if (typeof parsed === "string") return parsed;
      if (parsed && typeof parsed === "object") {
        if (typeof parsed.finalText === "string") return parsed.finalText;
        if (typeof parsed.output === "string") return parsed.output;
        if (typeof parsed.lastText === "string") return parsed.lastText;
        if (typeof parsed.summary === "string") return parsed.summary;
      }
    } catch {
      return trimmed;
    }
    return trimmed;
  }

  private onLeadLogLine(runId: string, leadId: string, raw: string) {
    let text = raw;
    try {
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === "object" && typeof parsed.text === "string") {
        text = parsed.text;
      }
    } catch {
      // raw text — keep as-is
    }
    for (const line of text.split(/\r?\n/)) {
      const m = line.match(WORKER_REQUEST_RE);
      if (!m) continue;
      const targetRole = m[1]!;
      const instructions = (m[2] ?? "").trim();
      this.appendEvent(runId, {
        type: "worker_requested",
        roleId: targetRole,
        sessionId: leadId,
        payload: { targetRole, instructions, source: "lead_text_marker" },
      });
    }
  }

  private buildLeadPrompt(task: TeamTask, role: AgentRoleConfig, team: TeamConfig): string {
    const workerRoles = team.roles.filter((r) => r.kind === "worker");
    const lines = [
      role.systemPrompt,
      "",
      "PROTOCOL: For each worker you want dispatched, emit a single line in",
      "the exact format (no surrounding code fences, no JSON):",
      "  WORKER_REQUEST: <roleId> :: <one-line instructions>",
      `Dispatch order MUST be: ${workerRoles.map((r) => r.id).join(", ")}.`,
      "After all workers are reported back, the orchestrator will send",
      "a 'SUMMARIZE' message. Reply with the final markdown artifact.",
      "",
      `Task title: ${task.title}`,
      `Goal: ${task.prompt}`,
      `Workspace path: ${task.workspacePath}`,
    ];
    if (task.artifactPath) {
      lines.push(`Artifact path the team should converge on: ${task.artifactPath}`);
    }
    return lines.join("\n");
  }

  private buildWorkerPrompt(role: AgentRoleConfig, instructions: string): string {
    return [
      role.systemPrompt,
      "",
      `Instructions from the Team Lead:`,
      instructions,
    ].join("\n");
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

  private expectRun(runId: string): RunState {
    const run = this.runs.get(runId);
    if (!run) throw new Error(`paseo_adapter_unknown_run:${runId}`);
    return run;
  }
}
