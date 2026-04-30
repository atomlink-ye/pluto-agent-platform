import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { evaluateScheduleFire, SCHEDULE_BLOCKER_REASONS_V0 } from "@/schedule/evaluator.js";
import { ScheduleStore } from "@/schedule/schedule-store.js";

describe("evaluateScheduleFire", () => {
  let dataDir = "";

  afterEach(async () => {
    if (dataDir) {
      await rm(dataDir, { recursive: true, force: true });
    }
  });

  it("allows active cron fires when local compatibility seams pass", async () => {
    dataDir = await mkdtemp(join(tmpdir(), "pluto-schedule-evaluator-"));
    const store = new ScheduleStore({ dataDir });
    await seedActiveScheduleGraph(store);

    const result = await evaluateScheduleFire({
      store,
      scheduleId: "schedule-1",
      triggerId: "trigger-1",
      triggerKind: "cron",
      expectedAt: "2026-04-30T00:05:00.000Z",
      evaluatedAt: "2026-04-30T00:05:30.000Z",
      compatibility: {
        runtimeCapabilityAvailable: true,
        approvalSatisfied: true,
        policyAllowed: true,
        budgetAllowed: true,
      },
    });

    expect(result).toMatchObject({
      allowed: true,
      reason: null,
      staleByMs: 30_000,
    });
    expect(result.context.subscriptions).toHaveLength(1);
  });

  it("blocks stale manual fires after the configured stale window", async () => {
    dataDir = await mkdtemp(join(tmpdir(), "pluto-schedule-evaluator-"));
    const store = new ScheduleStore({ dataDir });
    await seedActiveScheduleGraph(store);

    const result = await evaluateScheduleFire({
      store,
      scheduleId: "schedule-1",
      triggerId: "trigger-1",
      triggerKind: "manual",
      expectedAt: "2026-04-30T00:05:00.000Z",
      evaluatedAt: "2026-04-30T00:11:30.000Z",
      staleWindowMs: 60_000,
      compatibility: {
        runtimeCapabilityAvailable: true,
        approvalSatisfied: true,
        policyAllowed: true,
        budgetAllowed: true,
      },
    });

    expect(result.allowed).toBe(false);
    expect(result.reason).toBe(SCHEDULE_BLOCKER_REASONS_V0.staleWindowExceeded);
    expect(result.staleByMs).toBe(390_000);
  });

  it("fails closed when the runtime compatibility seam is absent", async () => {
    dataDir = await mkdtemp(join(tmpdir(), "pluto-schedule-evaluator-"));
    const store = new ScheduleStore({ dataDir });
    await seedActiveScheduleGraph(store);

    const result = await evaluateScheduleFire({
      store,
      scheduleId: "schedule-1",
      triggerId: "trigger-1",
      triggerKind: "cron",
      expectedAt: "2026-04-30T00:05:00.000Z",
      evaluatedAt: "2026-04-30T00:05:05.000Z",
      compatibility: {
        approvalSatisfied: true,
        policyAllowed: true,
        budgetAllowed: true,
      },
    });

    expect(result.allowed).toBe(false);
    expect(result.reason).toBe(SCHEDULE_BLOCKER_REASONS_V0.runtimeCapabilityUnavailable);
  });

  it("suppresses paused schedules for manual fires", async () => {
    dataDir = await mkdtemp(join(tmpdir(), "pluto-schedule-evaluator-"));
    const store = new ScheduleStore({ dataDir });
    await seedActiveScheduleGraph(store);
    await store.update("schedule", "schedule-1", {
      status: "paused",
      updatedAt: "2026-04-30T00:04:00.000Z",
    });

    const result = await evaluateScheduleFire({
      store,
      scheduleId: "schedule-1",
      triggerId: null,
      triggerKind: "manual",
      expectedAt: "2026-04-30T00:05:00.000Z",
      evaluatedAt: "2026-04-30T00:05:05.000Z",
      compatibility: enabledCompatibility(),
    });

    expect(result.allowed).toBe(false);
    expect(result.reason).toBe(SCHEDULE_BLOCKER_REASONS_V0.scheduleInactive);
  });

  it("treats explicit manual trigger ids the same as triggerless manual fires", async () => {
    dataDir = await mkdtemp(join(tmpdir(), "pluto-schedule-evaluator-"));
    const store = new ScheduleStore({ dataDir });
    await seedActiveScheduleGraph(store);

    const triggerless = await evaluateScheduleFire({
      store,
      scheduleId: "schedule-1",
      triggerId: null,
      triggerKind: "manual",
      expectedAt: "2026-04-30T00:05:00.000Z",
      evaluatedAt: "2026-04-30T00:05:05.000Z",
      compatibility: enabledCompatibility(),
    });
    const explicitManual = await evaluateScheduleFire({
      store,
      scheduleId: "schedule-1",
      triggerId: "manual:bridge-1",
      triggerKind: "manual",
      expectedAt: "2026-04-30T00:05:00.000Z",
      evaluatedAt: "2026-04-30T00:05:05.000Z",
      compatibility: enabledCompatibility(),
    });

    expect(triggerless.allowed).toBe(true);
    expect(explicitManual.allowed).toBe(true);
    expect(explicitManual.reason).toBeNull();
    expect(explicitManual.context.trigger).toBeNull();
    expect(explicitManual.expectedAt).toBe(triggerless.expectedAt);
    expect(explicitManual.evaluatedAt).toBe(triggerless.evaluatedAt);
    expect(explicitManual.staleByMs).toBe(triggerless.staleByMs);
    expect(explicitManual.context.schedule?.id).toBe(triggerless.context.schedule?.id);
    expect(explicitManual.context.subscriptions).toEqual(triggerless.context.subscriptions);
  });

  it("fails closed when outbound writes are disallowed for the fire", async () => {
    dataDir = await mkdtemp(join(tmpdir(), "pluto-schedule-evaluator-"));
    const store = new ScheduleStore({ dataDir });
    await seedActiveScheduleGraph(store);

    const result = await evaluateScheduleFire({
      store,
      scheduleId: "schedule-1",
      triggerId: null,
      triggerKind: "manual",
      expectedAt: "2026-04-30T00:05:00.000Z",
      evaluatedAt: "2026-04-30T00:05:05.000Z",
      compatibility: {
        ...enabledCompatibility(),
        outboundWritesAllowed: false,
      },
    });

    expect(result.allowed).toBe(false);
    expect(result.reason).toBe(SCHEDULE_BLOCKER_REASONS_V0.outboundWriteBlocked);
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
    nextDueAt: null,
    lastTriggeredAt: null,
    playbookId: "playbook-1",
    scenarioId: "scenario-1",
    ownerId: "owner-1",
    cadence: "0 * * * *",
    status: "active",
    createdAt: "2026-04-30T00:00:00.000Z",
    updatedAt: "2026-04-30T00:00:00.000Z",
  });
  await store.put("trigger", {
    schema: "pluto.schedule.trigger",
    schemaVersion: 0,
    kind: "trigger",
    id: "trigger-1",
    workspaceId: "workspace-1",
    scheduleRef: "schedule-1",
    triggerKind: "cron",
    configRef: "cron:0 * * * *",
    credentialRef: null,
    scheduleId: "schedule-1",
    createdAt: "2026-04-30T00:00:00.000Z",
    updatedAt: "2026-04-30T00:00:00.000Z",
    status: "active",
    lastFiredAt: null,
    lastRunId: null,
  });
  await store.put("subscription", {
    schema: "pluto.schedule.subscription",
    schemaVersion: 0,
    kind: "subscription",
    id: "subscription-1",
    workspaceId: "workspace-1",
    scheduleRef: "schedule-1",
    triggerRef: "trigger-1",
    eventRef: "run_queue:queue-1",
    deliveryRef: null,
    filterRef: null,
    scheduleId: "schedule-1",
    createdAt: "2026-04-30T00:00:00.000Z",
    updatedAt: "2026-04-30T00:00:00.000Z",
    status: "active",
    subscriberKind: "run_queue",
    subscriberId: "queue-1",
  });
}
