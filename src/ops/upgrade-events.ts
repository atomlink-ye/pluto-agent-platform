import { appendFile, mkdir, readFile } from "node:fs/promises";
import { join } from "node:path";

import type {
  BackupManifestV0,
  HealthSignalV0,
  RollbackPlaybookV0,
  UpgradeGateV0,
  UpgradePlanV0,
  UpgradeRunV0,
} from "../contracts/ops.js";

export const UPGRADE_LOCAL_EVENT_TYPES_V0 = [
  "install_recorded",
  "activation_recorded",
  "revocation_recorded",
  "approval_recorded",
  "decision_recorded",
  "backup_verification_recorded",
  "gate_evaluated",
  "execution_started",
  "phase_transition_recorded",
  "health_validation_recorded",
  "completion_recorded",
  "failure_recorded",
  "rollback_prepared",
  "rollback_recorded",
  "idempotent_replay_reused",
  "conflicting_terminal_outcome_rejected",
] as const;

export type UpgradeLocalEventTypeV0 = typeof UPGRADE_LOCAL_EVENT_TYPES_V0[number];

export interface UpgradeLocalRefV0 {
  workspaceId: string;
  kind: string;
  id: string;
}

export interface UpgradeLocalEventV0 {
  schema: "pluto.ops.upgrade-event";
  schemaVersion: 0;
  eventId: string;
  eventType: UpgradeLocalEventTypeV0;
  workspaceId: string;
  planId: string;
  upgradeRunId: string | null;
  occurredAt: string;
  actorId: string;
  subjectRef: UpgradeLocalRefV0;
  objectRef: UpgradeLocalRefV0;
  evidenceRefs: string[];
  details: Record<string, string | null>;
}

export interface UpgradeLocalEventQueryV0 {
  eventType?: UpgradeLocalEventTypeV0 | UpgradeLocalEventTypeV0[];
  planId?: string;
  upgradeRunId?: string;
  actorId?: string;
  since?: string;
  until?: string;
}

export interface CreateUpgradeLocalEventInputV0 {
  eventId?: string;
  eventType: UpgradeLocalEventTypeV0;
  workspaceId: string;
  planId: string;
  upgradeRunId?: string | null;
  occurredAt: string;
  actorId: string;
  subjectRef: UpgradeLocalRefV0;
  objectRef: UpgradeLocalRefV0;
  evidenceRefs?: readonly string[];
  details?: Record<string, string | null | undefined>;
}

export interface UpgradeEventStoreOptions {
  dataDir?: string;
}

const UPGRADE_LOCAL_EVENT_TYPE_SET = new Set<string>(UPGRADE_LOCAL_EVENT_TYPES_V0);

export class UpgradeEventStore {
  private readonly dataDir: string;

  constructor(options: UpgradeEventStoreOptions = {}) {
    this.dataDir = options.dataDir ?? process.env.PLUTO_DATA_DIR ?? ".pluto";
  }

  async append(event: UpgradeLocalEventV0): Promise<UpgradeLocalEventV0> {
    const validated = requireUpgradeLocalEvent(event);
    await mkdir(this.eventDir(), { recursive: true });
    await appendFile(this.eventLogPath(), `${JSON.stringify(validated)}\n`, "utf8");
    return validated;
  }

  async list(query: UpgradeLocalEventQueryV0 = {}): Promise<UpgradeLocalEventV0[]> {
    const raw = await this.readAll();
    const eventTypes = query.eventType === undefined
      ? null
      : new Set(Array.isArray(query.eventType) ? query.eventType : [query.eventType]);

    return raw.filter((event) => {
      if (eventTypes !== null && !eventTypes.has(event.eventType)) {
        return false;
      }
      if (query.planId !== undefined && event.planId !== query.planId) {
        return false;
      }
      if (query.upgradeRunId !== undefined && event.upgradeRunId !== query.upgradeRunId) {
        return false;
      }
      if (query.actorId !== undefined && event.actorId !== query.actorId) {
        return false;
      }
      if (query.since !== undefined && event.occurredAt < query.since) {
        return false;
      }
      if (query.until !== undefined && event.occurredAt > query.until) {
        return false;
      }
      return true;
    });
  }

  async get(eventId: string): Promise<UpgradeLocalEventV0 | null> {
    const events = await this.readAll();
    return events.find((event) => event.eventId === eventId) ?? null;
  }

  private async readAll(): Promise<UpgradeLocalEventV0[]> {
    let raw: string;
    try {
      raw = await readFile(this.eventLogPath(), "utf8");
    } catch {
      return [];
    }

    return raw
      .split("\n")
      .filter((line) => line.trim().length > 0)
      .map((line) => requireUpgradeLocalEvent(JSON.parse(line)));
  }

  private eventDir(): string {
    return join(this.dataDir, "ops", "upgrade", "local-v0", "audit-events");
  }

  private eventLogPath(): string {
    return join(this.eventDir(), "events.jsonl");
  }
}

export function createUpgradeLocalEventV0(input: CreateUpgradeLocalEventInputV0): UpgradeLocalEventV0 {
  const details = Object.fromEntries(
    Object.entries(input.details ?? {}).map(([key, value]) => [key, value ?? null]),
  ) as Record<string, string | null>;

  return {
    schema: "pluto.ops.upgrade-event",
    schemaVersion: 0,
    eventId: input.eventId ?? buildUpgradeLocalEventIdV0(input),
    eventType: input.eventType,
    workspaceId: input.workspaceId,
    planId: input.planId,
    upgradeRunId: input.upgradeRunId ?? null,
    occurredAt: input.occurredAt,
    actorId: input.actorId,
    subjectRef: input.subjectRef,
    objectRef: input.objectRef,
    evidenceRefs: uniqueStrings(input.evidenceRefs ?? []),
    details,
  };
}

export function buildUpgradeLocalEventIdV0(input: {
  eventType: UpgradeLocalEventTypeV0;
  planId: string;
  upgradeRunId?: string | null;
  occurredAt: string;
}): string {
  return [
    input.occurredAt,
    input.eventType,
    input.planId,
    input.upgradeRunId ?? "plan",
  ].join(":");
}

export function toUpgradePlanRefV0(plan: UpgradePlanV0): UpgradeLocalRefV0 {
  return {
    workspaceId: plan.workspaceId,
    kind: "upgrade_plan",
    id: plan.id,
  };
}

export function toUpgradeRunRefV0(run: UpgradeRunV0): UpgradeLocalRefV0 {
  return {
    workspaceId: run.workspaceId,
    kind: "upgrade_run",
    id: run.id,
  };
}

export function toBackupManifestRefV0(manifest: BackupManifestV0): UpgradeLocalRefV0 {
  return {
    workspaceId: manifest.workspaceId,
    kind: "backup_manifest",
    id: manifest.id,
  };
}

export function toHealthSignalRefV0(signal: HealthSignalV0): UpgradeLocalRefV0 {
  return {
    workspaceId: signal.workspaceId,
    kind: "health_signal",
    id: signal.id,
  };
}

export function toRollbackPlaybookRefV0(playbook: RollbackPlaybookV0): UpgradeLocalRefV0 {
  return {
    workspaceId: playbook.workspaceId,
    kind: "rollback_playbook",
    id: playbook.id,
  };
}

export function toUpgradeGateRefV0(gate: UpgradeGateV0): UpgradeLocalRefV0 {
  return {
    workspaceId: gate.workspaceId,
    kind: "upgrade_gate",
    id: gate.id,
  };
}

export function validateUpgradeLocalEventV0(value: unknown):
  | { ok: true; value: UpgradeLocalEventV0 }
  | { ok: false; errors: string[] } {
  const record = asRecord(value);
  if (record === null) {
    return { ok: false, errors: ["record must be an object"] };
  }

  const errors: string[] = [];
  if (record["schema"] !== "pluto.ops.upgrade-event") {
    errors.push("schema must be pluto.ops.upgrade-event");
  }
  if (record["schemaVersion"] !== 0) {
    errors.push("schemaVersion must be 0");
  }
  validateStringField(record, "eventId", errors);
  validateStringField(record, "workspaceId", errors);
  validateStringField(record, "planId", errors);
  validateNullableStringField(record, "upgradeRunId", errors);
  validateStringField(record, "occurredAt", errors);
  validateStringField(record, "actorId", errors);

  if (!UPGRADE_LOCAL_EVENT_TYPE_SET.has(String(record["eventType"] ?? ""))) {
    errors.push(`eventType must be one of: ${UPGRADE_LOCAL_EVENT_TYPES_V0.join(", ")}`);
  }

  validateRefField(record, "subjectRef", errors);
  validateRefField(record, "objectRef", errors);
  validateStringArrayField(record, "evidenceRefs", errors);
  validateDetailsField(record, "details", errors);

  return errors.length === 0
    ? { ok: true, value: record as unknown as UpgradeLocalEventV0 }
    : { ok: false, errors };
}

function requireUpgradeLocalEvent(value: unknown): UpgradeLocalEventV0 {
  const result = validateUpgradeLocalEventV0(value);
  if (!result.ok) {
    throw new Error(`Invalid upgrade event: ${result.errors.join(", ")}`);
  }

  return result.value;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (typeof value !== "object" || value === null) {
    return null;
  }

  return value as Record<string, unknown>;
}

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
  if (!Array.isArray(record[field]) || record[field].some((entry) => typeof entry !== "string")) {
    errors.push(`${field} must be an array of strings`);
  }
}

function validateRefField(record: Record<string, unknown>, field: string, errors: string[]): void {
  const ref = asRecord(record[field]);
  if (ref === null) {
    errors.push(`${field} must be an object`);
    return;
  }

  validateStringField(ref, "workspaceId", errors);
  validateStringField(ref, "kind", errors);
  validateStringField(ref, "id", errors);
}

function validateDetailsField(record: Record<string, unknown>, field: string, errors: string[]): void {
  const details = asRecord(record[field]);
  if (details === null) {
    errors.push(`${field} must be an object`);
    return;
  }

  for (const [key, value] of Object.entries(details)) {
    if (typeof key !== "string") {
      errors.push(`${field} keys must be strings`);
      break;
    }
    if (value !== null && typeof value !== "string") {
      errors.push(`${field} values must be strings or null`);
      break;
    }
  }
}

function uniqueStrings(values: readonly string[]): string[] {
  return [...new Set(values.filter((value) => value.length > 0))];
}
