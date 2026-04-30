import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

import {
  normalizeScheduleRunStatusV0,
  type MissedRunRecordV0 as ContractMissedRunRecordV0,
  validateMissedRunRecordV0 as validateContractMissedRunRecordV0,
} from "../contracts/schedule.js";

export interface FireRecordStoreOptions {
  dataDir?: string;
}

export interface ScheduleFireRecordV0 {
  schemaVersion: 0;
  kind: "fire_record";
  id: string;
  workspaceId: string;
  scheduleId: string;
  triggerId: string | null;
  runId: string | null;
  firedAt: string;
  createdAt: string;
  updatedAt: string;
  status: string;
}

interface LegacyMissedRunRecordV0 {
  schemaVersion: 0;
  kind: "missed_run";
  id: string;
  workspaceId: string;
  scheduleId: string;
  fireRecordId: string | null;
  expectedAt: string;
  recordedAt: string;
  createdAt: string;
  updatedAt: string;
  reason: string | null;
  status: string;
}

export type MissedRunRecordV0 = ContractMissedRunRecordV0 & {
  scheduleId: string;
  fireRecordId: string | null;
  reason: string | null;
};

export const FIRE_RECORD_KINDS_V0 = ["fire_record", "missed_run"] as const;

export type FireRecordKindV0 = typeof FIRE_RECORD_KINDS_V0[number];

export type FireRecordByKindV0 = {
  fire_record: ScheduleFireRecordV0;
  missed_run: MissedRunRecordV0;
};

type FireRecordWritableByKindV0 = {
  fire_record: ScheduleFireRecordV0;
  missed_run: ContractMissedRunRecordV0 | MissedRunRecordV0 | LegacyMissedRunRecordV0;
};

type FireRecordValidator<K extends FireRecordKindV0> = (
  value: unknown,
) => { ok: true; value: FireRecordByKindV0[K] } | { ok: false; errors: string[] };

const FIRE_RECORD_VALIDATORS: {
  [K in FireRecordKindV0]: FireRecordValidator<K>;
} = {
  fire_record: validateScheduleFireRecordV0,
  missed_run: validateMissedRunRecordV0,
};

export class FileFireRecordStore {
  private readonly dataDir: string;

  constructor(opts: FireRecordStoreOptions = {}) {
    this.dataDir = opts.dataDir ?? process.env.PLUTO_DATA_DIR ?? ".pluto";
  }

  async put<K extends FireRecordKindV0>(
    kind: K,
    record: FireRecordWritableByKindV0[K],
  ): Promise<FireRecordByKindV0[K]> {
    const validated = validateFireRecord(kind, record);
    await mkdir(this.kindDir(kind), { recursive: true });
    await writeFile(this.recordPath(kind, validated.id), JSON.stringify(validated, null, 2) + "\n", "utf8");
    return validated;
  }

  async get<K extends FireRecordKindV0>(kind: K, id: string): Promise<FireRecordByKindV0[K] | null> {
    try {
      const raw = await readFile(this.recordPath(kind, id), "utf8");
      return validateFireRecord(kind, JSON.parse(raw));
    } catch {
      return null;
    }
  }

  async list<K extends FireRecordKindV0>(kind: K, workspaceId?: string): Promise<Array<FireRecordByKindV0[K]>> {
    try {
      const entries = await readdir(this.kindDir(kind), { withFileTypes: true });
      const ids = entries
        .filter((entry) => entry.isFile() && entry.name.endsWith(".json"))
        .sort((left, right) => left.name.localeCompare(right.name))
        .map((entry) => entry.name.slice(0, -5));

      const records: Array<FireRecordByKindV0[K]> = [];
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

  async update<K extends FireRecordKindV0>(
    kind: K,
    id: string,
    patch: Partial<FireRecordByKindV0[K]>,
  ): Promise<FireRecordByKindV0[K] | null> {
    const current = await this.get(kind, id);
    if (current === null) {
      return null;
    }

    return this.put(kind, { ...current, ...patch } as FireRecordByKindV0[K]);
  }

  async listKinds(): Promise<FireRecordKindV0[]> {
    return [...FIRE_RECORD_KINDS_V0];
  }

  private fireRecordsDir(): string {
    return join(this.dataDir, "schedule", "local-v0", "fire-records");
  }

  private kindDir(kind: FireRecordKindV0): string {
    return join(this.fireRecordsDir(), kind);
  }

  private recordPath(kind: FireRecordKindV0, id: string): string {
    return join(this.kindDir(kind), `${id}.json`);
  }
}

export function createFileFireRecordStore(opts: FireRecordStoreOptions = {}): FileFireRecordStore {
  return new FileFireRecordStore(opts);
}

function validateFireRecord<K extends FireRecordKindV0>(kind: K, value: unknown): FireRecordByKindV0[K] {
  const result = FIRE_RECORD_VALIDATORS[kind](value);
  if (!result.ok) {
    throw new Error(`Invalid ${kind} record: ${result.errors.join(", ")}`);
  }

  return result.value;
}

function validateScheduleFireRecordV0(
  value: unknown,
): { ok: true; value: ScheduleFireRecordV0 } | { ok: false; errors: string[] } {
  const base = validateBaseRecord(value, "fire_record", ["scheduleId", "firedAt"], ["triggerId", "runId"]);
  if (!base.ok) {
    return base;
  }

  return { ok: true, value: base.value as unknown as ScheduleFireRecordV0 };
}

function validateMissedRunRecordV0(
  value: unknown,
): { ok: true; value: MissedRunRecordV0 } | { ok: false; errors: string[] } {
  let canonical: ContractMissedRunRecordV0 & Partial<Pick<MissedRunRecordV0, "scheduleId" | "fireRecordId" | "reason">>;
  try {
    canonical = normalizeMissedRunRecordV0(value);
  } catch (error) {
    return { ok: false, errors: [error instanceof Error ? error.message : String(error)] };
  }

  const validated = validateContractMissedRunRecordV0(canonical);
  if (!validated.ok) {
    return validated;
  }

  return { ok: true, value: withMissedRunCompatibility(validated.value, canonical) };
}

function normalizeMissedRunRecordV0(
  value: unknown,
): ContractMissedRunRecordV0 & Partial<Pick<MissedRunRecordV0, "scheduleId" | "fireRecordId" | "reason">> {
  const canonical = validateContractMissedRunRecordV0(value);
  if (canonical.ok) {
    return value as ContractMissedRunRecordV0 & Partial<Pick<MissedRunRecordV0, "scheduleId" | "fireRecordId" | "reason">>;
  }

  const base = validateBaseRecord(
    value,
    "missed_run",
    ["scheduleId", "expectedAt", "recordedAt", "reason"],
    ["fireRecordId"],
  );
  if (!base.ok) {
    throw new Error(base.errors.join(", "));
  }

  const record = base.value as unknown as LegacyMissedRunRecordV0;
  return {
    schema: "pluto.schedule.missed-run",
    schemaVersion: 0,
    kind: "missed_run",
    id: record.id,
    workspaceId: record.workspaceId,
    scheduleRef: record.scheduleId,
    triggerRef: null,
    expectedAt: record.expectedAt,
    status: normalizeScheduleRunStatusV0(record.status) ?? record.status,
    blockerReason: record.reason,
    lastAttemptRunRef: null,
    recordedAt: record.recordedAt,
    resolvedAt: record.status === "resolved" ? record.updatedAt : null,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
    scheduleId: record.scheduleId,
    fireRecordId: record.fireRecordId,
    reason: record.reason,
  };
}

function withMissedRunCompatibility(
  record: ContractMissedRunRecordV0,
  source: Partial<Pick<MissedRunRecordV0, "scheduleId" | "fireRecordId" | "reason">>,
): MissedRunRecordV0 {
  return {
    ...record,
    scheduleId: source.scheduleId ?? record.scheduleRef,
    fireRecordId: source.fireRecordId ?? null,
    reason: source.reason ?? record.blockerReason,
  };
}

function validateBaseRecord(
  value: unknown,
  expectedKind: FireRecordKindV0,
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
