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
 * Confirmed working invariants on this host (2026-04-27):
 *   - paseo provider alias `opencode` is `available`, default mode `build`.
 *   - `opencode/minimax-m2.5-free` returns deterministic responses end-to-end.
 *   - paseo CLI is a macOS app-bundle binary (not Linux-installable) — this
 *     adapter only works from the host that runs the paseo daemon.
 *
 * CLI surface used (verified empirically):
 *   - `paseo run --detach --json --provider <id> --mode build --cwd <abs> --title <t> "<prompt>"`
 *     → JSON `{ "agentId": "...", "status": "created", ... }`.
 *   - `paseo wait --timeout <s> --json <id>`
 *     → JSON `{ "agentId": "...", "status": "idle", "message": "..." }`.
 *   - `paseo logs <id> --filter text --tail <n>` (NOT JSON-emitting)
 *     → plain text in the form
 *         [User] <prompt>
 *         <assistant text>
 *         [Thought] <reasoning>
 *   - `paseo logs <id> --follow --filter text` for streaming text.
 *   - `paseo send <id> "<msg>"` blocks until the agent is idle (default).
 *   - `paseo inspect <id> --json` returns metadata only — does NOT include
 *     conversation text. Do not use it to extract output.
 *   - `paseo delete <id>` for teardown (no `--force` flag).
 *
 * Protocol contract with the lead agent:
 *   - The lead prompt instructs the lead to emit, on its own line, markers
 *     of the form:
 *         WORKER_REQUEST: <roleId> :: <one-line instructions>
 *     once for each non-lead role in dispatch order, BEFORE going idle.
 *   - The lead's final summary, after orchestrator sends a SUMMARIZE message,
 *     is delivered as the agent's last assistant text and surfaced as a
 *     `lead_message` event with payload `{ kind: "summary", markdown }`.
 */
export interface PaseoOpenCodeAdapterOptions {
  paseoBin?: string;
  /** Paseo provider/model string. Defaults to opencode/minimax-m2.5-free. */
  provider?: string;
  /** Working directory passed to paseo as --cwd (must be absolute). */
  workspaceCwd?: string;
  /** Override exec/spawn for tests. */
  runner?: ProcessRunner;
  /** Optional thinking flag value. */
  thinking?: string;
  /** Defaults to "build" — the mode opencode-provider expects. */
  mode?: string;
  /** Per-agent wait timeout in seconds. */
  waitTimeoutSec?: number;
  /** Tail size when reading agent logs. */
  logsTail?: number;
  /** ms to give a follow stream to drain before disposing. */
  followDrainMs?: number;
  /** Delete agents in endRun (default true). */
  deleteAgentsOnEnd?: boolean;
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
  /** First-text-line cursor per worker so we can attribute the assistant turn. */
  workerLogCursors: Map<string, number>;
}

const WORKER_REQUEST_RE = /^WORKER_REQUEST:\s*([a-zA-Z0-9_-]+)\s*::\s*(.*)$/;

export class PaseoOpenCodeAdapter implements PaseoTeamAdapter {
  private readonly bin: string;
  private readonly provider: string;
  private readonly workspaceCwd?: string;
  private readonly runner: ProcessRunner;
  private readonly thinking?: string;
  private readonly mode: string;
  private readonly waitTimeoutSec: number;
  private readonly logsTail: number;
  private readonly followDrainMs: number;
  private readonly deleteAgentsOnEnd: boolean;
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
    this.mode = opts.mode ?? "build";
    this.waitTimeoutSec = opts.waitTimeoutSec ?? 180;
    this.logsTail = opts.logsTail ?? 200;
    this.followDrainMs = opts.followDrainMs ?? 250;
    this.deleteAgentsOnEnd = opts.deleteAgentsOnEnd ?? true;
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
      workerLogCursors: new Map(),
    });
  }

  async createLeadSession(input: {
    runId: string;
    task: TeamTask;
    role: AgentRoleConfig;
  }): Promise<AgentSession> {
    const run = this.expectRun(input.runId);
    const prompt = this.buildLeadPrompt(input.task, input.role, run.team);
    const args = this.runArgs({ title: `Pluto MVP-alpha Lead [${input.runId}]` });
    const result = await this.runner.exec(this.bin, [...args, prompt], {
      cwd: this.runCwd(run),
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
      payload: { provider: this.provider, paseoAgentId: agentId, mode: this.mode },
    });

    // Subscribe to the lead's text stream and translate WORKER_REQUEST markers.
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
      cwd: this.runCwd(run),
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

    const wait = await this.runner.exec(
      this.bin,
      ["wait", agentId, "--timeout", String(this.waitTimeoutSec), "--json"],
      { cwd: this.runCwd(run) },
    );
    if (wait.exitCode !== 0) {
      throw new Error(
        `paseo_worker_wait_failed:${input.role.id} exit=${wait.exitCode} stderr=${wait.stderr.slice(0, 400)}`,
      );
    }
    const output = await this.fetchAgentText(agentId, run);

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
    // Default `paseo send` blocks until the agent is idle. That's exactly the
    // behavior we want for SUMMARIZE — the lead must produce its final reply
    // before we read it.
    //
    // We collapse newlines into " | " so `paseo logs --filter text` renders
    // the operator turn as a single `[User] …` line. Without this, the
    // assistant-text extractor can't tell where multi-line user message body
    // ends and assistant text begins (paseo only tags `[User]` / `[Thought]`,
    // not assistant turns).
    const wireMessage = input.message.replace(/\r?\n+/g, " | ");
    const result = await this.runner.exec(
      this.bin,
      ["send", input.sessionId, wireMessage],
      { cwd: this.runCwd(run) },
    );
    if (result.exitCode !== 0) {
      throw new Error(
        `paseo_send_failed: exit=${result.exitCode} stderr=${result.stderr.slice(0, 400)}`,
      );
    }
    if (input.message.includes("SUMMARIZE")) {
      // Belt-and-suspenders: also explicitly wait, in case `send` returned
      // before the streaming completion landed.
      await this.runner.exec(
        this.bin,
        ["wait", input.sessionId, "--timeout", String(this.waitTimeoutSec), "--json"],
        { cwd: this.runCwd(run) },
      );
      const markdown = await this.fetchAgentText(input.sessionId, run);
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
    if (this.deleteAgentsOnEnd) {
      const ids = [run.leadAgentId, ...run.workerAgentIds.values()].filter(
        (x): x is string => Boolean(x),
      );
      for (const id of ids) {
        await this.runner
          .exec(this.bin, ["delete", id], { cwd: this.runCwd(run) })
          .catch(() => undefined);
      }
    }
  }

  // ---------- helpers ----------

  private runCwd(run: RunState): string {
    return this.workspaceCwd ?? run.task.workspacePath;
  }

  private runArgs(opts: { title: string }): string[] {
    const args = [
      "run",
      "--detach",
      "--json",
      "--provider",
      this.provider,
      "--mode",
      this.mode,
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
        if (typeof parsed.agentId === "string") return parsed.agentId;
        if (typeof parsed.id === "string") return parsed.id;
        if (typeof parsed.Id === "string") return parsed.Id;
      }
    } catch {
      /* fall through */
    }
    const m = trimmed.match(/"(?:agentId|id|Id)"\s*:\s*"([^"]+)"/);
    return m ? m[1] : undefined;
  }

  /**
   * Read the agent's most recent assistant text via `paseo logs --filter text`.
   * The CLI emits plain text in the format:
   *   [User] <prompt>
   *   <assistant text...>
   *   [Thought] <reasoning>
   *
   * We strip lines that start with `[Tag]` and keep the rest. If multiple
   * user/assistant turns exist, we slice from the LAST `[User] ...` marker.
   */
  private async fetchAgentText(agentId: string, run: RunState): Promise<string> {
    const result = await this.runner.exec(
      this.bin,
      ["logs", agentId, "--filter", "text", "--tail", String(this.logsTail)],
      { cwd: this.runCwd(run) },
    );
    if (result.exitCode !== 0) {
      throw new Error(
        `paseo_logs_failed:${agentId} exit=${result.exitCode} stderr=${result.stderr.slice(0, 400)}`,
      );
    }
    return PaseoOpenCodeAdapter.extractAssistantTextFromLogs(result.stdout);
  }

  static extractAssistantTextFromLogs(rawLogs: string): string {
    const lines = rawLogs.split(/\r?\n/);
    // Find the index of the last [User] line; assistant text is after it.
    let lastUserIdx = -1;
    for (let i = lines.length - 1; i >= 0; i--) {
      if (lines[i]?.startsWith("[User]")) {
        lastUserIdx = i;
        break;
      }
    }
    const slice = lastUserIdx >= 0 ? lines.slice(lastUserIdx + 1) : lines;
    const kept: string[] = [];
    for (const line of slice) {
      if (/^\[[A-Za-z][^\]]*\]/.test(line)) continue; // drop [User], [Thought], [Tool], …
      kept.push(line);
    }
    // Trim trailing blank lines without collapsing meaningful blanks inside.
    while (kept.length > 0 && kept[kept.length - 1]!.trim().length === 0) {
      kept.pop();
    }
    return kept.join("\n").trimStart();
  }

  private onLeadLogLine(runId: string, leadId: string, raw: string) {
    // `paseo logs --follow --filter text` emits plain text lines, NOT JSON.
    // We still defensively try JSON-shaped lines.
    let text = raw;
    try {
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === "object" && typeof parsed.text === "string") {
        text = parsed.text;
      }
    } catch {
      /* keep raw */
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
      "PROTOCOL — read carefully:",
      "1. Do NOT do the workers' jobs yourself.",
      "2. Emit one line per worker you want dispatched, in EXACTLY this format",
      "   (no surrounding code fences, no JSON, one line per worker):",
      "       WORKER_REQUEST: <roleId> :: <one-line instructions>",
      `3. Dispatch order MUST be: ${workerRoles.map((r) => r.id).join(", ")}.`,
      "4. After emitting all WORKER_REQUEST lines, STOP. Do not produce a",
      "   summary yet. The orchestrator will reply with a 'SUMMARIZE' message.",
      "5. When SUMMARIZE arrives, reply with the final markdown artifact:",
      "   include each worker role by name and their contribution.",
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
      "Instructions from the Team Lead:",
      instructions,
      "",
      "Reply with your contribution only. Keep it concise (under 15 lines).",
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
