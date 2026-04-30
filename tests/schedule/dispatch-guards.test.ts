import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { dispatchScheduleFire } from "@/schedule/dispatcher.js";
import { SCHEDULE_BLOCKER_REASONS_V0 } from "@/schedule/evaluator.js";
import { ScheduleStore } from "@/schedule/schedule-store.js";

describe("dispatchScheduleFire guards", () => {
  let dataDir = "";

  afterEach(async () => {
    if (dataDir) {
      await rm(dataDir, { recursive: true, force: true });
    }
  });

  it("creates queued run linkage for an allowed fire", async () => {
    dataDir = await mkdtemp(join(tmpdir(), "pluto-schedule-dispatch-"));
    const store = new ScheduleStore({ dataDir });
    await seedActiveScheduleGraph(store);

    const result = await dispatchScheduleFire({
      store,
      dataDir,
      scheduleId: "schedule-1",
      triggerId: "trigger-1",
      triggerKind: "cron",
      expectedAt: "2026-04-30T00:05:00.000Z",
      decidedAt: "2026-04-30T00:05:05.000Z",
      compatibility: {
        runtimeCapabilityAvailable: true,
        approvalSatisfied: true,
        policyAllowed: true,
        budgetAllowed: true,
      },
      runIdFactory: (fireKey) => `run-for-${fireKey}`,
    });

    const persistedTrigger = await store.get("trigger", "trigger-1");
    expect(result.status).toBe("allowed");
    expect(result.fireRecord.status).toBe("queued");
    expect(result.runSource).toEqual({
      runId: `run-for-${result.fireKey}`,
      status: "queued",
      blockerReason: null,
      finishedAt: null,
    });
    expect(result.missedRun).toBeNull();
    expect(persistedTrigger?.lastRunId).toBe(`run-for-${result.fireKey}`);
  });

  it("records a suppression and missed-run when policy seams fail closed", async () => {
    dataDir = await mkdtemp(join(tmpdir(), "pluto-schedule-dispatch-"));
    const store = new ScheduleStore({ dataDir });
    await seedActiveScheduleGraph(store);

    const result = await dispatchScheduleFire({
      store,
      dataDir,
      scheduleId: "schedule-1",
      triggerId: "trigger-1",
      triggerKind: "cron",
      expectedAt: "2026-04-30T00:05:00.000Z",
      decidedAt: "2026-04-30T00:05:05.000Z",
      compatibility: {
        runtimeCapabilityAvailable: true,
        approvalSatisfied: true,
        policyAllowed: false,
        budgetAllowed: true,
      },
    });

    expect(result.status).toBe("blocked");
    expect(result.reason).toBe(SCHEDULE_BLOCKER_REASONS_V0.policyBlocked);
    expect(result.fireRecord.status).toBe("blocked");
    expect(result.missedRun).toMatchObject({
      fireRecordId: result.fireKey,
      reason: SCHEDULE_BLOCKER_REASONS_V0.policyBlocked,
      status: "blocked",
    });
    expect(await store.list("fire_record")).toHaveLength(1);
    expect(await store.list("missed_run")).toHaveLength(1);
  });

  it.each([
    ["approval missing", { approvalSatisfied: false }, SCHEDULE_BLOCKER_REASONS_V0.approvalMissing],
    ["budget blocked", { budgetAllowed: false }, SCHEDULE_BLOCKER_REASONS_V0.budgetBlocked],
    ["runtime unavailable", { runtimeCapabilityAvailable: false }, SCHEDULE_BLOCKER_REASONS_V0.runtimeCapabilityUnavailable],
    ["outbound write blocked", { outboundWritesAllowed: false }, SCHEDULE_BLOCKER_REASONS_V0.outboundWriteBlocked],
  ])("suppresses dispatch when %s", async (_label, override, expectedReason) => {
    dataDir = await mkdtemp(join(tmpdir(), "pluto-schedule-dispatch-"));
    const store = new ScheduleStore({ dataDir });
    await seedActiveScheduleGraph(store);

    const result = await dispatchScheduleFire({
      store,
      dataDir,
      scheduleId: "schedule-1",
      triggerId: "trigger-1",
      triggerKind: "cron",
      expectedAt: "2026-04-30T00:07:00.000Z",
      decidedAt: "2026-04-30T00:07:05.000Z",
      compatibility: {
        ...enabledCompatibility(),
        ...override,
      },
    });

    expect(result.status).toBe("blocked");
    expect(result.reason).toBe(expectedReason);
    expect(result.fireRecord.status).toBe("blocked");
    expect(result.missedRun?.reason).toBe(expectedReason);
  });

  it("deduplicates repeat dispatches for the same fire key", async () => {
    dataDir = await mkdtemp(join(tmpdir(), "pluto-schedule-dispatch-"));
    const store = new ScheduleStore({ dataDir });
    await seedActiveScheduleGraph(store);

    const first = await dispatchScheduleFire({
      store,
      dataDir,
      scheduleId: "schedule-1",
      triggerId: "trigger-1",
      triggerKind: "cron",
      expectedAt: "2026-04-30T00:08:00.000Z",
      decidedAt: "2026-04-30T00:08:05.000Z",
      compatibility: enabledCompatibility(),
    });
    const second = await dispatchScheduleFire({
      store,
      dataDir,
      scheduleId: "schedule-1",
      triggerId: "trigger-1",
      triggerKind: "cron",
      expectedAt: "2026-04-30T00:08:00.000Z",
      decidedAt: "2026-04-30T00:08:06.000Z",
      compatibility: enabledCompatibility(),
    });

    expect(first.status).toBe("allowed");
    expect(second.status).toBe("duplicate");
    expect(second.duplicate).toBe(true);
    expect(second.fireRecord).toEqual(first.fireRecord);
    expect(await store.list("fire_record")).toHaveLength(1);
    expect(await store.list("missed_run")).toHaveLength(0);
  });

  it("records a synthetic concurrency block when the dispatch lease is already held", async () => {
    dataDir = await mkdtemp(join(tmpdir(), "pluto-schedule-dispatch-"));
    const store = new ScheduleStore({ dataDir });
    await seedActiveScheduleGraph(store);
    await mkdir(join(dataDir, "schedule", "local-v0", "concurrency", "schedule-1.lock"), { recursive: true });

    const result = await dispatchScheduleFire({
      store,
      dataDir,
      scheduleId: "schedule-1",
      triggerId: "trigger-1",
      triggerKind: "cron",
      expectedAt: "2026-04-30T00:09:00.000Z",
      decidedAt: "2026-04-30T00:09:05.000Z",
      compatibility: enabledCompatibility(),
    });

    expect(result.status).toBe("blocked");
    expect(result.reason).toBe(SCHEDULE_BLOCKER_REASONS_V0.concurrencyLimitReached);
    expect(result.auditEvent?.source.ref).toBe("schedule.concurrency");
    expect(result.fireRecord.status).toBe("blocked");
    expect(result.missedRun?.reason).toBe(SCHEDULE_BLOCKER_REASONS_V0.concurrencyLimitReached);
  });
});

function enabledCompatibility() {
  return {
    runtimeCapabilityAvailable: true,
    approvalSatisfied: true,
    policyAllowed: true,
    budgetAllowed: true,
    outboundWritesAllowed: true,
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
