import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { PaseoTeamAdapter } from "@/contracts/adapter.js";
import type { AgentEvent, AgentRoleConfig, AgentSession, TeamConfig, TeamTask } from "@/contracts/types.js";
import { RunStore } from "@/orchestrator/run-store.js";
import { DEFAULT_TEAM } from "@/orchestrator/team-config.js";
import { TeamRunService } from "@/orchestrator/team-run-service.js";
import { buildPortableRuntimeResultValueRefV0 } from "@/runtime/index.js";

let workDir: string;

beforeEach(async () => {
  workDir = await mkdtemp(join(tmpdir(), "pluto-result-handoff-test-"));
});

afterEach(async () => {
  await rm(workDir, { recursive: true, force: true });
});

const buildTask = (id: string): TeamTask => ({
  id,
  title: `Hello team ${id}`,
  prompt: "Produce a hello-team markdown artifact.",
  workspacePath: workDir,
  minWorkers: 2,
  orchestrationMode: "lead_marker",
});

class ReferenceFirstAdapter implements PaseoTeamAdapter {
  private events: AgentEvent[] = [];
  private cursor = 0;
  private runId = "";
  private team!: TeamConfig;

  async startRun(input: { runId: string; task: TeamTask; team: TeamConfig }): Promise<void> {
    this.runId = input.runId;
    this.team = input.team;
  }

  async createLeadSession(input: {
    runId: string;
    task: TeamTask;
    role: AgentRoleConfig;
  }): Promise<AgentSession> {
    this.events.push(
      this.event("lead_started", input.role.id, "lead-session", { provider: "test" }),
      this.event("worker_requested", "planner", "lead-session", {
        targetRole: "planner",
        instructions: "Plan with references only.",
      }),
      this.event("worker_requested", "generator", "lead-session", {
        targetRole: "generator",
        instructions: "Generate with references only.",
      }),
      this.event("worker_requested", "evaluator", "lead-session", {
        targetRole: "evaluator",
        instructions: "Evaluate with references only.",
      }),
    );
    return { sessionId: "lead-session", role: input.role };
  }

  async createWorkerSession(input: {
    runId: string;
    role: AgentRoleConfig;
    instructions: string;
  }): Promise<AgentSession> {
    const sessionId = `${input.role.id}-session`;
    const completed = this.event("worker_completed", input.role.id, sessionId, { attempt: 1 }, {
      output: input.role.id === "evaluator"
        ? "PASS: reference-first worker evidence is supported."
        : `${input.role.id} provider token [REDACTED]`,
    });
    completed.payload = {
      attempt: 1,
      outputRef: buildPortableRuntimeResultValueRefV0(completed, "output"),
    };

    this.events.push(
      this.event("worker_started", input.role.id, sessionId, { instructions: input.instructions, attempt: 1 }),
      completed,
    );
    return { sessionId, role: input.role };
  }

  async sendMessage(input: { runId: string; sessionId: string; message: string }): Promise<void> {
    void input;
    const summary = this.event("lead_message", this.team.leadRoleId, "lead-session", { kind: "summary" }, {
      markdown: "hello from lead\nplanner: done\ngenerator: done\nevaluator: done",
    });
    summary.payload = {
      kind: "summary",
      markdownRef: buildPortableRuntimeResultValueRefV0(summary, "markdown"),
    };
    this.events.push(summary);
  }

  async readEvents(): Promise<AgentEvent[]> {
    const next = this.events.slice(this.cursor);
    this.cursor = this.events.length;
    return next;
  }

  async waitForCompletion(): Promise<AgentEvent[]> {
    return this.readEvents();
  }

  async endRun(): Promise<void> {}

  private event(
    type: AgentEvent["type"],
    roleId: AgentEvent["roleId"],
    sessionId: string,
    payload: Record<string, unknown>,
    rawPayload?: Record<string, unknown>,
  ): AgentEvent {
    return {
      id: `${type}-${this.events.length}`,
      runId: this.runId,
      ts: new Date().toISOString(),
      type,
      roleId,
      sessionId,
      payload,
      ...(rawPayload ? { transient: { rawPayload } } : {}),
    };
  }
}

describe("runtime result handoff", () => {
  it("feeds evidence generation from refs without persisting raw provider payloads", async () => {
    const store = new RunStore({ dataDir: join(workDir, ".pluto") });
    const service = new TeamRunService({
      adapter: new ReferenceFirstAdapter(),
      team: DEFAULT_TEAM,
      store,
      pumpIntervalMs: 1,
      timeoutMs: 5_000,
    });

    const result = await service.run(buildTask("t-ref-first"));
    const evidenceRaw = await readFile(join(workDir, ".pluto", "runs", result.runId, "evidence.json"), "utf8");
    const eventsRaw = await readFile(join(workDir, ".pluto", "runs", result.runId, "events.jsonl"), "utf8");
    const evidence = JSON.parse(evidenceRaw) as { runtimeResultRefs?: unknown[]; validation: { reason: string | null } };
    const plannerEvent = result.events.find((event) => event.type === "worker_completed" && event.roleId === "planner");
    const evaluatorEvent = result.events.find((event) => event.type === "worker_completed" && event.roleId === "evaluator");

    expect(result.status).toBe("completed");
    expect(result.artifact?.markdown).toContain("planner: done");
    expect(result.runtimeResultRefs?.length).toBeGreaterThan(0);
    expect(result.runtimeResultRefs?.some((ref) => ref.kind === "value" && ref.valueKey === "output")).toBe(true);
    expect(result.runtimeResultRefs?.some((ref) => ref.kind === "value" && ref.valueKey === "markdown")).toBe(true);
    expect(evidence.runtimeResultRefs?.length).toBeGreaterThan(0);
    expect(evidence.validation.reason).toBe("reference-first worker evidence is supported.");
    expect(plannerEvent?.payload["output"]).toBeUndefined();
    expect(evaluatorEvent?.payload["output"]).toBeUndefined();
    expect(evidenceRaw).not.toContain("rawPayload");
    expect(evidenceRaw).not.toContain("[REDACTED]");
    expect(eventsRaw).not.toContain("rawPayload");
    expect(eventsRaw).not.toContain("[REDACTED]");
    expect(eventsRaw).toContain("outputRef");
    expect(eventsRaw).toContain("markdownRef");
  });
});
