import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { DEFAULT_TEAM } from "@/orchestrator/team-config.js";
import { RunStore } from "@/orchestrator/run-store.js";
import { TeamRunService } from "@/orchestrator/team-run-service.js";
import { FakeAdapter } from "@/adapters/fake/index.js";
import type {
  AgentEvent,
  AgentEventType,
  AgentRoleConfig,
  AgentSession,
  TeamConfig,
  TeamTask,
} from "@/contracts/types.js";
import type { PaseoTeamAdapter } from "@/contracts/adapter.js";

let workDir: string;

beforeEach(async () => {
  workDir = await mkdtemp(join(tmpdir(), "pluto-recovery-test-"));
});

afterEach(async () => {
  await rm(workDir, { recursive: true, force: true });
});

const buildTask = (id: string): TeamTask => ({
  id,
  title: `Recovery test ${id}`,
  prompt: "Test recovery behavior",
  workspacePath: workDir,
  minWorkers: 2,
});

class FailOnceAdapter implements PaseoTeamAdapter {
  private events: AgentEvent[] = [];
  private cursor = 0;
  private runId = "";
  private team!: TeamConfig;
  private failureCount = new Map<string, number>();
  private readonly failRole: string;
  private readonly failMessage: string;
  private readonly failTimes: number;

  constructor(opts: { failRole: string; failMessage: string; failTimes?: number }) {
    this.failRole = opts.failRole;
    this.failMessage = opts.failMessage;
    this.failTimes = opts.failTimes ?? 1;
  }

  async startRun(input: { runId: string; task: TeamTask; team: TeamConfig }): Promise<void> {
    this.runId = input.runId;
    this.team = input.team;
  }

  async createLeadSession(input: {
    runId: string;
    task: TeamTask;
    role: AgentRoleConfig;
  }): Promise<AgentSession> {
    const sessionId = "lead-session";
    this.events.push(
      this.event("lead_started", input.role.id, sessionId, { provider: "test" }),
    );
    const workerRoles = this.team.roles.filter((r) => r.kind === "worker");
    for (const wr of workerRoles) {
      this.events.push(
        this.event("worker_requested", wr.id, sessionId, {
          targetRole: wr.id,
          instructions: `Work on: ${input.task.prompt}`,
        }),
      );
    }
    return { sessionId, role: input.role };
  }

  async createWorkerSession(input: {
    runId: string;
    role: AgentRoleConfig;
    instructions: string;
  }): Promise<AgentSession> {
    const sessionId = `${input.role.id}-session`;
    const count = this.failureCount.get(input.role.id) ?? 0;

    if (input.role.id === this.failRole && count < this.failTimes) {
      this.failureCount.set(input.role.id, count + 1);
      throw new Error(this.failMessage);
    }

    this.events.push(
      this.event("worker_started", input.role.id, sessionId, { instructions: input.instructions }),
      this.event("worker_completed", input.role.id, sessionId, {
        output: `contribution from ${input.role.id}`,
      }),
    );
    return { sessionId, role: input.role };
  }

  async sendMessage(input: { runId: string; sessionId: string; message: string }): Promise<void> {
    this.events.push(
      this.event("lead_message", this.team.leadRoleId, "lead-session", {
        kind: "summary",
        markdown: "# Summary\nhello from lead\nhello from planner\nhello from generator\nhello from evaluator",
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
    type: AgentEventType,
    roleId: string | undefined,
    sessionId: string,
    payload: Record<string, unknown>,
  ): AgentEvent {
    return {
      id: `${type}-${this.events.length}`,
      runId: this.runId,
      ts: new Date().toISOString(),
      type,
      ...(roleId ? { roleId: roleId as AgentEvent["roleId"] } : {}),
      sessionId,
      payload,
    };
  }
}

describe("TeamRunService recovery — retry semantics", () => {
  it("retries a retryable reason (provider_unavailable) then succeeds", async () => {
    const adapter = new FailOnceAdapter({
      failRole: "planner",
      failMessage: "ECONNREFUSED: connection refused",
      failTimes: 1,
    });
    const store = new RunStore({ dataDir: join(workDir, ".pluto") });
    const service = new TeamRunService({
      adapter,
      team: DEFAULT_TEAM,
      store,
      pumpIntervalMs: 1,
      timeoutMs: 5_000,
      maxRetries: 1,
    });

    const result = await service.run(buildTask("retry-success"));
    expect(result.status).toBe("completed");

    const eventsRaw = await readFile(
      join(workDir, ".pluto", "runs", result.runId, "events.jsonl"),
      "utf8",
    );
    expect(eventsRaw).toContain('"retry"');
    const events = eventsRaw.trim().split("\n").map((l) => JSON.parse(l));
    const retryEvents = events.filter((e: { type: string }) => e.type === "retry");
    expect(retryEvents.length).toBeGreaterThanOrEqual(1);
    expect(retryEvents[0].payload.reason).toBe("provider_unavailable");
    expect(retryEvents[0].payload.attempt).toBe(2);

    const retriedWorkerEvents = events.filter(
      (e: { type: string; roleId?: string }) =>
        e.roleId === "planner" && ["worker_started", "worker_completed"].includes(e.type),
    );
    expect(retriedWorkerEvents).toHaveLength(2);
    expect(retriedWorkerEvents.map((e: { payload: { attempt?: number } }) => e.payload.attempt)).toEqual([2, 2]);
  });

  it("retries a retryable reason (runtime_timeout) then re-fails", async () => {
    const adapter = new FailOnceAdapter({
      failRole: "generator",
      failMessage: "worker timed_out",
      failTimes: 5,
    });
    const store = new RunStore({ dataDir: join(workDir, ".pluto") });
    const service = new TeamRunService({
      adapter,
      team: DEFAULT_TEAM,
      store,
      pumpIntervalMs: 1,
      timeoutMs: 5_000,
      maxRetries: 1,
    });

    const result = await service.run(buildTask("retry-refail"));
    expect(result.status).toBe("failed");
    expect(result.blockerReason).toBe("runtime_timeout");

    const eventsRaw = await readFile(
      join(workDir, ".pluto", "runs", result.runId, "events.jsonl"),
      "utf8",
    );
    expect(eventsRaw).toContain('"retry"');
    expect(eventsRaw).toContain('"blocker"');
  });

  it("does not retry a non-retryable reason (quota_exceeded)", async () => {
    const adapter = new FailOnceAdapter({
      failRole: "planner",
      failMessage: "429 rate limit exceeded",
      failTimes: 1,
    });
    const store = new RunStore({ dataDir: join(workDir, ".pluto") });
    const service = new TeamRunService({
      adapter,
      team: DEFAULT_TEAM,
      store,
      pumpIntervalMs: 1,
      timeoutMs: 5_000,
      maxRetries: 1,
    });

    const result = await service.run(buildTask("no-retry"));
    expect(result.status).toBe("failed");
    expect(result.blockerReason).toBe("quota_exceeded");

    const eventsRaw = await readFile(
      join(workDir, ".pluto", "runs", result.runId, "events.jsonl"),
      "utf8",
    );
    expect(eventsRaw).not.toContain('"retry"');
    expect(eventsRaw).toContain('"blocker"');
  });

  it("honors --max-retries 0 (no retry at all)", async () => {
    const adapter = new FailOnceAdapter({
      failRole: "planner",
      failMessage: "ECONNREFUSED: connection refused",
      failTimes: 1,
    });
    const store = new RunStore({ dataDir: join(workDir, ".pluto") });
    const service = new TeamRunService({
      adapter,
      team: DEFAULT_TEAM,
      store,
      pumpIntervalMs: 1,
      timeoutMs: 5_000,
      maxRetries: 0,
    });

    const result = await service.run(buildTask("no-retry-0"));
    expect(result.status).toBe("failed");

    const eventsRaw = await readFile(
      join(workDir, ".pluto", "runs", result.runId, "events.jsonl"),
      "utf8",
    );
    expect(eventsRaw).not.toContain('"retry"');
  });

  it("enforces hard cap of 3 retries", async () => {
    const adapter = new FailOnceAdapter({
      failRole: "planner",
      failMessage: "ECONNREFUSED: connection refused",
      failTimes: 100,
    });
    const store = new RunStore({ dataDir: join(workDir, ".pluto") });
    const service = new TeamRunService({
      adapter,
      team: DEFAULT_TEAM,
      store,
      pumpIntervalMs: 1,
      timeoutMs: 5_000,
      maxRetries: 10,
    });

    const result = await service.run(buildTask("hard-cap"));
    expect(result.status).toBe("failed");

    const eventsRaw = await readFile(
      join(workDir, ".pluto", "runs", result.runId, "events.jsonl"),
      "utf8",
    );
    const events = eventsRaw.trim().split("\n").map((l) => JSON.parse(l));
    const retryEvents = events.filter((e: { type: string }) => e.type === "retry");
    expect(retryEvents.length).toBeLessThanOrEqual(3);
  });

  it("does not mutate prior events when a retry occurs", async () => {
    const adapter = new FailOnceAdapter({
      failRole: "planner",
      failMessage: "ECONNREFUSED: connection refused",
      failTimes: 1,
    });
    const store = new RunStore({ dataDir: join(workDir, ".pluto") });
    const service = new TeamRunService({
      adapter,
      team: DEFAULT_TEAM,
      store,
      pumpIntervalMs: 1,
      timeoutMs: 5_000,
      maxRetries: 1,
    });

    const result = await service.run(buildTask("no-mutate"));
    expect(result.status).toBe("completed");

    const eventsRaw = await readFile(
      join(workDir, ".pluto", "runs", result.runId, "events.jsonl"),
      "utf8",
    );
    const lines = eventsRaw.trim().split("\n");
    const ids = new Set<string>();
    for (const line of lines) {
      const ev = JSON.parse(line);
      expect(ids.has(ev.id)).toBe(false);
      ids.add(ev.id);
    }
    expect(ids.size).toBe(lines.length);
  });

  it("classifies evaluator FAIL output as validation_failed blocker without run_completed", async () => {
    const adapter = new FakeAdapter({
      team: DEFAULT_TEAM,
      workerOutputs: {
        evaluator: "FAIL: artifact misses required acceptance criteria",
      },
    });
    const store = new RunStore({ dataDir: join(workDir, ".pluto-validation") });
    const service = new TeamRunService({
      adapter,
      team: DEFAULT_TEAM,
      store,
      pumpIntervalMs: 1,
      timeoutMs: 5_000,
    });

    const result = await service.run(buildTask("validation-fail"));
    expect(result.status).toBe("failed");
    expect(result.blockerReason).toBe("validation_failed");

    const eventsRaw = await readFile(
      join(workDir, ".pluto-validation", "runs", result.runId, "events.jsonl"),
      "utf8",
    );
    const events = eventsRaw.trim().split("\n").map((l) => JSON.parse(l));
    expect(events.some((e: { type: string }) => e.type === "run_completed")).toBe(false);
    const blocker = events.find((e: { type: string }) => e.type === "blocker");
    expect(blocker.payload.reason).toBe("validation_failed");

    const evidenceRaw = await readFile(
      join(workDir, ".pluto-validation", "runs", result.runId, "evidence.json"),
      "utf8",
    );
    const evidence = JSON.parse(evidenceRaw);
    expect(evidence.status).toBe("blocked");
    expect(evidence.blockerReason).toBe("validation_failed");
    expect(evidence.validation.outcome).toBe("fail");
  });

  it("redacts evaluator FAIL secrets and task prompt secrets before persisting evidence JSON", async () => {
    const adapter = new FakeAdapter({
      team: DEFAULT_TEAM,
      workerOutputs: {
        evaluator: "FAIL: leaked EVAL_SECRET=eval-secret-value and RISK_TOKEN=risk-secret-value",
      },
    });
    const store = new RunStore({ dataDir: join(workDir, ".pluto-redaction") });
    const service = new TeamRunService({
      adapter,
      team: DEFAULT_TEAM,
      store,
      pumpIntervalMs: 1,
      timeoutMs: 5_000,
    });

    const task = buildTask("redaction-fail");
    task.prompt = "Do not leak PROMPT_SECRET=prompt-secret-value";
    const result = await service.run(task);

    const evidenceRaw = await readFile(
      join(workDir, ".pluto-redaction", "runs", result.runId, "evidence.json"),
      "utf8",
    );
    expect(evidenceRaw).not.toContain("eval-secret-value");
    expect(evidenceRaw).not.toContain("risk-secret-value");
    expect(evidenceRaw).not.toContain("prompt-secret-value");
    expect(evidenceRaw).toContain("[REDACTED]");
  });

  it("produces evidence packet for both done and failed runs", async () => {
    const successAdapter = new FailOnceAdapter({
      failRole: "planner",
      failMessage: "ECONNREFUSED: connection refused",
      failTimes: 0,
    });
    const store1 = new RunStore({ dataDir: join(workDir, ".pluto-s") });
    const svc1 = new TeamRunService({
      adapter: successAdapter,
      team: DEFAULT_TEAM,
      store: store1,
      pumpIntervalMs: 1,
      timeoutMs: 5_000,
    });

    const doneResult = await svc1.run(buildTask("evidence-done"));
    expect(doneResult.status).toBe("completed");
    const doneEvidence = await readFile(
      join(workDir, ".pluto-s", "runs", doneResult.runId, "evidence.json"),
      "utf8",
    );
    const doneParsed = JSON.parse(doneEvidence);
    expect(doneParsed.status).toBe("done");
    expect(doneParsed.schemaVersion).toBe(0);

    const failAdapter = new FailOnceAdapter({
      failRole: "planner",
      failMessage: "429 rate limit exceeded",
      failTimes: 5,
    });
    const store2 = new RunStore({ dataDir: join(workDir, ".pluto-f") });
    const svc2 = new TeamRunService({
      adapter: failAdapter,
      team: DEFAULT_TEAM,
      store: store2,
      pumpIntervalMs: 1,
      timeoutMs: 5_000,
      maxRetries: 0,
    });

    const failResult = await svc2.run(buildTask("evidence-fail"));
    expect(failResult.status).toBe("failed");
    const failEvidence = await readFile(
      join(workDir, ".pluto-f", "runs", failResult.runId, "evidence.json"),
      "utf8",
    );
    const failParsed = JSON.parse(failEvidence);
    expect(failParsed.status).toBe("blocked");
    expect(failParsed.blockerReason).toBe("quota_exceeded");
  });
});
