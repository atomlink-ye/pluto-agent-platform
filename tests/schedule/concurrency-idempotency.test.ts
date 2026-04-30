import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { dispatchScheduleFire } from "@/schedule/dispatcher.js";
import { SCHEDULE_BLOCKER_REASONS_V0 } from "@/schedule/evaluator.js";
import { ScheduleStore } from "@/schedule/schedule-store.js";

describe("schedule concurrency and idempotency", () => {
  let dataDir = "";

  afterEach(async () => {
    if (dataDir) {
      await rm(dataDir, { recursive: true, force: true });
    }
  });

  it("deduplicates repeat dispatches for the same fire key", async () => {
    dataDir = await mkdtemp(join(tmpdir(), "pluto-schedule-idempotency-"));
    const store = new ScheduleStore({ dataDir });
    await seedActiveScheduleGraph(store);

    const first = await dispatchScheduleFire({
      store,
      dataDir,
      scheduleId: "schedule-1",
      triggerId: "trigger-1",
      triggerKind: "cron",
      expectedAt: "2026-04-30T00:05:00.000Z",
      decidedAt: "2026-04-30T00:05:05.000Z",
      compatibility: enabledCompatibility(),
    });
    const second = await dispatchScheduleFire({
      store,
      dataDir,
      scheduleId: "schedule-1",
      triggerId: "trigger-1",
      triggerKind: "cron",
      expectedAt: "2026-04-30T00:05:00.000Z",
      decidedAt: "2026-04-30T00:05:06.000Z",
      compatibility: enabledCompatibility(),
    });

    expect(first.status).toBe("allowed");
    expect(second.status).toBe("duplicate");
    expect(second.duplicate).toBe(true);
    expect(second.fireRecord.id).toBe(first.fireRecord.id);
    expect(await store.list("fire_record")).toHaveLength(1);
  });

  it("suppresses a second active fire when max concurrency is one", async () => {
    dataDir = await mkdtemp(join(tmpdir(), "pluto-schedule-concurrency-"));
    const store = new ScheduleStore({ dataDir });
    await seedActiveScheduleGraph(store);
    await store.put("fire_record", {
      schemaVersion: 0,
      kind: "fire_record",
      id: "existing-fire",
      workspaceId: "workspace-1",
      scheduleId: "schedule-1",
      triggerId: "trigger-1",
      runId: "run-existing",
      firedAt: "2026-04-30T00:04:00.000Z",
      createdAt: "2026-04-30T00:04:00.000Z",
      updatedAt: "2026-04-30T00:04:00.000Z",
      status: "running",
    });

    const result = await dispatchScheduleFire({
      store,
      dataDir,
      scheduleId: "schedule-1",
      triggerId: "trigger-1",
      triggerKind: "cron",
      expectedAt: "2026-04-30T00:05:00.000Z",
      decidedAt: "2026-04-30T00:05:05.000Z",
      compatibility: enabledCompatibility(),
    });

    expect(result.status).toBe("blocked");
    expect(result.reason).toBe(SCHEDULE_BLOCKER_REASONS_V0.concurrencyLimitReached);
    expect(result.missedRun?.reason).toBe(SCHEDULE_BLOCKER_REASONS_V0.concurrencyLimitReached);
    expect(await store.list("fire_record")).toHaveLength(2);
  });
});

function enabledCompatibility() {
  return {
    runtimeCapabilityAvailable: true,
    approvalSatisfied: true,
    policyAllowed: true,
    budgetAllowed: true,
  };
}

async function seedActiveScheduleGraph(store: ScheduleStore): Promise<void> {
  await store.put("schedule", {
    schemaVersion: 0,
    kind: "schedule",
    id: "schedule-1",
    workspaceId: "workspace-1",
    playbookId: "playbook-1",
    scenarioId: "scenario-1",
    ownerId: "owner-1",
    cadence: "0 * * * *",
    status: "active",
    createdAt: "2026-04-30T00:00:00.000Z",
    updatedAt: "2026-04-30T00:00:00.000Z",
  });
  await store.put("trigger", {
    schemaVersion: 0,
    kind: "trigger",
    id: "trigger-1",
    workspaceId: "workspace-1",
    scheduleId: "schedule-1",
    createdAt: "2026-04-30T00:00:00.000Z",
    updatedAt: "2026-04-30T00:00:00.000Z",
    status: "active",
    lastFiredAt: null,
    lastRunId: null,
  });
  await store.put("subscription", {
    schemaVersion: 0,
    kind: "subscription",
    id: "subscription-1",
    workspaceId: "workspace-1",
    scheduleId: "schedule-1",
    createdAt: "2026-04-30T00:00:00.000Z",
    updatedAt: "2026-04-30T00:00:00.000Z",
    status: "active",
    subscriberKind: "run_queue",
    subscriberId: "queue-1",
  });
}
