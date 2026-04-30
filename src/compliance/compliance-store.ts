import { appendFile, mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

import type {
  AuditExportManifestV0 as ContractAuditExportManifestV0,
  ComplianceEvidenceV0 as ContractComplianceEvidenceV0,
  DeletionAttemptV0 as ContractDeletionAttemptV0,
  LegalHoldV0 as ContractLegalHoldV0,
  RetentionPolicyV0 as ContractRetentionPolicyV0,
} from "../contracts/compliance.js";
import {
  validateAuditExportManifestV0 as validateContractAuditExportManifestV0,
  validateComplianceEvidenceV0 as validateContractComplianceEvidenceV0,
  validateDeletionAttemptV0 as validateContractDeletionAttemptV0,
  validateLegalHoldV0 as validateContractLegalHoldV0,
  validateRetentionPolicyV0 as validateContractRetentionPolicyV0,
} from "../contracts/compliance.js";

export const COMPLIANCE_RECORD_KINDS_V0 = [
  "retention_policy",
  "legal_hold",
  "deletion_attempt",
  "evidence",
  "audit_export_manifest",
] as const;

export type ComplianceRecordKindV0 = typeof COMPLIANCE_RECORD_KINDS_V0[number];

export interface ComplianceStoreOptions {
  dataDir?: string;
}

export interface ComplianceTargetRefV0 {
  kind: string;
  recordId: string;
  workspaceId?: string;
  documentId?: string;
  versionId?: string;
  packageId?: string;
  summary?: string;
}

export type RetentionPolicyV0 = ContractRetentionPolicyV0;
export type LegalHoldV0 = ContractLegalHoldV0;
export type DeletionAttemptV0 = ContractDeletionAttemptV0;
export type ComplianceEvidenceV0 = ContractComplianceEvidenceV0;
export type AuditExportManifestV0 = ContractAuditExportManifestV0;

export type ComplianceRecordByKindV0 = {
  retention_policy: RetentionPolicyV0;
  legal_hold: LegalHoldV0;
  deletion_attempt: DeletionAttemptV0;
  evidence: ComplianceEvidenceV0;
  audit_export_manifest: AuditExportManifestV0;
};

export type ComplianceRecordV0 = ComplianceRecordByKindV0[ComplianceRecordKindV0];

export interface ComplianceActionEventV0 {
  schema: "pluto.compliance.action-event";
  schemaVersion: 0;
  id: string;
  eventType: string;
  action: string;
  actor: {
    principalId: string;
    roleLabels?: string[];
  };
  target: ComplianceTargetRefV0;
  status: {
    before: string | null;
    after: string | null;
    summary: string;
  };
  evidenceRefs: string[];
  reason: string | null;
  createdAt: string;
  source: {
    command: string;
    ref: string | null;
  };
}

export interface ComplianceEventQueryV0 {
  actorId?: string;
  action?: string;
  eventType?: string;
  targetKind?: string;
  targetRecordId?: string;
}

type ComplianceRecordValidator<K extends ComplianceRecordKindV0> = (
  value: unknown,
) => { ok: true; value: ComplianceRecordByKindV0[K] } | { ok: false; errors: string[] };

const COMPLIANCE_RECORD_VALIDATORS: {
  [K in ComplianceRecordKindV0]: ComplianceRecordValidator<K>;
} = {
  retention_policy: validateRetentionPolicyV0,
  legal_hold: validateLegalHoldV0,
  deletion_attempt: validateDeletionAttemptV0,
  evidence: validateComplianceEvidenceV0,
  audit_export_manifest: validateAuditExportManifestV0,
};

export function complianceDir(dataDir: string, kind?: ComplianceRecordKindV0): string {
  return kind === undefined
    ? join(dataDir, "compliance")
    : join(dataDir, "compliance", kind);
}

export function complianceEventsDir(dataDir: string): string {
  return join(complianceDir(dataDir), "events");
}

export class ComplianceStore {
  private readonly dataDir: string;

  constructor(options: ComplianceStoreOptions = {}) {
    this.dataDir = options.dataDir ?? process.env.PLUTO_DATA_DIR ?? ".pluto";
  }

  async put<K extends ComplianceRecordKindV0>(
    kind: K,
    record: ComplianceRecordByKindV0[K],
  ): Promise<ComplianceRecordByKindV0[K]> {
    const validated = validateComplianceRecord(kind, record);
    const dir = complianceDir(this.dataDir, kind);
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, `${validated.id}.json`), JSON.stringify(validated, null, 2) + "\n", "utf8");
    return validated;
  }

  async get<K extends ComplianceRecordKindV0>(
    kind: K,
    id: string,
  ): Promise<ComplianceRecordByKindV0[K] | null> {
    let raw: string;
    try {
      raw = await readFile(join(complianceDir(this.dataDir, kind), `${id}.json`), "utf8");
    } catch {
      return null;
    }

    return validateComplianceRecord(kind, JSON.parse(raw));
  }

  async list<K extends ComplianceRecordKindV0>(kind: K): Promise<Array<ComplianceRecordByKindV0[K]>> {
    let entries: string[];
    try {
      entries = await readdir(complianceDir(this.dataDir, kind));
    } catch {
      return [];
    }

    const ids = entries
      .filter((entry) => entry.endsWith(".json"))
      .map((entry) => entry.slice(0, -5))
      .sort((left, right) => left.localeCompare(right));

    const records: Array<ComplianceRecordByKindV0[K]> = [];
    for (const id of ids) {
      const record = await this.get(kind, id);
      if (record !== null) {
        records.push(record);
      }
    }

    return records;
  }

  async listKinds(): Promise<ComplianceRecordKindV0[]> {
    return [...COMPLIANCE_RECORD_KINDS_V0];
  }

  async recordEvent(event: ComplianceActionEventV0): Promise<ComplianceActionEventV0> {
    const validated = validateComplianceActionEvent(event);
    await mkdir(complianceEventsDir(this.dataDir), { recursive: true });
    await appendFile(this.eventLogPath(), `${JSON.stringify(validated)}\n`, "utf8");
    return validated;
  }

  async getEvent(id: string): Promise<ComplianceActionEventV0 | null> {
    const events = await this.listEvents();
    return events.find((event) => event.id === id) ?? null;
  }

  async listEvents(query: ComplianceEventQueryV0 = {}): Promise<ComplianceActionEventV0[]> {
    const events = await this.readAllEvents();
    return events.filter((event) => {
      if (query.actorId !== undefined && event.actor.principalId !== query.actorId) {
        return false;
      }
      if (query.action !== undefined && event.action !== query.action) {
        return false;
      }
      if (query.eventType !== undefined && event.eventType !== query.eventType) {
        return false;
      }
      if (query.targetKind !== undefined && event.target.kind !== query.targetKind) {
        return false;
      }
      if (query.targetRecordId !== undefined && event.target.recordId !== query.targetRecordId) {
        return false;
      }
      return true;
    });
  }

  private async readAllEvents(): Promise<ComplianceActionEventV0[]> {
    let raw: string;
    try {
      raw = await readFile(this.eventLogPath(), "utf8");
    } catch {
      return [];
    }

    return raw
      .split("\n")
      .filter((line) => line.trim().length > 0)
      .map((line) => validateComplianceActionEvent(JSON.parse(line)));
  }

  private eventLogPath(): string {
    return join(complianceEventsDir(this.dataDir), "events.jsonl");
  }
}

function validateComplianceRecord<K extends ComplianceRecordKindV0>(
  kind: K,
  value: unknown,
): ComplianceRecordByKindV0[K] {
  const result = COMPLIANCE_RECORD_VALIDATORS[kind](value);
  if (!result.ok) {
    throw new Error(`Invalid ${kind} record: ${result.errors.join(", ")}`);
  }

  return result.value;
}

function validateComplianceActionEvent(value: unknown): ComplianceActionEventV0 {
  const record = asRecord(value);
  if (record === null) {
    throw new Error("Invalid compliance event: event must be an object");
  }

  const errors: string[] = [];
  validateCommonFields(record, ["schema", "schemaVersion", "id", "eventType", "action", "createdAt"], errors);

  if (record["schema"] !== "pluto.compliance.action-event") {
    errors.push("schema must be pluto.compliance.action-event");
  }
  if (record["schemaVersion"] !== 0) {
    errors.push("schemaVersion must be 0");
  }

  validateActor(record["actor"], errors);
  validateTargetRef(record["target"], "target", errors);
  validateStatusRecord(record["status"], errors);
  validateStringArray(record["evidenceRefs"], "evidenceRefs", errors);
  validateNullableString(record["reason"], "reason", errors);
  validateSourceRecord(record["source"], errors);

  if (errors.length > 0) {
    throw new Error(`Invalid compliance event: ${errors.join(", ")}`);
  }

  return record as unknown as ComplianceActionEventV0;
}

function validateRetentionPolicyV0(
  value: unknown,
): { ok: true; value: RetentionPolicyV0 } | { ok: false; errors: string[] } {
  return validateContractRetentionPolicyV0(value);
}

function validateLegalHoldV0(
  value: unknown,
): { ok: true; value: LegalHoldV0 } | { ok: false; errors: string[] } {
  return validateContractLegalHoldV0(value);
}

function validateDeletionAttemptV0(
  value: unknown,
): { ok: true; value: DeletionAttemptV0 } | { ok: false; errors: string[] } {
  return validateContractDeletionAttemptV0(value);
}

function validateComplianceEvidenceV0(
  value: unknown,
): { ok: true; value: ComplianceEvidenceV0 } | { ok: false; errors: string[] } {
  return validateContractComplianceEvidenceV0(value);
}

function validateAuditExportManifestV0(
  value: unknown,
): { ok: true; value: AuditExportManifestV0 } | { ok: false; errors: string[] } {
  return validateContractAuditExportManifestV0(value);
}

function validateCommonFields(
  record: Record<string, unknown>,
  fields: string[],
  errors: string[],
): void {
  for (const field of fields) {
    if (!Object.prototype.hasOwnProperty.call(record, field)) {
      errors.push(`missing required field: ${field}`);
      continue;
    }

    if (field === "schemaVersion") {
      if (record[field] !== 0) {
        errors.push("schemaVersion must be 0");
      }
      continue;
    }

    if (typeof record[field] !== "string" && !Array.isArray(record[field])) {
      errors.push(`${field} must be a string`);
    }
  }
}

function validateActor(value: unknown, errors: string[]): void {
  const actor = asRecord(value);
  if (actor === null) {
    errors.push("actor must be an object");
    return;
  }

  if (typeof actor["principalId"] !== "string") {
    errors.push("actor.principalId must be a string");
  }
  if (actor["roleLabels"] !== undefined) {
    validateStringArray(actor["roleLabels"], "actor.roleLabels", errors);
  }
}

function validateTargetRef(value: unknown, field: string, errors: string[]): void {
  const target = asRecord(value);
  if (target === null) {
    errors.push(`${field} must be an object`);
    return;
  }

  if (typeof target["kind"] !== "string") {
    errors.push(`${field}.kind must be a string`);
  }
  if (typeof target["recordId"] !== "string") {
    errors.push(`${field}.recordId must be a string`);
  }

  for (const optional of ["workspaceId", "documentId", "versionId", "packageId", "summary"]) {
    if (target[optional] !== undefined && typeof target[optional] !== "string") {
      errors.push(`${field}.${optional} must be a string when present`);
    }
  }
}

function validateStatusRecord(value: unknown, errors: string[]): void {
  const status = asRecord(value);
  if (status === null) {
    errors.push("status must be an object");
    return;
  }

  validateNullableString(status["before"], "status.before", errors);
  validateNullableString(status["after"], "status.after", errors);
  if (typeof status["summary"] !== "string") {
    errors.push("status.summary must be a string");
  }
}

function validateSourceRecord(value: unknown, errors: string[]): void {
  const source = asRecord(value);
  if (source === null) {
    errors.push("source must be an object");
    return;
  }

  if (typeof source["command"] !== "string") {
    errors.push("source.command must be a string");
  }
  validateNullableString(source["ref"], "source.ref", errors);
}

function validateStringArray(value: unknown, field: string, errors: string[]): void {
  if (!Array.isArray(value) || value.some((entry) => typeof entry !== "string")) {
    errors.push(`${field} must be an array of strings`);
  }
}

function validateNullableString(value: unknown, field: string, errors: string[]): void {
  if (value !== null && typeof value !== "string") {
    errors.push(`${field} must be a string or null`);
  }
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (typeof value !== "object" || value === null) {
    return null;
  }

  return value as Record<string, unknown>;
}
