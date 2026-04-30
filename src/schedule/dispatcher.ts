import type { RunRefV0 } from "../contracts/governance.js";
import type { GovernanceEventRecordV0 } from "../audit/governance-events.js";
import { GovernanceEventStore } from "../audit/governance-event-store.js";
import {
  acquireScheduleConcurrencyLease,
  type ScheduleConcurrencyLeaseV0,
} from "./concurrency.js";
import {
  evaluateScheduleFire,
  SCHEDULE_BLOCKER_REASONS_V0,
  type EvaluateScheduleFireInputV0,
  type ScheduleBlockedReasonV0,
  type ScheduleCompatibilitySeamsV0,
  type ScheduleEvaluationResultV0,
} from "./evaluator.js";
import {
  deriveMissedRunId,
  findExistingScheduleDecision,
} from "./idempotency.js";
import type { MissedRunRecordV0, ScheduleFireRecordV0, ScheduleStore } from "./schedule-store.js";

export interface DispatchScheduleFireInputV0
  extends Omit<EvaluateScheduleFireInputV0, "evaluatedAt"> {
  dataDir?: string;
  decidedAt?: string;
  auditStore?: GovernanceEventStore;
  actorId?: string;
  actorRoleLabels?: string[];
  sourceCommand?: string;
  sourceRef?: string | null;
  runIdFactory?: (fireKey: string) => string;
  compatibility?: ScheduleCompatibilitySeamsV0;
}

export interface DispatchScheduleFireResultV0 {
  status: "allowed" | "blocked" | "duplicate";
  fireKey: string;
  reason: ScheduleBlockedReasonV0 | null;
  duplicate: boolean;
  fireRecord: ScheduleFireRecordV0;
  missedRun: MissedRunRecordV0 | null;
  runSource: RunRefV0 | null;
  evaluation: ScheduleEvaluationResultV0;
  auditEvent: GovernanceEventRecordV0 | null;
}

const ACTIVE_FIRE_STATUSES = new Set(["queued", "running"]);

export async function dispatchScheduleFire(
  input: DispatchScheduleFireInputV0,
): Promise<DispatchScheduleFireResultV0> {
  const lease = await acquireScheduleConcurrencyLease({
    dataDir: input.dataDir,
    scheduleId: input.scheduleId,
  });
  if (!lease.acquired) {
    return blockedWithoutLease(input, SCHEDULE_BLOCKER_REASONS_V0.concurrencyLimitReached);
  }

  try {
    return await dispatchWithLease(input, lease);
  } finally {
    await lease.release();
  }
}

async function dispatchWithLease(
  input: DispatchScheduleFireInputV0,
  lease: ScheduleConcurrencyLeaseV0,
): Promise<DispatchScheduleFireResultV0> {
  const evaluation = await evaluateScheduleFire({
    ...input,
    evaluatedAt: input.decidedAt,
  });
  const auditStore = input.auditStore ?? new GovernanceEventStore({ dataDir: input.dataDir });
  const decidedAt = evaluation.evaluatedAt;

  const existing = await findExistingScheduleDecision(input.store, evaluation.fireKey);
  if (existing !== null) {
    return {
      status: existing.missedRun === null ? "duplicate" : "duplicate",
      fireKey: evaluation.fireKey,
      reason: existing.missedRun?.reason ?? null,
      duplicate: true,
      fireRecord: existing.fireRecord,
      missedRun: existing.missedRun,
      runSource: existing.missedRun === null ? toRunSource(existing.fireRecord, null) : null,
      evaluation,
      auditEvent: null,
    };
  }

  const concurrencyBlock = await findActiveConcurrencyBlock(input.store, input.scheduleId, evaluation.fireKey);
  const decisionReason = concurrencyBlock ?? evaluation.reason;
  const allowed = evaluation.allowed && decisionReason === null;
  const runId = allowed
    ? (input.runIdFactory ? input.runIdFactory(evaluation.fireKey) : `scheduled-${evaluation.fireKey}`)
    : null;

  const fireRecord: ScheduleFireRecordV0 = {
    schemaVersion: 0,
    kind: "fire_record",
    id: evaluation.fireKey,
    workspaceId: evaluation.context.schedule?.workspaceId ?? "unknown",
    scheduleId: input.scheduleId,
    triggerId: input.triggerId,
    runId,
    firedAt: evaluation.expectedAt,
    createdAt: decidedAt,
    updatedAt: decidedAt,
    status: allowed ? "queued" : "blocked",
  };

  const missedRun = allowed
    ? null
    : buildMissedRunRecord({
        id: deriveMissedRunId(evaluation.fireKey),
        workspaceId: fireRecord.workspaceId,
        scheduleId: input.scheduleId,
        triggerId: input.triggerId,
        fireRecordId: fireRecord.id,
        expectedAt: evaluation.expectedAt,
        decidedAt,
        reason: decisionReason ?? "unknown",
      });

  const auditEvent = buildScheduleDispatchAuditEvent({
    fireKey: evaluation.fireKey,
    decidedAt,
    actorId: input.actorId ?? "schedule-dispatcher",
    actorRoleLabels: input.actorRoleLabels,
    scheduleId: input.scheduleId,
    workspaceId: fireRecord.workspaceId,
    triggerId: input.triggerId,
    allowed,
    reason: decisionReason,
    sourceCommand: input.sourceCommand ?? "schedule.dispatchScheduleFire",
    sourceRef: input.sourceRef ?? lease.lockPath,
  });
  await auditStore.append(auditEvent);

  await input.store.put("fire_record", fireRecord);
  if (missedRun !== null) {
    await input.store.put("missed_run", missedRun);
  }

  await persistSchedulePointers(input.store, {
    triggerId: input.triggerId,
    firedAt: evaluation.expectedAt,
    runId,
  });

  return {
    status: allowed ? "allowed" : "blocked",
    fireKey: evaluation.fireKey,
    reason: decisionReason,
    duplicate: false,
    fireRecord,
    missedRun,
    runSource: allowed ? toRunSource(fireRecord, null) : null,
    evaluation: {
      ...evaluation,
      allowed,
      reason: decisionReason,
    },
    auditEvent,
  };
}

async function blockedWithoutLease(
  input: DispatchScheduleFireInputV0,
  reason: ScheduleBlockedReasonV0,
): Promise<DispatchScheduleFireResultV0> {
  const evaluation = await evaluateScheduleFire({
    ...input,
    evaluatedAt: input.decidedAt,
  });

  return dispatchWithSyntheticBlock(input, evaluation, reason);
}

async function dispatchWithSyntheticBlock(
  input: DispatchScheduleFireInputV0,
  evaluation: ScheduleEvaluationResultV0,
  reason: ScheduleBlockedReasonV0,
): Promise<DispatchScheduleFireResultV0> {
  const existing = await findExistingScheduleDecision(input.store, evaluation.fireKey);
  if (existing !== null) {
    return {
      status: "duplicate",
      fireKey: evaluation.fireKey,
      reason: existing.missedRun?.reason ?? null,
      duplicate: true,
      fireRecord: existing.fireRecord,
      missedRun: existing.missedRun,
      runSource: existing.missedRun === null ? toRunSource(existing.fireRecord, null) : null,
      evaluation,
      auditEvent: null,
    };
  }

  const decidedAt = evaluation.evaluatedAt;
  const auditStore = input.auditStore ?? new GovernanceEventStore({ dataDir: input.dataDir });
  const workspaceId = evaluation.context.schedule?.workspaceId ?? "unknown";
  const fireRecord: ScheduleFireRecordV0 = {
    schemaVersion: 0,
    kind: "fire_record",
    id: evaluation.fireKey,
    workspaceId,
    scheduleId: input.scheduleId,
    triggerId: input.triggerId,
    runId: null,
    firedAt: evaluation.expectedAt,
    createdAt: decidedAt,
    updatedAt: decidedAt,
    status: "blocked",
  };
  const missedRun: MissedRunRecordV0 = {
    ...buildMissedRunRecord({
      id: deriveMissedRunId(evaluation.fireKey),
      workspaceId,
      scheduleId: input.scheduleId,
      triggerId: input.triggerId,
      fireRecordId: fireRecord.id,
      expectedAt: evaluation.expectedAt,
      decidedAt,
      reason,
    }),
  };

  const auditEvent = buildScheduleDispatchAuditEvent({
    fireKey: evaluation.fireKey,
    decidedAt,
    actorId: input.actorId ?? "schedule-dispatcher",
    actorRoleLabels: input.actorRoleLabels,
    scheduleId: input.scheduleId,
    workspaceId,
    triggerId: input.triggerId,
    allowed: false,
    reason,
    sourceCommand: input.sourceCommand ?? "schedule.dispatchScheduleFire",
    sourceRef: input.sourceRef ?? "schedule.concurrency",
  });
  await auditStore.append(auditEvent);
  await input.store.put("fire_record", fireRecord);
  await input.store.put("missed_run", missedRun);
  await persistSchedulePointers(input.store, {
    triggerId: input.triggerId,
    firedAt: evaluation.expectedAt,
    runId: null,
  });

  return {
    status: "blocked",
    fireKey: evaluation.fireKey,
    reason,
    duplicate: false,
    fireRecord,
    missedRun,
    runSource: null,
    evaluation: {
      ...evaluation,
      allowed: false,
      reason,
    },
    auditEvent,
  };
}

async function findActiveConcurrencyBlock(
  store: ScheduleStore,
  scheduleId: string,
  fireKey: string,
): Promise<ScheduleBlockedReasonV0 | null> {
  const records = await store.list("fire_record");
  const active = records.find((record) =>
    record.scheduleId === scheduleId
    && record.id !== fireKey
    && ACTIVE_FIRE_STATUSES.has(record.status)
  );
  return active ? SCHEDULE_BLOCKER_REASONS_V0.concurrencyLimitReached : null;
}

async function persistSchedulePointers(
  store: ScheduleStore,
  input: {
    triggerId: string | null;
    firedAt: string;
    runId: string | null;
  },
): Promise<void> {
  if (input.triggerId !== null) {
    await store.update("trigger", input.triggerId, {
      lastFiredAt: input.firedAt,
      ...(input.runId === null ? {} : { lastRunId: input.runId }),
      updatedAt: input.firedAt,
    });
  }
}

function toRunSource(
  fireRecord: ScheduleFireRecordV0,
  blockerReason: string | null,
): RunRefV0 {
  return {
    runId: fireRecord.runId ?? `suppressed:${fireRecord.id}`,
    status: fireRecord.status,
    blockerReason,
    finishedAt: null,
  };
}

function buildMissedRunRecord(input: {
  id: string;
  workspaceId: string;
  scheduleId: string;
  triggerId: string | null;
  fireRecordId: string;
  expectedAt: string;
  decidedAt: string;
  reason: string;
}): MissedRunRecordV0 {
  return {
    schema: "pluto.schedule.missed-run",
    schemaVersion: 0,
    kind: "missed_run",
    id: input.id,
    workspaceId: input.workspaceId,
    scheduleRef: input.scheduleId,
    triggerRef: input.triggerId,
    expectedAt: input.expectedAt,
    status: "blocked",
    blockerReason: input.reason,
    lastAttemptRunRef: null,
    recordedAt: input.decidedAt,
    resolvedAt: null,
    createdAt: input.decidedAt,
    updatedAt: input.decidedAt,
    scheduleId: input.scheduleId,
    fireRecordId: input.fireRecordId,
    reason: input.reason,
  };
}

function buildScheduleDispatchAuditEvent(input: {
  fireKey: string;
  decidedAt: string;
  actorId: string;
  actorRoleLabels?: string[];
  scheduleId: string;
  workspaceId: string;
  triggerId: string | null;
  allowed: boolean;
  reason: string | null;
  sourceCommand: string;
  sourceRef: string | null;
}): GovernanceEventRecordV0 {
  const eventType = input.allowed ? "schedule_dispatch_allowed" : "schedule_dispatch_blocked";
  return {
    schema: "pluto.audit.governance-event",
    schemaVersion: 0,
    eventId: `${input.decidedAt}:${eventType}:${input.fireKey}`,
    eventType,
    actor: {
      principalId: input.actorId,
      roleLabels: input.actorRoleLabels,
    },
    target: {
      kind: "schedule_fire",
      recordId: input.fireKey,
      workspaceId: input.workspaceId,
      targetId: input.scheduleId,
      requestId: input.triggerId ?? undefined,
    },
    status: {
      before: null,
      after: input.allowed ? "queued" : "blocked",
      summary: input.allowed
        ? `schedule fire ${input.fireKey} queued for dispatch`
        : `schedule fire ${input.fireKey} suppressed before dispatch`,
    },
    evidenceRefs: [],
    reason: input.reason,
    createdAt: input.decidedAt,
    source: {
      command: input.sourceCommand,
      ref: input.sourceRef,
    },
  };
}
