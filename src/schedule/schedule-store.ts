import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

import type { ScheduleRecordV0 as GovernanceScheduleRecordV0 } from "../contracts/governance.js";
import { validateScheduleRecordV0 as validateGovernanceScheduleRecordV0 } from "../contracts/governance.js";
import {
  type ScheduleRecordV0 as ContractScheduleRecordV0,
  type SubscriptionRecordV0 as ContractSubscriptionRecordV0,
  type TriggerRecordV0 as ContractTriggerRecordV0,
  validateScheduleRecordV0 as validateContractScheduleRecordV0,
  validateSubscriptionRecordV0 as validateContractSubscriptionRecordV0,
  validateTriggerRecordV0 as validateContractTriggerRecordV0,
} from "../contracts/schedule.js";
import {
  type FireRecordByKindV0,
  type FireRecordKindV0,
  type FireRecordStoreOptions,
  type MissedRunRecordV0,
  type ScheduleFireRecordV0,
  FileFireRecordStore,
  createFileFireRecordStore,
} from "./fire-records.js";

export type { MissedRunRecordV0, ScheduleFireRecordV0 } from "./fire-records.js";

export interface ScheduleStoreOptions extends FireRecordStoreOptions {}

interface LegacyScheduleTriggerRecordV0 {
  schemaVersion: 0;
  kind: "trigger";
  id: string;
  workspaceId: string;
  scheduleId: string;
  createdAt: string;
  updatedAt: string;
  status: string;
  lastFiredAt: string | null;
  lastRunId: string | null;
  triggerKind?: string;
  configRef?: string | null;
  credentialRef?: string | null;
}

interface LegacyScheduleSubscriptionRecordV0 {
  schemaVersion: 0;
  kind: "subscription";
  id: string;
  workspaceId: string;
  scheduleId: string;
  createdAt: string;
  updatedAt: string;
  status: string;
  subscriberKind: string;
  subscriberId: string;
  triggerRef?: string;
  eventRef?: string;
  deliveryRef?: string | null;
  filterRef?: string | null;
}

export type ScheduleRecordV0 = ContractScheduleRecordV0 & {
  playbookId: string;
  scenarioId: string;
  ownerId: string;
  cadence: string;
};

export type ScheduleTriggerRecordV0 = ContractTriggerRecordV0 & {
  scheduleId: string;
  lastRunId: string | null;
};

export type ScheduleSubscriptionRecordV0 = ContractSubscriptionRecordV0 & {
  scheduleId: string;
  subscriberKind: string;
  subscriberId: string;
};

export const SCHEDULE_STORE_KINDS_V0 = [
  "schedule",
  "trigger",
  "subscription",
  "fire_record",
  "missed_run",
] as const;

export type ScheduleStoreKindV0 = typeof SCHEDULE_STORE_KINDS_V0[number];

export type ScheduleStoreRecordByKindV0 = {
  schedule: ScheduleRecordV0;
  trigger: ScheduleTriggerRecordV0;
  subscription: ScheduleSubscriptionRecordV0;
  fire_record: ScheduleFireRecordV0;
  missed_run: MissedRunRecordV0;
};

type ScheduleStoreWritableRecordByKindV0 = {
  schedule: ContractScheduleRecordV0 | ScheduleRecordV0 | GovernanceScheduleRecordV0;
  trigger: ContractTriggerRecordV0 | ScheduleTriggerRecordV0 | LegacyScheduleTriggerRecordV0;
  subscription:
    | ContractSubscriptionRecordV0
    | ScheduleSubscriptionRecordV0
    | LegacyScheduleSubscriptionRecordV0;
  fire_record: ScheduleFireRecordV0;
  missed_run: FireRecordByKindV0["missed_run"];
};

type ScheduleRecordValidator<K extends Exclude<ScheduleStoreKindV0, FireRecordKindV0>> = (
  value: unknown,
) => { ok: true; value: ScheduleStoreRecordByKindV0[K] } | { ok: false; errors: string[] };

const SCHEDULE_VALIDATORS: {
  [K in Exclude<ScheduleStoreKindV0, FireRecordKindV0>]: ScheduleRecordValidator<K>;
} = {
  schedule: validateScheduleRecordV0,
  trigger: validateScheduleTriggerRecordV0,
  subscription: validateScheduleSubscriptionRecordV0,
};

export class ScheduleStore {
  private readonly dataDir: string;
  private readonly fireRecords: FileFireRecordStore;

  constructor(opts: ScheduleStoreOptions = {}) {
    this.dataDir = opts.dataDir ?? process.env.PLUTO_DATA_DIR ?? ".pluto";
    this.fireRecords = createFileFireRecordStore({ dataDir: this.dataDir });
  }

  async put<K extends ScheduleStoreKindV0>(kind: K, record: ScheduleStoreWritableRecordByKindV0[K]): Promise<
    ScheduleStoreRecordByKindV0[K]
  >;
  async put(kind: ScheduleStoreKindV0, record: ScheduleStoreWritableRecordByKindV0[ScheduleStoreKindV0]) {
    if (isFireRecordKind(kind)) {
      return this.fireRecords.put(kind, record as FireRecordByKindV0[typeof kind]);
    }

    const validated = validateScheduleRecord(kind, record);
    await mkdir(this.kindDir(kind), { recursive: true });
    await writeFile(this.recordPath(kind, validated.id), JSON.stringify(validated, null, 2) + "\n", "utf8");
    return validated;
  }

  async get<K extends ScheduleStoreKindV0>(kind: K, id: string): Promise<ScheduleStoreRecordByKindV0[K] | null>;
  async get(kind: ScheduleStoreKindV0, id: string) {
    if (isFireRecordKind(kind)) {
      return this.fireRecords.get(kind, id);
    }

    try {
      const raw = await readFile(this.recordPath(kind, id), "utf8");
      return validateScheduleRecord(kind, JSON.parse(raw));
    } catch {
      return null;
    }
  }

  async list<K extends ScheduleStoreKindV0>(kind: K, workspaceId?: string): Promise<Array<ScheduleStoreRecordByKindV0[K]>>;
  async list(kind: ScheduleStoreKindV0, workspaceId?: string) {
    if (isFireRecordKind(kind)) {
      return this.fireRecords.list(kind, workspaceId);
    }

    try {
      const entries = await readdir(this.kindDir(kind), { withFileTypes: true });
      const ids = entries
        .filter((entry) => entry.isFile() && entry.name.endsWith(".json"))
        .sort((left, right) => left.name.localeCompare(right.name))
        .map((entry) => entry.name.slice(0, -5));

      const records: Array<ScheduleStoreRecordByKindV0[typeof kind]> = [];
      for (const id of ids) {
        const record = await this.get(kind, id);
        if (record !== null && (workspaceId === undefined || record.workspaceId === workspaceId)) {
          records.push(record);
        }
      }

      return records;
    } catch {
      return [];
    }
  }

  async update<K extends ScheduleStoreKindV0>(
    kind: K,
    id: string,
    patch: Partial<ScheduleStoreRecordByKindV0[K]>,
  ): Promise<ScheduleStoreRecordByKindV0[K] | null>;
  async update(
    kind: ScheduleStoreKindV0,
    id: string,
    patch: Partial<ScheduleStoreRecordByKindV0[ScheduleStoreKindV0]>,
  ) {
    if (isFireRecordKind(kind)) {
      return this.fireRecords.update(kind, id, patch as Partial<FireRecordByKindV0[typeof kind]>);
    }

    const current = await this.get(kind, id);
    if (current === null) {
      return null;
    }

    return this.put(kind, { ...current, ...patch } as ScheduleStoreRecordByKindV0[typeof kind]);
  }

  async listKinds(): Promise<ScheduleStoreKindV0[]> {
    return [...SCHEDULE_STORE_KINDS_V0];
  }

  private scheduleDir(): string {
    return join(this.dataDir, "schedule", "local-v0");
  }

  private kindDir(kind: Exclude<ScheduleStoreKindV0, FireRecordKindV0>): string {
    return join(this.scheduleDir(), kind);
  }

  private recordPath(kind: Exclude<ScheduleStoreKindV0, FireRecordKindV0>, id: string): string {
    return join(this.kindDir(kind), `${id}.json`);
  }
}

export function createFileScheduleStore(opts: ScheduleStoreOptions = {}): ScheduleStore {
  return new ScheduleStore(opts);
}

function isFireRecordKind(kind: ScheduleStoreKindV0): kind is FireRecordKindV0 {
  return kind === "fire_record" || kind === "missed_run";
}

function validateScheduleRecord<K extends Exclude<ScheduleStoreKindV0, FireRecordKindV0>>(
  kind: K,
  value: unknown,
): ScheduleStoreRecordByKindV0[K] {
  const result = SCHEDULE_VALIDATORS[kind](value);
  if (!result.ok) {
    throw new Error(`Invalid ${kind} record: ${result.errors.join(", ")}`);
  }

  return result.value;
}

function validateScheduleRecordV0(
  value: unknown,
): { ok: true; value: ScheduleRecordV0 } | { ok: false; errors: string[] } {
  let canonical: ContractScheduleRecordV0 & Partial<Pick<ScheduleRecordV0, "cadence">>;
  try {
    canonical = normalizeScheduleRecordV0(value);
  } catch (error) {
    return { ok: false, errors: [error instanceof Error ? error.message : String(error)] };
  }

  const validated = validateContractScheduleRecordV0(canonical);
  if (!validated.ok) {
    return validated;
  }

  return { ok: true, value: withScheduleCompatibility(validated.value, canonical) };
}

function validateScheduleTriggerRecordV0(
  value: unknown,
): { ok: true; value: ScheduleTriggerRecordV0 } | { ok: false; errors: string[] } {
  let canonical: ContractTriggerRecordV0 & Partial<Pick<ScheduleTriggerRecordV0, "scheduleId" | "lastRunId">>;
  try {
    canonical = normalizeScheduleTriggerRecordV0(value);
  } catch (error) {
    return { ok: false, errors: [error instanceof Error ? error.message : String(error)] };
  }

  const validated = validateContractTriggerRecordV0(canonical);
  if (!validated.ok) {
    return validated;
  }

  return { ok: true, value: withTriggerCompatibility(validated.value, canonical) };
}

function validateScheduleSubscriptionRecordV0(
  value: unknown,
): { ok: true; value: ScheduleSubscriptionRecordV0 } | { ok: false; errors: string[] } {
  let canonical: ContractSubscriptionRecordV0 & Partial<Pick<ScheduleSubscriptionRecordV0, "scheduleId" | "subscriberKind" | "subscriberId">>;
  try {
    canonical = normalizeScheduleSubscriptionRecordV0(value);
  } catch (error) {
    return { ok: false, errors: [error instanceof Error ? error.message : String(error)] };
  }

  const validated = validateContractSubscriptionRecordV0(canonical);
  if (!validated.ok) {
    return validated;
  }

  return { ok: true, value: withSubscriptionCompatibility(validated.value, canonical) };
}

function normalizeScheduleRecordV0(
  value: unknown,
): ContractScheduleRecordV0 & Partial<Pick<ScheduleRecordV0, "cadence">> {
  const canonical = validateContractScheduleRecordV0(value);
  if (canonical.ok) {
    return value as ContractScheduleRecordV0 & Partial<Pick<ScheduleRecordV0, "cadence">>;
  }

  const legacy = validateGovernanceScheduleRecordV0(value);
  if (!legacy.ok) {
    throw new Error(legacy.errors.join(", "));
  }

  return {
    schema: "pluto.schedule",
    schemaVersion: 0,
    kind: "schedule",
    id: legacy.value.id,
    workspaceId: legacy.value.workspaceId,
    playbookRef: toRef("playbook", legacy.value.playbookId),
    scenarioRef: toRef("scenario", legacy.value.scenarioId),
    ownerRef: toRef("user", legacy.value.ownerId),
    triggerRefs: [],
    subscriptionRefs: [],
    status: legacy.value.status,
    nextDueAt: null,
    lastTriggeredAt: null,
    createdAt: legacy.value.createdAt,
    updatedAt: legacy.value.updatedAt,
    cadence: legacy.value.cadence,
  };
}

function normalizeScheduleTriggerRecordV0(
  value: unknown,
): ContractTriggerRecordV0 & Partial<Pick<ScheduleTriggerRecordV0, "scheduleId" | "lastRunId">> {
  const canonical = validateContractTriggerRecordV0(value);
  if (canonical.ok) {
    return value as ContractTriggerRecordV0 & Partial<Pick<ScheduleTriggerRecordV0, "scheduleId" | "lastRunId">>;
  }

  const base = validateBaseRecord(
    value,
    "trigger",
    ["scheduleId"],
    ["lastFiredAt", "lastRunId"],
  );
  if (!base.ok) {
    throw new Error(base.errors.join(", "));
  }

  const record = base.value as unknown as LegacyScheduleTriggerRecordV0;
  return {
    schema: "pluto.schedule.trigger",
    schemaVersion: 0,
    kind: "trigger",
    id: record.id,
    workspaceId: record.workspaceId,
    scheduleRef: record.scheduleId,
    triggerKind: inferTriggerKind(record),
    status: record.status,
    configRef: record.configRef ?? null,
    credentialRef: record.credentialRef ?? null,
    lastFiredAt: record.lastFiredAt,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
    scheduleId: record.scheduleId,
    lastRunId: record.lastRunId,
  };
}

function normalizeScheduleSubscriptionRecordV0(
  value: unknown,
): ContractSubscriptionRecordV0 & Partial<Pick<ScheduleSubscriptionRecordV0, "scheduleId" | "subscriberKind" | "subscriberId">> {
  const canonical = validateContractSubscriptionRecordV0(value);
  if (canonical.ok) {
    return value as ContractSubscriptionRecordV0 & Partial<Pick<ScheduleSubscriptionRecordV0, "scheduleId" | "subscriberKind" | "subscriberId">>;
  }

  const base = validateBaseRecord(
    value,
    "subscription",
    ["scheduleId", "subscriberKind", "subscriberId"],
    [],
  );
  if (!base.ok) {
    throw new Error(base.errors.join(", "));
  }

  const record = base.value as unknown as LegacyScheduleSubscriptionRecordV0;
  return {
    schema: "pluto.schedule.subscription",
    schemaVersion: 0,
    kind: "subscription",
    id: record.id,
    workspaceId: record.workspaceId,
    scheduleRef: record.scheduleId,
    triggerRef: record.triggerRef ?? record.id,
    eventRef: record.eventRef ?? `${record.subscriberKind}:${record.subscriberId}`,
    deliveryRef: record.deliveryRef ?? null,
    filterRef: record.filterRef ?? null,
    status: record.status,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
    scheduleId: record.scheduleId,
    subscriberKind: record.subscriberKind,
    subscriberId: record.subscriberId,
  };
}

function withScheduleCompatibility(
  record: ContractScheduleRecordV0,
  source: Partial<Pick<ScheduleRecordV0, "cadence">>,
): ScheduleRecordV0 {
  return {
    ...record,
    playbookId: extractRefId(record.playbookRef),
    scenarioId: extractRefId(record.scenarioRef),
    ownerId: extractRefId(record.ownerRef),
    cadence: source.cadence ?? "",
  };
}

function withTriggerCompatibility(
  record: ContractTriggerRecordV0,
  source: Partial<Pick<ScheduleTriggerRecordV0, "scheduleId" | "lastRunId">>,
): ScheduleTriggerRecordV0 {
  return {
    ...record,
    scheduleId: source.scheduleId ?? record.scheduleRef,
    lastRunId: source.lastRunId ?? null,
  };
}

function withSubscriptionCompatibility(
  record: ContractSubscriptionRecordV0,
  source: Partial<Pick<ScheduleSubscriptionRecordV0, "scheduleId" | "subscriberKind" | "subscriberId">>,
): ScheduleSubscriptionRecordV0 {
  const [subscriberKind, subscriberId] = parseRefParts(record.eventRef);
  return {
    ...record,
    scheduleId: source.scheduleId ?? record.scheduleRef,
    subscriberKind: source.subscriberKind ?? subscriberKind,
    subscriberId: source.subscriberId ?? subscriberId,
  };
}

function inferTriggerKind(record: LegacyScheduleTriggerRecordV0): string {
  if (typeof record.triggerKind === "string") {
    return record.triggerKind;
  }

  if (typeof record.configRef === "string") {
    if (record.configRef.startsWith("cron:")) return "cron";
    if (record.configRef.startsWith("manual:")) return "manual";
  }

  return record.id.startsWith("manual:") ? "manual" : "cron";
}

function toRef(prefix: string, value: string): string {
  return value.includes(":") ? value : `${prefix}:${value}`;
}

function extractRefId(value: string): string {
  const [, ...rest] = value.split(":");
  return rest.length === 0 ? value : rest.join(":");
}

function parseRefParts(value: string): [string, string] {
  const [kind, ...rest] = value.split(":");
  return [kind ?? value, rest.join(":")];
}

function validateBaseRecord(
  value: unknown,
  expectedKind: "trigger" | "subscription",
  extraStringFields: readonly string[],
  extraNullableStringFields: readonly string[] = [],
): { ok: true; value: Record<string, unknown> } | { ok: false; errors: string[] } {
  if (typeof value !== "object" || value === null) {
    return { ok: false, errors: ["record must be an object"] };
  }

  const record = value as Record<string, unknown>;
  const errors: string[] = [];

  if (record["schemaVersion"] !== 0) {
    errors.push("schemaVersion must be 0");
  }

  if (record["kind"] !== expectedKind) {
    errors.push(`kind must be ${expectedKind}`);
  }

  validateStringField(record, "id", errors);
  validateStringField(record, "workspaceId", errors);
  validateStringField(record, "createdAt", errors);
  validateStringField(record, "updatedAt", errors);
  validateStringField(record, "status", errors);

  for (const field of extraStringFields) {
    validateStringField(record, field, errors);
  }

  for (const field of extraNullableStringFields) {
    validateNullableStringField(record, field, errors);
  }

  return errors.length === 0 ? { ok: true, value: record } : { ok: false, errors };
}

function validateStringField(record: Record<string, unknown>, field: string, errors: string[]): void {
  if (!Object.prototype.hasOwnProperty.call(record, field)) {
    errors.push(`missing required field: ${field}`);
    return;
  }

  if (typeof record[field] !== "string") {
    errors.push(`${field} must be a string`);
  }
}

function validateNullableStringField(record: Record<string, unknown>, field: string, errors: string[]): void {
  if (!Object.prototype.hasOwnProperty.call(record, field)) {
    errors.push(`missing required field: ${field}`);
    return;
  }

  const value = record[field];
  if (value !== null && typeof value !== "string") {
    errors.push(`${field} must be a string or null`);
  }
}
