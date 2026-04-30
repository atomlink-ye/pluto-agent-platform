import type {
  GovernanceRecordValidationResult,
  GovernanceStatusLikeV0,
} from "./governance.js";

export const SCHEDULE_TRIGGER_KINDS_V0 = ["cron", "manual", "api", "event"] as const;
export const ENABLED_SCHEDULE_TRIGGER_KINDS_V1 = ["cron", "manual"] as const;
export const SCHEDULE_RUN_STATUSES_V0 = ["queued", "running", "blocked", "failed", "succeeded"] as const;

export type ScheduleTriggerKindV0 = typeof SCHEDULE_TRIGGER_KINDS_V0[number];
export type EnabledScheduleTriggerKindV1 = typeof ENABLED_SCHEDULE_TRIGGER_KINDS_V1[number];
export type ScheduleTriggerKindLikeV0 = ScheduleTriggerKindV0 | (string & {});
export type ScheduleRunStatusV0 = typeof SCHEDULE_RUN_STATUSES_V0[number];
export type ScheduleRunStatusLikeV0 = ScheduleRunStatusV0 | "done" | (string & {});

export interface ScheduleRecordV0 {
  schema: "pluto.schedule";
  schemaVersion: 0;
  kind: "schedule";
  id: string;
  workspaceId: string;
  playbookRef: string;
  scenarioRef: string;
  ownerRef: string;
  triggerRefs: string[];
  subscriptionRefs: string[];
  status: GovernanceStatusLikeV0;
  nextDueAt: string | null;
  lastTriggeredAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface TriggerRecordV0 {
  schema: "pluto.schedule.trigger";
  schemaVersion: 0;
  kind: "trigger";
  id: string;
  workspaceId: string;
  scheduleRef: string;
  triggerKind: ScheduleTriggerKindLikeV0;
  status: GovernanceStatusLikeV0;
  configRef: string | null;
  credentialRef: string | null;
  lastFiredAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface SubscriptionRecordV0 {
  schema: "pluto.schedule.subscription";
  schemaVersion: 0;
  kind: "subscription";
  id: string;
  workspaceId: string;
  scheduleRef: string;
  triggerRef: string;
  eventRef: string;
  deliveryRef: string | null;
  filterRef: string | null;
  status: GovernanceStatusLikeV0;
  createdAt: string;
  updatedAt: string;
}

export interface MissedRunRecordV0 {
  schema: "pluto.schedule.missed-run";
  schemaVersion: 0;
  kind: "missed_run";
  id: string;
  workspaceId: string;
  scheduleRef: string;
  triggerRef: string | null;
  expectedAt: string;
  status: ScheduleRunStatusLikeV0;
  blockerReason: string | null;
  lastAttemptRunRef: string | null;
  recordedAt: string;
  resolvedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

const SCHEDULE_TRIGGER_KIND_SET = new Set<string>(SCHEDULE_TRIGGER_KINDS_V0);
const ENABLED_SCHEDULE_TRIGGER_KIND_SET = new Set<string>(ENABLED_SCHEDULE_TRIGGER_KINDS_V1);
const SCHEDULE_RUN_STATUS_SET = new Set<string>(SCHEDULE_RUN_STATUSES_V0);
const FORBIDDEN_SECRET_FIELDS = new Set([
  "value",
  "secret",
  "secretValue",
  "resolvedValue",
  "password",
  "token",
  "apiKey",
  "authorization",
  "credential",
  "credentials",
]);

function hasOwnProperty(object: Record<string, unknown>, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(object, key);
}

function validateStringField(record: Record<string, unknown>, field: string, errors: string[]): void {
  if (!hasOwnProperty(record, field)) {
    errors.push(`missing required field: ${field}`);
    return;
  }

  if (typeof record[field] !== "string") {
    errors.push(`${field} must be a string`);
  }
}

function validateNullableStringField(record: Record<string, unknown>, field: string, errors: string[]): void {
  if (!hasOwnProperty(record, field)) {
    errors.push(`missing required field: ${field}`);
    return;
  }

  const value = record[field];
  if (value !== null && typeof value !== "string") {
    errors.push(`${field} must be a string or null`);
  }
}

function validateStringArrayField(record: Record<string, unknown>, field: string, errors: string[]): void {
  if (!hasOwnProperty(record, field)) {
    errors.push(`missing required field: ${field}`);
    return;
  }

  const value = record[field];
  if (!Array.isArray(value) || value.some((entry) => typeof entry !== "string")) {
    errors.push(`${field} must be an array of strings`);
  }
}

function validateBaseRecord(
  value: unknown,
  expectedSchema: string,
  expectedKind: string,
): GovernanceRecordValidationResult<Record<string, unknown>> {
  if (typeof value !== "object" || value === null) {
    return { ok: false, errors: ["record must be an object"] };
  }

  const record = value as Record<string, unknown>;
  const errors: string[] = [];

  if (record["schema"] !== expectedSchema) {
    errors.push(`schema must be ${expectedSchema}`);
  }

  if (record["schemaVersion"] !== 0) {
    errors.push("schemaVersion must be 0");
  }

  if (record["kind"] !== expectedKind) {
    errors.push(`kind must be ${expectedKind}`);
  }

  validateStringField(record, "id", errors);
  validateStringField(record, "workspaceId", errors);
  validateStringField(record, "status", errors);
  validateStringField(record, "createdAt", errors);
  validateStringField(record, "updatedAt", errors);

  for (const field of FORBIDDEN_SECRET_FIELDS) {
    if (hasOwnProperty(record, field)) {
      errors.push(`schedule records must not contain ${field}`);
    }
  }

  return errors.length === 0 ? { ok: true, value: record } : { ok: false, errors };
}

export function parseScheduleTriggerKindV0(value: unknown): ScheduleTriggerKindLikeV0 | null {
  if (typeof value !== "string") return null;
  if (SCHEDULE_TRIGGER_KIND_SET.has(value)) {
    return value as ScheduleTriggerKindV0;
  }

  return value;
}

export function isEnabledScheduleTriggerKindV1(value: unknown): value is EnabledScheduleTriggerKindV1 {
  return typeof value === "string" && ENABLED_SCHEDULE_TRIGGER_KIND_SET.has(value);
}

export function normalizeScheduleRunStatusV0(value: unknown): ScheduleRunStatusLikeV0 | null {
  if (typeof value !== "string") return null;
  if (value === "done") return "succeeded";
  if (SCHEDULE_RUN_STATUS_SET.has(value)) {
    return value as ScheduleRunStatusV0;
  }

  return value;
}

export function validateScheduleRecordV0(
  value: unknown,
): GovernanceRecordValidationResult<ScheduleRecordV0> {
  const base = validateBaseRecord(value, "pluto.schedule", "schedule");
  if (!base.ok) return base;

  const record = base.value;
  const errors: string[] = [];
  validateStringField(record, "playbookRef", errors);
  validateStringField(record, "scenarioRef", errors);
  validateStringField(record, "ownerRef", errors);
  validateStringArrayField(record, "triggerRefs", errors);
  validateStringArrayField(record, "subscriptionRefs", errors);
  validateNullableStringField(record, "nextDueAt", errors);
  validateNullableStringField(record, "lastTriggeredAt", errors);

  return errors.length === 0
    ? { ok: true, value: record as unknown as ScheduleRecordV0 }
    : { ok: false, errors };
}

export function validateTriggerRecordV0(
  value: unknown,
): GovernanceRecordValidationResult<TriggerRecordV0> {
  const base = validateBaseRecord(value, "pluto.schedule.trigger", "trigger");
  if (!base.ok) return base;

  const record = base.value;
  const errors: string[] = [];
  validateStringField(record, "scheduleRef", errors);
  validateStringField(record, "triggerKind", errors);
  validateNullableStringField(record, "configRef", errors);
  validateNullableStringField(record, "credentialRef", errors);
  validateNullableStringField(record, "lastFiredAt", errors);

  return errors.length === 0
    ? { ok: true, value: record as unknown as TriggerRecordV0 }
    : { ok: false, errors };
}

export function validateSubscriptionRecordV0(
  value: unknown,
): GovernanceRecordValidationResult<SubscriptionRecordV0> {
  const base = validateBaseRecord(value, "pluto.schedule.subscription", "subscription");
  if (!base.ok) return base;

  const record = base.value;
  const errors: string[] = [];
  validateStringField(record, "scheduleRef", errors);
  validateStringField(record, "triggerRef", errors);
  validateStringField(record, "eventRef", errors);
  validateNullableStringField(record, "deliveryRef", errors);
  validateNullableStringField(record, "filterRef", errors);

  return errors.length === 0
    ? { ok: true, value: record as unknown as SubscriptionRecordV0 }
    : { ok: false, errors };
}

export function validateMissedRunRecordV0(
  value: unknown,
): GovernanceRecordValidationResult<MissedRunRecordV0> {
  const base = validateBaseRecord(value, "pluto.schedule.missed-run", "missed_run");
  if (!base.ok) return base;

  const record = base.value;
  const errors: string[] = [];
  validateStringField(record, "scheduleRef", errors);
  validateNullableStringField(record, "triggerRef", errors);
  validateStringField(record, "expectedAt", errors);
  validateNullableStringField(record, "blockerReason", errors);
  validateNullableStringField(record, "lastAttemptRunRef", errors);
  validateStringField(record, "recordedAt", errors);
  validateNullableStringField(record, "resolvedAt", errors);

  if (normalizeScheduleRunStatusV0(record["status"]) === null) {
    errors.push("status must be a string");
  }

  return errors.length === 0
    ? { ok: true, value: record as unknown as MissedRunRecordV0 }
    : { ok: false, errors };
}
