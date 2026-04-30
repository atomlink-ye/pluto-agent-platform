import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { GovernanceEventStore } from "@/audit/governance-event-store.js";
import { dispatchScheduleFire } from "@/schedule/dispatcher.js";
import { ScheduleStore } from "@/schedule/schedule-store.js";

describe("schedule dispatch audit events", () => {
  let dataDir = "";

  afterEach(async () => {
    if (dataDir) {
      await rm(dataDir, { recursive: true, force: true });
    }
  });

  it("emits auditable lifecycle events for allowed and blocked decisions", async () => {
    dataDir = await mkdtemp(join(tmpdir(), "pluto-schedule-audit-"));
    const store = new ScheduleStore({ dataDir });
    const auditStore = new GovernanceEventStore({ dataDir });
    await seedActiveScheduleGraph(store);

    const allowed = await dispatchScheduleFire({
      store,
      dataDir,
      auditStore,
      actorId: "scheduler-1",
      actorRoleLabels: ["scheduler", "bridge"],
      scheduleId: "schedule-1",
      triggerId: "trigger-1",
      triggerKind: "cron",
      expectedAt: "2026-04-30T00:05:00.000Z",
      decidedAt: "2026-04-30T00:05:05.000Z",
      sourceCommand: "cli.schedules.dispatch",
      sourceRef: "schedule:schedule-1",
      compatibility: enabledCompatibility(),
    });
    await store.update("fire_record", allowed.fireRecord.id, {
      status: "succeeded",
      updatedAt: "2026-04-30T00:05:10.000Z",
    });
    const blocked = await dispatchScheduleFire({
      store,
      dataDir,
      auditStore,
      actorId: "scheduler-1",
      scheduleId: "schedule-1",
      triggerId: "trigger-1",
      triggerKind: "cron",
      expectedAt: "2026-04-30T00:06:00.000Z",
      decidedAt: "2026-04-30T00:06:05.000Z",
      compatibility: {
        runtimeCapabilityAvailable: true,
        approvalSatisfied: false,
        policyAllowed: true,
        budgetAllowed: true,
      },
    });

    const events = await auditStore.list();

    expect(allowed.auditEvent?.eventType).toBe("schedule_dispatch_allowed");
    expect(blocked.auditEvent?.eventType).toBe("schedule_dispatch_blocked");
    expect(events.map((event) => event.eventType)).toEqual([
      "schedule_dispatch_allowed",
      "schedule_dispatch_blocked",
    ]);
    expect(events[1]).toMatchObject({
      reason: "approval_missing",
      target: {
        kind: "schedule_fire",
        targetId: "schedule-1",
      },
      status: {
        after: "blocked",
      },
    });
    expect(events[0]).toMatchObject({
      actor: {
        principalId: "scheduler-1",
        roleLabels: ["scheduler", "bridge"],
      },
      target: {
        kind: "schedule_fire",
        targetId: "schedule-1",
        requestId: "trigger-1",
      },
      status: {
        after: "queued",
      },
      source: {
        command: "cli.schedules.dispatch",
        ref: "schedule:schedule-1",
      },
    });
    expect(blocked.missedRun).toMatchObject({
      fireRecordId: blocked.fireRecord.id,
      reason: "approval_missing",
      status: "blocked",
    });
  });

  it("does not append duplicate audit events for the same fire key", async () => {
    dataDir = await mkdtemp(join(tmpdir(), "pluto-schedule-audit-"));
    const store = new ScheduleStore({ dataDir });
    const auditStore = new GovernanceEventStore({ dataDir });
    await seedActiveScheduleGraph(store);

    await dispatchScheduleFire({
      store,
      dataDir,
      auditStore,
      scheduleId: "schedule-1",
      triggerId: "trigger-1",
      triggerKind: "cron",
      expectedAt: "2026-04-30T00:05:00.000Z",
      decidedAt: "2026-04-30T00:05:05.000Z",
      compatibility: enabledCompatibility(),
    });
    const duplicate = await dispatchScheduleFire({
      store,
      dataDir,
      auditStore,
      scheduleId: "schedule-1",
      triggerId: "trigger-1",
      triggerKind: "cron",
      expectedAt: "2026-04-30T00:05:00.000Z",
      decidedAt: "2026-04-30T00:05:06.000Z",
      compatibility: enabledCompatibility(),
    });

    expect(duplicate.status).toBe("duplicate");
    expect(duplicate.auditEvent).toBeNull();
    expect((await auditStore.list()).map((event) => event.eventType)).toEqual(["schedule_dispatch_allowed"]);
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
