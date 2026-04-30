import { describe, expect, it } from "vitest";

import {
  type MissedRunRecordV0,
  type ScheduleRecordV0,
  type SubscriptionRecordV0,
  type TriggerRecordV0,
  SCHEDULE_TRIGGER_KINDS_V0,
  isEnabledScheduleTriggerKindV1,
  parseScheduleTriggerKindV0,
  validateGovernedScheduleRecordV0,
  validateMissedRunRecordV0,
  validateSubscriptionRecordV0,
  validateTriggerRecordV0,
} from "@/contracts/index.js";
import {
  type ScheduleRecordV0 as ContractsIndexScheduleRecordV0,
  type TriggerRecordV0 as ContractsIndexTriggerRecordV0,
} from "@/contracts/index.js";
import {
  type MissedRunRecordV0 as RootMissedRunRecordV0,
  type SubscriptionRecordV0 as RootSubscriptionRecordV0,
} from "@/index.js";

const baseRecord = {
  schemaVersion: 0 as const,
  workspaceId: "workspace-1",
  status: "active",
  createdAt: "2026-04-30T00:00:00.000Z",
  updatedAt: "2026-04-30T00:00:01.000Z",
};

describe("schedule contracts", () => {
  it("exports the new schedule contract family from contract and root surfaces", () => {
    const schedule: ContractsIndexScheduleRecordV0 = {
      ...baseRecord,
      schema: "pluto.schedule",
      kind: "schedule",
      id: "schedule-1",
      playbookRef: "playbook:playbook-1",
      scenarioRef: "scenario:scenario-1",
      ownerRef: "user:owner-1",
      triggerRefs: ["trigger:trigger-1"],
      subscriptionRefs: ["subscription:subscription-1"],
      nextDueAt: "2026-05-01T09:00:00.000Z",
      lastTriggeredAt: null,
    };

    const trigger: ContractsIndexTriggerRecordV0 = {
      ...baseRecord,
      schema: "pluto.schedule.trigger",
      kind: "trigger",
      id: "trigger-1",
      scheduleRef: schedule.id,
      triggerKind: "cron",
      configRef: "cron:0 9 * * 1",
      credentialRef: null,
      lastFiredAt: null,
    };

    const subscription: RootSubscriptionRecordV0 = {
      ...baseRecord,
      schema: "pluto.schedule.subscription",
      kind: "subscription",
      id: "subscription-1",
      scheduleRef: schedule.id,
      triggerRef: trigger.id,
      eventRef: "event:weekly-digest",
      deliveryRef: null,
      filterRef: "filter:workspace-1",
    };

    const missedRun: RootMissedRunRecordV0 = {
      ...baseRecord,
      schema: "pluto.schedule.missed-run",
      kind: "missed_run",
      id: "missed-run-1",
      scheduleRef: schedule.id,
      triggerRef: trigger.id,
      expectedAt: "2026-05-01T09:00:00.000Z",
      status: "succeeded",
      blockerReason: null,
      lastAttemptRunRef: "run:run-1",
      recordedAt: "2026-05-01T09:05:00.000Z",
      resolvedAt: "2026-05-01T09:10:00.000Z",
    };

    expect(validateGovernedScheduleRecordV0(schedule)).toEqual({ ok: true, value: schedule });
    expect(validateTriggerRecordV0(trigger)).toEqual({ ok: true, value: trigger });
    expect(validateSubscriptionRecordV0(subscription)).toEqual({ ok: true, value: subscription });
    expect(validateMissedRunRecordV0(missedRun)).toEqual({ ok: true, value: missedRun });
  });

  it("accepts the full visible trigger kind vocabulary while keeping v1 enablement explicit", () => {
    expect(SCHEDULE_TRIGGER_KINDS_V0).toEqual(["cron", "manual", "api", "event"]);
    expect(parseScheduleTriggerKindV0("cron")).toBe("cron");
    expect(parseScheduleTriggerKindV0("api")).toBe("api");
    expect(parseScheduleTriggerKindV0("future_trigger")).toBe("future_trigger");
    expect(parseScheduleTriggerKindV0(42)).toBeNull();

    expect(isEnabledScheduleTriggerKindV1("cron")).toBe(true);
    expect(isEnabledScheduleTriggerKindV1("manual")).toBe(true);
    expect(isEnabledScheduleTriggerKindV1("api")).toBe(false);
    expect(isEnabledScheduleTriggerKindV1("event")).toBe(false);
  });

  it("tolerates additive future fields and rejects top-level secret material", () => {
    const withFutureField: ScheduleRecordV0 = {
      ...baseRecord,
      schema: "pluto.schedule",
      kind: "schedule",
      id: "schedule-1",
      playbookRef: "playbook:playbook-1",
      scenarioRef: "scenario:scenario-1",
      ownerRef: "user:owner-1",
      triggerRefs: [],
      subscriptionRefs: [],
      nextDueAt: null,
      lastTriggeredAt: null,
      futureField: { additive: true },
    } as ScheduleRecordV0 & { futureField: { additive: boolean } };

    const leakedTrigger: TriggerRecordV0 = {
      ...baseRecord,
      schema: "pluto.schedule.trigger",
      kind: "trigger",
      id: "trigger-1",
      scheduleRef: "schedule-1",
      triggerKind: "manual",
      configRef: "manual://operator",
      credentialRef: null,
      lastFiredAt: null,
      token: "should-not-be-here",
    } as TriggerRecordV0 & { token: string };

    expect(validateGovernedScheduleRecordV0(withFutureField).ok).toBe(true);

    const leaked = validateTriggerRecordV0(leakedTrigger);
    expect(leaked.ok).toBe(false);
    expect(leaked.ok ? [] : leaked.errors).toContain("schedule records must not contain token");
  });

  it("requires schema markers and ref-first record fields", () => {
    const invalidSubscription: Partial<SubscriptionRecordV0> & Record<string, unknown> = {
      ...baseRecord,
      schema: "pluto.schedule.subscription",
      kind: "subscription",
      id: "subscription-1",
      scheduleRef: "schedule-1",
      triggerRef: "trigger-1",
      deliveryRef: null,
      filterRef: null,
    };

    const invalidMissedRun: Record<string, unknown> = {
      ...baseRecord,
      schema: "pluto.schedule.missed-run",
      kind: "missed_run",
      id: "missed-run-1",
      scheduleRef: "schedule-1",
      triggerRef: null,
      expectedAt: "2026-05-01T09:00:00.000Z",
      status: 42,
      blockerReason: null,
      lastAttemptRunRef: null,
      recordedAt: "2026-05-01T09:05:00.000Z",
      resolvedAt: null,
    };

    const subscriptionResult = validateSubscriptionRecordV0(invalidSubscription);
    expect(subscriptionResult.ok).toBe(false);
    expect(subscriptionResult.ok ? [] : subscriptionResult.errors).toContain("missing required field: eventRef");

    const missedRunResult = validateMissedRunRecordV0(invalidMissedRun);
    expect(missedRunResult.ok).toBe(false);
    expect(missedRunResult.ok ? [] : missedRunResult.errors).toContain("status must be a string");
  });
});
