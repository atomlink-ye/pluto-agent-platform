import { isEnabledScheduleTriggerKindV1 } from "../contracts/schedule.js";
import { deriveScheduleFireKey } from "./idempotency.js";
import type {
  ScheduleRecordV0,
  ScheduleStore,
  ScheduleSubscriptionRecordV0,
  ScheduleTriggerRecordV0,
} from "./schedule-store.js";

export const SCHEDULE_BLOCKER_REASONS_V0 = {
  scheduleMissing: "schedule_missing",
  triggerMissing: "trigger_missing",
  triggerKindDisabled: "trigger_kind_disabled",
  scheduleInactive: "schedule_inactive",
  triggerInactive: "trigger_inactive",
  subscriptionMissing: "subscription_missing",
  subscriptionInactive: "subscription_inactive",
  staleWindowExceeded: "stale_window_exceeded",
  runtimeCapabilityUnavailable: "runtime_capability_unavailable",
  approvalMissing: "approval_missing",
  policyBlocked: "policy_blocked",
  budgetBlocked: "budget_blocked",
  outboundWriteBlocked: "outbound_write_blocked",
  concurrencyLimitReached: "concurrency_limit_reached",
} as const;

export type ScheduleBlockedReasonV0 =
  | (typeof SCHEDULE_BLOCKER_REASONS_V0)[keyof typeof SCHEDULE_BLOCKER_REASONS_V0]
  | (string & {});

export interface ScheduleCompatibilitySeamsV0 {
  runtimeCapabilityAvailable?: boolean;
  approvalSatisfied?: boolean;
  policyAllowed?: boolean;
  budgetAllowed?: boolean;
  outboundWritesAllowed?: boolean;
}

export interface EvaluateScheduleFireInputV0 {
  store: ScheduleStore;
  scheduleId: string;
  triggerId: string | null;
  triggerKind: string;
  expectedAt: string;
  evaluatedAt?: string;
  staleWindowMs?: number;
  disabledTriggerKinds?: readonly string[];
  compatibility?: ScheduleCompatibilitySeamsV0;
}

export interface ScheduleEvaluationContextV0 {
  schedule: ScheduleRecordV0 | null;
  trigger: ScheduleTriggerRecordV0 | null;
  subscriptions: ScheduleSubscriptionRecordV0[];
}

export interface ScheduleEvaluationResultV0 {
  allowed: boolean;
  fireKey: string;
  reason: ScheduleBlockedReasonV0 | null;
  expectedAt: string;
  evaluatedAt: string;
  staleByMs: number;
  context: ScheduleEvaluationContextV0;
}

const ACTIVE_SCHEDULE_STATUSES = new Set(["active", "ready"]);
const DEFAULT_STALE_WINDOW_MS = 5 * 60 * 1000;

export async function evaluateScheduleFire(
  input: EvaluateScheduleFireInputV0,
): Promise<ScheduleEvaluationResultV0> {
  const evaluatedAt = input.evaluatedAt ?? new Date().toISOString();
  const fireKey = deriveScheduleFireKey({
    scheduleId: input.scheduleId,
    triggerId: input.triggerId,
    triggerKind: input.triggerKind,
    expectedAt: input.expectedAt,
  });

  const schedule = await input.store.get("schedule", input.scheduleId);
  if (schedule === null) {
    return blocked(fireKey, input.expectedAt, evaluatedAt, 0, SCHEDULE_BLOCKER_REASONS_V0.scheduleMissing, {
      schedule: null,
      trigger: null,
      subscriptions: [],
    });
  }

  const trigger = input.triggerId === null ? null : await input.store.get("trigger", input.triggerId);
  const implicitManualTrigger = input.triggerKind === "manual" && input.triggerId !== null && trigger === null;
  if (input.triggerId !== null && trigger === null && !implicitManualTrigger) {
    return blocked(fireKey, input.expectedAt, evaluatedAt, 0, SCHEDULE_BLOCKER_REASONS_V0.triggerMissing, {
      schedule,
      trigger: null,
      subscriptions: [],
    });
  }

  const subscriptions = await loadSubscriptions(input.store, schedule.id, schedule.workspaceId);
  const context = { schedule, trigger, subscriptions };

  if (!isTriggerKindAllowed(input.triggerKind, input.disabledTriggerKinds ?? [])) {
    return blocked(
      fireKey,
      input.expectedAt,
      evaluatedAt,
      0,
      SCHEDULE_BLOCKER_REASONS_V0.triggerKindDisabled,
      context,
    );
  }

  if (!ACTIVE_SCHEDULE_STATUSES.has(schedule.status)) {
    return blocked(fireKey, input.expectedAt, evaluatedAt, 0, SCHEDULE_BLOCKER_REASONS_V0.scheduleInactive, context);
  }

  if (trigger !== null && !ACTIVE_SCHEDULE_STATUSES.has(trigger.status)) {
    return blocked(fireKey, input.expectedAt, evaluatedAt, 0, SCHEDULE_BLOCKER_REASONS_V0.triggerInactive, context);
  }

  if (subscriptions.length === 0) {
    return blocked(fireKey, input.expectedAt, evaluatedAt, 0, SCHEDULE_BLOCKER_REASONS_V0.subscriptionMissing, context);
  }

  if (subscriptions.some((subscription) => !ACTIVE_SCHEDULE_STATUSES.has(subscription.status))) {
    return blocked(fireKey, input.expectedAt, evaluatedAt, 0, SCHEDULE_BLOCKER_REASONS_V0.subscriptionInactive, context);
  }

  const staleByMs = computeStaleByMs(input.expectedAt, evaluatedAt);
  if (staleByMs > (input.staleWindowMs ?? DEFAULT_STALE_WINDOW_MS)) {
    return blocked(
      fireKey,
      input.expectedAt,
      evaluatedAt,
      staleByMs,
      SCHEDULE_BLOCKER_REASONS_V0.staleWindowExceeded,
      context,
    );
  }

  const compatibilityReason = resolveCompatibilityBlocker(input.compatibility);
  if (compatibilityReason !== null) {
    return blocked(fireKey, input.expectedAt, evaluatedAt, staleByMs, compatibilityReason, context);
  }

  return {
    allowed: true,
    fireKey,
    reason: null,
    expectedAt: input.expectedAt,
    evaluatedAt,
    staleByMs,
    context,
  };
}

function blocked(
  fireKey: string,
  expectedAt: string,
  evaluatedAt: string,
  staleByMs: number,
  reason: ScheduleBlockedReasonV0,
  context: ScheduleEvaluationContextV0,
): ScheduleEvaluationResultV0 {
  return {
    allowed: false,
    fireKey,
    reason,
    expectedAt,
    evaluatedAt,
    staleByMs,
    context,
  };
}

async function loadSubscriptions(
  store: ScheduleStore,
  scheduleId: string,
  workspaceId: string,
): Promise<ScheduleSubscriptionRecordV0[]> {
  const subscriptions = await store.list("subscription", workspaceId);
  return subscriptions.filter((subscription) => subscription.scheduleRef === scheduleId);
}

function isTriggerKindAllowed(triggerKind: string, disabledTriggerKinds: readonly string[]): boolean {
  return isEnabledScheduleTriggerKindV1(triggerKind) && !new Set(disabledTriggerKinds).has(triggerKind);
}

function computeStaleByMs(expectedAt: string, evaluatedAt: string): number {
  const expectedMs = Date.parse(expectedAt);
  const evaluatedMs = Date.parse(evaluatedAt);
  if (!Number.isFinite(expectedMs) || !Number.isFinite(evaluatedMs)) {
    return Number.POSITIVE_INFINITY;
  }

  return Math.max(0, evaluatedMs - expectedMs);
}

function resolveCompatibilityBlocker(
  compatibility: ScheduleCompatibilitySeamsV0 | undefined,
): ScheduleBlockedReasonV0 | null {
  if (compatibility?.runtimeCapabilityAvailable !== true) {
    return SCHEDULE_BLOCKER_REASONS_V0.runtimeCapabilityUnavailable;
  }

  if (compatibility?.approvalSatisfied !== true) {
    return SCHEDULE_BLOCKER_REASONS_V0.approvalMissing;
  }

  if (compatibility?.policyAllowed !== true) {
    return SCHEDULE_BLOCKER_REASONS_V0.policyBlocked;
  }

  if (compatibility?.budgetAllowed !== true) {
    return SCHEDULE_BLOCKER_REASONS_V0.budgetBlocked;
  }

  if (compatibility?.outboundWritesAllowed === false) {
    return SCHEDULE_BLOCKER_REASONS_V0.outboundWriteBlocked;
  }

  return null;
}
