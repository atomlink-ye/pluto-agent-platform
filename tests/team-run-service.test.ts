import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { FakeAdapter } from "@/adapters/fake/index.js";
import { DEFAULT_TEAM } from "@/orchestrator/team-config.js";
import { RunStore } from "@/orchestrator/run-store.js";
import { TeamRunService } from "@/orchestrator/team-run-service.js";
import type { AgentEvent, AgentRoleConfig, AgentSession, TeamConfig, TeamTask } from "@/contracts/types.js";
import type { PaseoTeamAdapter } from "@/contracts/adapter.js";

let workDir: string;

beforeEach(async () => {
  workDir = await mkdtemp(join(tmpdir(), "pluto-mvp-test-"));
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
});

class PlannerOnlyLeadAdapter implements PaseoTeamAdapter {
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
        instructions: "Planner only request from a stochastic lead.",
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
    this.events.push(
      this.event("worker_started", input.role.id, sessionId, { instructions: input.instructions }),
      this.event("worker_completed", input.role.id, sessionId, {
        output: `hello from ${input.role.id}`,
      }),
    );
    return { sessionId, role: input.role };
  }

  async sendMessage(input: { runId: string; sessionId: string; message: string }): Promise<void> {
    void input;
    this.events.push(
      this.event("lead_message", this.team.leadRoleId, "lead-session", {
        kind: "summary",
        markdown: "hello from lead\nhello from planner\nhello from generator\nhello from evaluator",
      }),
    );
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
  ): AgentEvent {
    return {
      id: `${type}-${this.events.length}`,
      runId: this.runId,
      ts: new Date().toISOString(),
      type,
      roleId,
      sessionId,
      payload,
    };
  }
}

describe("TeamRunService with FakeAdapter (E2E)", () => {
  it("dispatches at least 2 workers and writes a final artifact", async () => {
    const adapter = new FakeAdapter({ team: DEFAULT_TEAM });
    const store = new RunStore({ dataDir: join(workDir, ".pluto") });
    const service = new TeamRunService({
      adapter,
      team: DEFAULT_TEAM,
      store,
      pumpIntervalMs: 1,
      timeoutMs: 5_000,
    });

    const result = await service.run(buildTask("t-e2e-1"));

    expect(result.status).toBe("completed");
    expect(result.artifact).toBeDefined();
    const contributions = result.artifact!.contributions;
    expect(contributions.length).toBeGreaterThanOrEqual(2);
    const roles = new Set(contributions.map((c) => c.roleId));
    expect(roles.has("planner")).toBe(true);
    expect(roles.has("generator")).toBe(true);

    // events.jsonl persisted with the canonical event shape.
    const eventsRaw = await readFile(
      join(workDir, ".pluto", "runs", result.runId, "events.jsonl"),
      "utf8",
    );
    const eventTypes = eventsRaw
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line).type);
    expect(eventTypes).toContain("run_started");
    expect(eventTypes).toContain("lead_started");
    expect(eventTypes.filter((t) => t === "worker_started").length).toBeGreaterThanOrEqual(2);
    expect(eventTypes.filter((t) => t === "worker_completed").length).toBeGreaterThanOrEqual(2);
    expect(eventTypes).toContain("lead_message");
    expect(eventTypes).toContain("artifact_created");
    expect(eventTypes[eventTypes.length - 1]).toBe("run_completed");

    const parsedEvents = eventsRaw
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line));
    const generatorStarted = parsedEvents.find(
      (event) => event.type === "worker_started" && event.roleId === "generator",
    );
    expect(generatorStarted?.payload.catalogSelection).toMatchObject({
      entry: { id: "default-generator", version: "0.0.1" },
      workerRole: { id: "generator", version: "0.0.1" },
      skill: { id: "generate-artifact", version: "0.0.1" },
      template: { id: "generator-body", version: "0.0.1" },
      policyPack: { id: "default-guardrails", version: "0.0.1" },
    });

    // artifact.md exists and references each contributing role.
    const artifactMd = await readFile(
      join(workDir, ".pluto", "runs", result.runId, "artifact.md"),
      "utf8",
    );
    expect(artifactMd).toContain("planner");
    expect(artifactMd).toContain("generator");
    expect(artifactMd).toContain("evaluator");
  });

  it("falls back to dispatch missing workers when a live lead under-dispatches", async () => {
    const adapter = new PlannerOnlyLeadAdapter();
    const store = new RunStore({ dataDir: join(workDir, ".pluto") });
    const service = new TeamRunService({
      adapter,
      team: DEFAULT_TEAM,
      store,
      pumpIntervalMs: 1,
      timeoutMs: 250,
      underdispatchFallbackMs: 1,
    });

    const result = await service.run(buildTask("t-underdispatch-fallback"));

    expect(result.status).toBe("completed");
    const roles = result.artifact!.contributions.map((c) => c.roleId);
    expect(roles).toEqual(["planner", "generator", "evaluator"]);
    const eventsRaw = await readFile(
      join(workDir, ".pluto", "runs", result.runId, "events.jsonl"),
      "utf8",
    );
    expect(eventsRaw).toContain("orchestrator_underdispatch_fallback");
  });

  it("rejects tasks with minWorkers < 2", async () => {
    const adapter = new FakeAdapter({ team: DEFAULT_TEAM });
    const store = new RunStore({ dataDir: join(workDir, ".pluto") });
    const service = new TeamRunService({ adapter, team: DEFAULT_TEAM, store });
    await expect(
      service.run({ ...buildTask("t-bad"), minWorkers: 1 }),
    ).rejects.toThrow(/min_workers_too_low/);
  });

  it("records run_failed when adapter rejects createLeadSession", async () => {
    const adapter = new FakeAdapter({ team: DEFAULT_TEAM });
    // Force lead failure by manually altering the team's lead role kind.
    const brokenTeam = {
      ...DEFAULT_TEAM,
      roles: DEFAULT_TEAM.roles.map((r) =>
        r.id === DEFAULT_TEAM.leadRoleId ? { ...r, kind: "worker" as const } : r,
      ),
    };
    const store = new RunStore({ dataDir: join(workDir, ".pluto") });
    const service = new TeamRunService({
      adapter,
      team: brokenTeam,
      store,
      timeoutMs: 1_000,
      pumpIntervalMs: 1,
    });

    const result = await service.run(buildTask("t-fail"));
    expect(result.status).toBe("failed");
    expect(result.failure?.message).toMatch(/lead_role_kind_mismatch/);
    const eventsRaw = await readFile(
      join(workDir, ".pluto", "runs", result.runId, "events.jsonl"),
      "utf8",
    );
    expect(eventsRaw).toContain("run_failed");
  });

});
