import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { evaluateScheduleFire, SCHEDULE_BLOCKER_REASONS_V0 } from "@/schedule/evaluator.js";
import { ScheduleStore } from "@/schedule/schedule-store.js";

describe("subscription fail closed", () => {
  let dataDir = "";

  afterEach(async () => {
    if (dataDir) {
      await rm(dataDir, { recursive: true, force: true });
    }
  });

  it("blocks when a required subscription record is missing", async () => {
    dataDir = await mkdtemp(join(tmpdir(), "pluto-schedule-subscription-"));
    const store = new ScheduleStore({ dataDir });
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

    const result = await evaluateScheduleFire({
      store,
      scheduleId: "schedule-1",
      triggerId: "trigger-1",
      triggerKind: "cron",
      expectedAt: "2026-04-30T00:05:00.000Z",
      evaluatedAt: "2026-04-30T00:05:05.000Z",
      compatibility: enabledCompatibility(),
    });

    expect(result.reason).toBe(SCHEDULE_BLOCKER_REASONS_V0.subscriptionMissing);
  });

  it("blocks when a required subscription exists but is inactive", async () => {
    dataDir = await mkdtemp(join(tmpdir(), "pluto-schedule-subscription-"));
    const store = new ScheduleStore({ dataDir });
    await seedInactiveSubscriptionGraph(store);

    const result = await evaluateScheduleFire({
      store,
      scheduleId: "schedule-1",
      triggerId: "trigger-1",
      triggerKind: "cron",
      expectedAt: "2026-04-30T00:05:00.000Z",
      evaluatedAt: "2026-04-30T00:05:05.000Z",
      compatibility: enabledCompatibility(),
    });

    expect(result.reason).toBe(SCHEDULE_BLOCKER_REASONS_V0.subscriptionInactive);
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

async function seedInactiveSubscriptionGraph(store: ScheduleStore): Promise<void> {
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
    status: "blocked",
    subscriberKind: "run_queue",
    subscriberId: "queue-1",
  });
}
