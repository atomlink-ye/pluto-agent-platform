import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { FakeAdapter } from "@/adapters/fake/index.js";
import type { AgentEvent, TeamTask } from "@/contracts/types.js";
import { DEFAULT_TEAM, getRole } from "@/orchestrator/team-config.js";
import { RunStore } from "@/orchestrator/run-store.js";
import { TeamRunService } from "@/orchestrator/team-run-service.js";

let workDir: string;

const baseTask: TeamTask = {
  id: "fake-callback-task",
  title: "Fake callback normalization",
  prompt: "Produce a fake callback artifact.",
  workspacePath: "/tmp/pluto-fake-callbacks",
  minWorkers: 2,
};

beforeEach(async () => {
  workDir = await mkdtemp(join(tmpdir(), "pluto-fake-callbacks-"));
});

afterEach(async () => {
  await rm(workDir, { recursive: true, force: true });
});

describe("FakeAdapter callback identity", () => {
  it("emits stable callback metadata for adapter events", async () => {
    const adapter = new FakeAdapter({ team: DEFAULT_TEAM, idGen: sequenceId() });
    await adapter.startRun({ runId: "fake-run", task: baseTask, team: DEFAULT_TEAM });
    await adapter.createLeadSession({
      runId: "fake-run",
      task: baseTask,
      role: getRole(DEFAULT_TEAM, DEFAULT_TEAM.leadRoleId),
    });

    const events = await adapter.readEvents({ runId: "fake-run" });
    expect(events.every((event) => event.transient?.callback)).toBe(true);
    expect(events[0]?.transient?.callback?.source).toBe("fake_adapter");
    expect(events[1]?.transient?.callback?.batchId).toBe(events[2]?.transient?.callback?.batchId);
    expect(events[1]?.transient?.callback?.eventId).not.toBe(events[2]?.transient?.callback?.eventId);
  });

  it("dedupes replayed fake adapter batches before persistence and contribution accounting", async () => {
    const adapter = new ReplayOnceFakeAdapter({ team: DEFAULT_TEAM, idGen: sequenceId() });
    const store = new RunStore({ dataDir: join(workDir, ".pluto") });
    const service = new TeamRunService({
      adapter,
      team: DEFAULT_TEAM,
      store,
      pumpIntervalMs: 1,
      timeoutMs: 5_000,
      idGen: sequenceId("persisted"),
    });

    const result = await service.run({ ...baseTask, workspacePath: workDir });

    expect(result.status).toBe("completed");
    expect(result.artifact?.contributions.map((item) => item.roleId)).toEqual([
      "planner",
      "generator",
      "evaluator",
    ]);

    const eventsRaw = await readFile(
      join(workDir, ".pluto", "runs", result.runId, "events.jsonl"),
      "utf8",
    );
    const events: AgentEvent[] = eventsRaw.trim().split("\n").map((line) => JSON.parse(line));
    expect(events.filter((event) => event.type === "worker_requested")).toHaveLength(3);
    expect(events.filter((event) => event.type === "worker_completed")).toHaveLength(3);
    expect(events.filter((event) => event.type === "lead_message")).toHaveLength(1);
  });
});

class ReplayOnceFakeAdapter extends FakeAdapter {
  override async readEvents(input: { runId: string }): Promise<AgentEvent[]> {
    const batch = await super.readEvents(input);
    if (batch.length === 0) return batch;
    return [...batch, ...batch.map((event, index) => replayClone(event, `replayed-${index}`))];
  }
}

function replayClone(event: AgentEvent, suffix: string): AgentEvent {
  return {
    ...event,
    id: `${event.id}-${suffix}`,
    ts: "2026-04-30T00:00:01.000Z",
    transient: event.transient
      ? {
          ...event.transient,
          rawPayload: event.transient.rawPayload
            ? { ...event.transient.rawPayload }
            : undefined,
          callback: event.transient.callback
            ? { ...event.transient.callback }
            : undefined,
        }
      : undefined,
  };
}

function sequenceId(prefix = "id") {
  let counter = 0;
  return () => `${prefix}-${++counter}`;
}
