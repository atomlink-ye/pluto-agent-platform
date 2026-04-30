import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { evaluateScheduleFire, SCHEDULE_BLOCKER_REASONS_V0 } from "@/schedule/evaluator.js";
import { ScheduleStore } from "@/schedule/schedule-store.js";

describe("disabled trigger kinds", () => {
  let dataDir = "";

  afterEach(async () => {
    if (dataDir) {
      await rm(dataDir, { recursive: true, force: true });
    }
  });

  it("blocks non-enabled trigger kinds and explicit disabled kinds", async () => {
    dataDir = await mkdtemp(join(tmpdir(), "pluto-schedule-trigger-kinds-"));
    const store = new ScheduleStore({ dataDir });
    await seedActiveScheduleGraph(store);

    const apiResult = await evaluateScheduleFire({
      store,
      scheduleId: "schedule-1",
      triggerId: "trigger-1",
      triggerKind: "api",
      expectedAt: "2026-04-30T00:05:00.000Z",
      evaluatedAt: "2026-04-30T00:05:05.000Z",
      compatibility: enabledCompatibility(),
    });
    const manualResult = await evaluateScheduleFire({
      store,
      scheduleId: "schedule-1",
      triggerId: "trigger-1",
      triggerKind: "manual",
      disabledTriggerKinds: ["manual"],
      expectedAt: "2026-04-30T00:05:00.000Z",
      evaluatedAt: "2026-04-30T00:05:05.000Z",
      compatibility: enabledCompatibility(),
    });

    expect(apiResult.reason).toBe(SCHEDULE_BLOCKER_REASONS_V0.triggerKindDisabled);
    expect(manualResult.reason).toBe(SCHEDULE_BLOCKER_REASONS_V0.triggerKindDisabled);
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
