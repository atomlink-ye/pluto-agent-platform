import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type {
  MissedRunRecordV0,
  ScheduleFireRecordV0,
  ScheduleRecordV0,
  ScheduleSubscriptionRecordV0,
  ScheduleTriggerRecordV0,
} from "@/schedule/schedule-store.js";
import { SCHEDULE_STORE_KINDS_V0, createFileScheduleStore } from "@/schedule/schedule-store.js";

let dataDir: string;

beforeEach(async () => {
  dataDir = await mkdtemp(join(tmpdir(), "pluto-schedule-store-test-"));
});

afterEach(async () => {
  await rm(dataDir, { recursive: true, force: true });
});

function makeSchedule(): ScheduleRecordV0 {
  return {
    schema: "pluto.schedule",
    schemaVersion: 0,
    kind: "schedule",
    id: "schedule-1",
    workspaceId: "workspace-1",
    playbookRef: "playbook:playbook-1",
    scenarioRef: "scenario:scenario-1",
    ownerRef: "user:owner-1",
    triggerRefs: ["trigger-1"],
    subscriptionRefs: ["subscription-1"],
    status: "active",
    nextDueAt: null,
    lastTriggeredAt: null,
    createdAt: "2026-04-30T00:00:00.000Z",
    updatedAt: "2026-04-30T00:00:01.000Z",
    playbookId: "playbook-1",
    scenarioId: "scenario-1",
    ownerId: "owner-1",
    cadence: "0 9 * * 1",
  };
}

function makeTrigger(): ScheduleTriggerRecordV0 {
  return {
    schema: "pluto.schedule.trigger",
    schemaVersion: 0,
    kind: "trigger",
    id: "trigger-1",
    workspaceId: "workspace-1",
    scheduleRef: "schedule-1",
    triggerKind: "cron",
    status: "active",
    configRef: "cron:0 9 * * 1",
    credentialRef: null,
    lastFiredAt: null,
    createdAt: "2026-04-30T00:00:00.000Z",
    updatedAt: "2026-04-30T00:00:01.000Z",
    scheduleId: "schedule-1",
    lastRunId: null,
  };
}

function makeSubscription(): ScheduleSubscriptionRecordV0 {
  return {
    schema: "pluto.schedule.subscription",
    schemaVersion: 0,
    kind: "subscription",
    id: "subscription-1",
    workspaceId: "workspace-1",
    scheduleRef: "schedule-1",
    triggerRef: "trigger-1",
    eventRef: "workspace:workspace-1",
    deliveryRef: null,
    filterRef: null,
    status: "active",
    createdAt: "2026-04-30T00:00:00.000Z",
    updatedAt: "2026-04-30T00:00:01.000Z",
    scheduleId: "schedule-1",
    subscriberKind: "workspace",
    subscriberId: "workspace-1",
  };
}

function makeFireRecord(): ScheduleFireRecordV0 {
  return {
    schemaVersion: 0,
    kind: "fire_record",
    id: "fire-1",
    workspaceId: "workspace-1",
    scheduleId: "schedule-1",
    triggerId: "trigger-1",
    runId: null,
    firedAt: "2026-04-30T00:10:00.000Z",
    createdAt: "2026-04-30T00:10:00.000Z",
    updatedAt: "2026-04-30T00:10:00.000Z",
    status: "queued",
  };
}

function makeMissedRun(): MissedRunRecordV0 {
  return {
    schema: "pluto.schedule.missed-run",
    schemaVersion: 0,
    kind: "missed_run",
    id: "missed-1",
    workspaceId: "workspace-1",
    scheduleRef: "schedule-1",
    triggerRef: "trigger-1",
    expectedAt: "2026-04-30T00:15:00.000Z",
    status: "blocked",
    blockerReason: "worker unavailable",
    lastAttemptRunRef: null,
    recordedAt: "2026-04-30T00:16:00.000Z",
    resolvedAt: null,
    createdAt: "2026-04-30T00:16:00.000Z",
    updatedAt: "2026-04-30T00:16:00.000Z",
    scheduleId: "schedule-1",
    fireRecordId: "fire-1",
    reason: "worker unavailable",
  };
}

describe("ScheduleStore", () => {
  it("round-trips schedules, triggers, subscriptions, fire records, and missed runs", async () => {
    const store = createFileScheduleStore({ dataDir });
    const schedule = makeSchedule();
    const trigger = makeTrigger();
    const subscription = makeSubscription();
    const fireRecord = makeFireRecord();
    const missedRun = makeMissedRun();

    await expect(store.put("schedule", schedule)).resolves.toEqual(schedule);
    await expect(store.put("trigger", trigger)).resolves.toEqual(trigger);
    await expect(store.put("subscription", subscription)).resolves.toEqual(subscription);
    await expect(store.put("fire_record", fireRecord)).resolves.toEqual(fireRecord);
    await expect(store.put("missed_run", missedRun)).resolves.toEqual(missedRun);

    await expect(store.get("schedule", schedule.id)).resolves.toEqual(schedule);
    await expect(store.get("trigger", trigger.id)).resolves.toEqual(trigger);
    await expect(store.get("subscription", subscription.id)).resolves.toEqual(subscription);
    await expect(store.get("fire_record", fireRecord.id)).resolves.toEqual(fireRecord);
    await expect(store.get("missed_run", missedRun.id)).resolves.toEqual(missedRun);

    await expect(store.list("schedule")).resolves.toEqual([schedule]);
    await expect(store.list("trigger", "workspace-1")).resolves.toEqual([trigger]);
    await expect(store.list("subscription")).resolves.toEqual([subscription]);
    await expect(store.list("fire_record")).resolves.toEqual([fireRecord]);
    await expect(store.list("missed_run")).resolves.toEqual([missedRun]);
    await expect(store.listKinds()).resolves.toEqual([...SCHEDULE_STORE_KINDS_V0]);
  });

  it("updates existing records without changing the read/write API shape", async () => {
    const store = createFileScheduleStore({ dataDir });

    await store.put("schedule", makeSchedule());
    await store.put("trigger", makeTrigger());
    await store.put("subscription", makeSubscription());
    await store.put("fire_record", makeFireRecord());
    await store.put("missed_run", makeMissedRun());

    await expect(
      store.update("schedule", "schedule-1", {
        updatedAt: "2026-04-30T00:05:00.000Z",
        status: "blocked",
      }),
    ).resolves.toMatchObject({ status: "blocked" });

    await expect(
      store.update("trigger", "trigger-1", {
        updatedAt: "2026-04-30T00:10:00.000Z",
        lastFiredAt: "2026-04-30T00:10:00.000Z",
        lastRunId: "run-1",
      }),
    ).resolves.toMatchObject({ lastRunId: "run-1" });

    await expect(
      store.update("subscription", "subscription-1", {
        updatedAt: "2026-04-30T00:11:00.000Z",
        status: "paused",
      }),
    ).resolves.toMatchObject({ status: "paused" });

    await expect(
      store.update("fire_record", "fire-1", {
        updatedAt: "2026-04-30T00:12:00.000Z",
        runId: "run-1",
        status: "succeeded",
      }),
    ).resolves.toMatchObject({ runId: "run-1", status: "succeeded" });

    await expect(
      store.update("missed_run", "missed-1", {
        updatedAt: "2026-04-30T00:17:00.000Z",
        status: "resolved",
      }),
    ).resolves.toMatchObject({ status: "resolved" });

    await expect(store.update("schedule", "missing", { status: "archived" })).resolves.toBeNull();
  });
});
