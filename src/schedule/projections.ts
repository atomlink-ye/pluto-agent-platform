import { GovernanceStore } from "../governance/governance-store.js";
import type {
  MissedRunRecordV0,
  ScheduleRecordV0,
  ScheduleFireRecordV0,
  ScheduleStore,
  ScheduleSubscriptionRecordV0,
  ScheduleTriggerRecordV0,
} from "./schedule-store.js";

export interface ScheduleRecordRefV0 {
  kind: "schedule";
  recordId: string;
  workspaceId: string;
  summary: string;
}

export interface ScheduleListItemProjectionV0 {
  scheduleRef: ScheduleRecordRefV0;
  status: string;
  cadence: string;
  playbookId: string;
  scenarioId: string;
  ownerId: string;
  triggerCount: number;
  subscriptionCount: number;
  latestFireAt: string | null;
  latestRunId: string | null;
  blockedCount: number;
}

export interface ScheduleTriggerProjectionV0 {
  triggerId: string;
  status: string;
  lastFiredAt: string | null;
  lastRunId: string | null;
}

export interface ScheduleSubscriptionProjectionV0 {
  subscriptionId: string;
  status: string;
  subscriberKind: string;
  subscriberId: string;
}

export interface ScheduleHistoryEntryProjectionV0 {
  historyKind: "fire_record" | "missed_run";
  historyId: string;
  status: string;
  occurredAt: string;
  scheduleRef: ScheduleRecordRefV0;
  triggerId: string | null;
  runId: string | null;
  fireRecordId: string | null;
  reason: string | null;
}

export interface ScheduleDetailProjectionV0 {
  schemaVersion: 0;
  scheduleRef: ScheduleRecordRefV0;
  status: string;
  cadence: string;
  playbookId: string;
  scenarioId: string;
  ownerId: string;
  createdAt: string;
  updatedAt: string;
  triggerRefs: ScheduleTriggerProjectionV0[];
  subscriptionRefs: ScheduleSubscriptionProjectionV0[];
  latestHistory: ScheduleHistoryEntryProjectionV0[];
}

export interface ScheduleHistoryProjectionV0 {
  schemaVersion: 0;
  scheduleRef: ScheduleRecordRefV0;
  entries: ScheduleHistoryEntryProjectionV0[];
}

export async function listScheduleProjections(input: {
  governanceStore: GovernanceStore;
  scheduleStore: ScheduleStore;
}): Promise<ScheduleListItemProjectionV0[]> {
  const [storedSchedules, triggers, subscriptions, fireRecords, missedRuns] = await Promise.all([
    input.scheduleStore.list("schedule"),
    input.scheduleStore.list("trigger"),
    input.scheduleStore.list("subscription"),
    input.scheduleStore.list("fire_record"),
    input.scheduleStore.list("missed_run"),
  ]);

  const schedules = await loadProjectedSchedules(input.governanceStore, storedSchedules);

  return schedules
    .map((schedule) => {
      const scheduleTriggers = triggers.filter((trigger) => trigger.scheduleRef === schedule.id);
      const scheduleSubscriptions = subscriptions.filter((subscription) => subscription.scheduleRef === schedule.id);
      const scheduleFireRecords = fireRecords.filter((record) => record.scheduleId === schedule.id);
      const scheduleMissedRuns = missedRuns.filter((record) => record.scheduleRef === schedule.id);
      const cadence = deriveCadence(schedule, scheduleTriggers);
      const scheduleRef = toScheduleRecordRef(schedule, cadence);
      const latestHistory = buildScheduleHistoryEntries(scheduleRef, scheduleFireRecords, scheduleMissedRuns)[0] ?? null;

      return {
        scheduleRef,
        status: schedule.status,
        cadence,
        playbookId: schedule.playbookId,
        scenarioId: schedule.scenarioId,
        ownerId: schedule.ownerId,
        triggerCount: scheduleTriggers.length,
        subscriptionCount: scheduleSubscriptions.length,
        latestFireAt: latestHistory?.occurredAt ?? null,
        latestRunId: latestHistory?.runId ?? null,
        blockedCount: scheduleFireRecords.filter((record) => record.status === "blocked").length
          + scheduleMissedRuns.filter((record) => record.status === "blocked").length,
      } satisfies ScheduleListItemProjectionV0;
    })
    .sort((left, right) => left.scheduleRef.recordId.localeCompare(right.scheduleRef.recordId));
}

export async function projectScheduleDetail(input: {
  governanceStore: GovernanceStore;
  scheduleStore: ScheduleStore;
  scheduleId: string;
}): Promise<ScheduleDetailProjectionV0 | null> {
  const schedule = await loadProjectedSchedule(input.governanceStore, input.scheduleStore, input.scheduleId);
  if (schedule === null) {
    return null;
  }

  const [triggers, subscriptions, fireRecords, missedRuns] = await Promise.all([
    input.scheduleStore.list("trigger"),
    input.scheduleStore.list("subscription"),
    input.scheduleStore.list("fire_record"),
    input.scheduleStore.list("missed_run"),
  ]);
  const scheduleTriggers = triggers.filter((trigger) => trigger.scheduleRef === schedule.id);
  const scheduleSubscriptions = subscriptions.filter((subscription) => subscription.scheduleRef === schedule.id);
  const cadence = deriveCadence(schedule, scheduleTriggers);
  const scheduleRef = toScheduleRecordRef(schedule, cadence);

  return {
    schemaVersion: 0,
    scheduleRef,
    status: schedule.status,
    cadence,
    playbookId: schedule.playbookId,
    scenarioId: schedule.scenarioId,
    ownerId: schedule.ownerId,
    createdAt: schedule.createdAt,
    updatedAt: schedule.updatedAt,
    triggerRefs: scheduleTriggers
      .map(projectTrigger)
      .sort((left, right) => left.triggerId.localeCompare(right.triggerId)),
    subscriptionRefs: scheduleSubscriptions
      .map(projectSubscription)
      .sort((left, right) => left.subscriptionId.localeCompare(right.subscriptionId)),
    latestHistory: buildScheduleHistoryEntries(
      scheduleRef,
      fireRecords.filter((record) => record.scheduleId === schedule.id),
      missedRuns.filter((record) => record.scheduleRef === schedule.id),
    ).slice(0, 10),
  };
}

export async function projectScheduleHistory(input: {
  governanceStore: GovernanceStore;
  scheduleStore: ScheduleStore;
  scheduleId: string;
}): Promise<ScheduleHistoryProjectionV0 | null> {
  const schedule = await loadProjectedSchedule(input.governanceStore, input.scheduleStore, input.scheduleId);
  if (schedule === null) {
    return null;
  }

  const [fireRecords, missedRuns] = await Promise.all([
    input.scheduleStore.list("fire_record"),
    input.scheduleStore.list("missed_run"),
  ]);
  const triggers = await input.scheduleStore.list("trigger", schedule.workspaceId);
  const scheduleRef = toScheduleRecordRef(schedule, deriveCadence(schedule, triggers.filter((trigger) => trigger.scheduleRef === schedule.id)));

  return {
    schemaVersion: 0,
    scheduleRef,
    entries: buildScheduleHistoryEntries(
      scheduleRef,
      fireRecords.filter((record) => record.scheduleId === schedule.id),
      missedRuns.filter((record) => record.scheduleRef === schedule.id),
    ),
  };
}

function toScheduleRecordRef(schedule: ScheduleRecordV0, cadence: string): ScheduleRecordRefV0 {
  return {
    kind: "schedule",
    recordId: schedule.id,
    workspaceId: schedule.workspaceId,
    summary: `${cadence} -> ${schedule.scenarioId}`,
  };
}

function projectTrigger(trigger: ScheduleTriggerRecordV0): ScheduleTriggerProjectionV0 {
  return {
    triggerId: trigger.id,
    status: trigger.status,
    lastFiredAt: trigger.lastFiredAt,
    lastRunId: trigger.lastRunId,
  };
}

function projectSubscription(subscription: ScheduleSubscriptionRecordV0): ScheduleSubscriptionProjectionV0 {
  return {
    subscriptionId: subscription.id,
    status: subscription.status,
    subscriberKind: subscription.subscriberKind,
    subscriberId: subscription.subscriberId,
  };
}

function buildScheduleHistoryEntries(
  scheduleRef: ScheduleRecordRefV0,
  fireRecords: ScheduleFireRecordV0[],
  missedRuns: MissedRunRecordV0[],
): ScheduleHistoryEntryProjectionV0[] {
  const fireEntries = fireRecords.map((record) => ({
    historyKind: "fire_record" as const,
    historyId: record.id,
    status: record.status,
    occurredAt: record.firedAt,
    scheduleRef,
    triggerId: record.triggerId,
    runId: record.runId,
    fireRecordId: record.id,
    reason: null,
  }));
  const missedEntries = missedRuns.map((record) => ({
    historyKind: "missed_run" as const,
    historyId: record.id,
    status: record.status,
    occurredAt: record.recordedAt,
    scheduleRef,
    triggerId: record.triggerRef,
    runId: record.lastAttemptRunRef,
    fireRecordId: record.fireRecordId,
    reason: record.blockerReason ?? record.reason,
  }));

  return [...fireEntries, ...missedEntries].sort((left, right) =>
    right.occurredAt.localeCompare(left.occurredAt) || right.historyId.localeCompare(left.historyId)
  );
}

async function loadProjectedSchedules(
  governanceStore: GovernanceStore,
  storedSchedules: ScheduleRecordV0[],
): Promise<ScheduleRecordV0[]> {
  if (storedSchedules.length > 0) {
    return storedSchedules;
  }

  const governanceSchedules = await governanceStore.list("schedule");
  return governanceSchedules.map((schedule) => ({
    schema: "pluto.schedule",
    schemaVersion: 0,
    kind: "schedule",
    id: schedule.id,
    workspaceId: schedule.workspaceId,
    playbookRef: toRef("playbook", schedule.playbookId),
    scenarioRef: toRef("scenario", schedule.scenarioId),
    ownerRef: toRef("user", schedule.ownerId),
    triggerRefs: [],
    subscriptionRefs: [],
    status: schedule.status,
    nextDueAt: null,
    lastTriggeredAt: null,
    createdAt: schedule.createdAt,
    updatedAt: schedule.updatedAt,
    playbookId: schedule.playbookId,
    scenarioId: schedule.scenarioId,
    ownerId: schedule.ownerId,
    cadence: schedule.cadence,
  }));
}

async function loadProjectedSchedule(
  governanceStore: GovernanceStore,
  scheduleStore: ScheduleStore,
  scheduleId: string,
): Promise<ScheduleRecordV0 | null> {
  const stored = await scheduleStore.get("schedule", scheduleId);
  if (stored !== null) {
    return stored;
  }

  const governance = await governanceStore.get("schedule", scheduleId);
  if (governance === null) {
    return null;
  }

  return {
    schema: "pluto.schedule",
    schemaVersion: 0,
    kind: "schedule",
    id: governance.id,
    workspaceId: governance.workspaceId,
    playbookRef: toRef("playbook", governance.playbookId),
    scenarioRef: toRef("scenario", governance.scenarioId),
    ownerRef: toRef("user", governance.ownerId),
    triggerRefs: [],
    subscriptionRefs: [],
    status: governance.status,
    nextDueAt: null,
    lastTriggeredAt: null,
    createdAt: governance.createdAt,
    updatedAt: governance.updatedAt,
    playbookId: governance.playbookId,
    scenarioId: governance.scenarioId,
    ownerId: governance.ownerId,
    cadence: governance.cadence,
  };
}

function deriveCadence(schedule: ScheduleRecordV0, triggers: ScheduleTriggerRecordV0[]): string {
  const configured = triggers
    .map((trigger) => trigger.configRef)
    .find((configRef): configRef is string => typeof configRef === "string" && configRef.length > 0);
  if (configured) {
    return configured.startsWith("cron:") || configured.startsWith("manual:")
      ? configured.slice(configured.indexOf(":") + 1)
      : configured;
  }

  return schedule.cadence;
}

function toRef(prefix: string, value: string): string {
  return value.includes(":") ? value : `${prefix}:${value}`;
}
