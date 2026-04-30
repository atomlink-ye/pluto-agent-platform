import type { GovernanceRecordValidationResult } from "./governance.js";

export const UPGRADE_RUN_STATUSES_V0 = [
  "planned",
  "approved",
  "backingUp",
  "running",
  "validating",
  "healthCheck",
  "completed",
  "rolledBack",
  "failed",
] as const;

export const UPGRADE_GATE_KEYS_V0 = [
  "approval",
  "backup",
  "runtime_pairing",
  "health_check",
  "rollback_readiness",
] as const;

export const UPGRADE_GATE_STATUSES_V0 = ["pending", "passed", "blocked"] as const;

export const HEALTH_SIGNAL_STATUSES_V0 = ["healthy", "degraded", "failed"] as const;

export const RUNTIME_PAIRING_STATUSES_V0 = ["pending", "paired", "succeeded", "failed"] as const;

export type UpgradeRunStatusV0 = typeof UPGRADE_RUN_STATUSES_V0[number];
export type UpgradeRunStatusLikeV0 = UpgradeRunStatusV0 | (string & {});
export type UpgradeGateKeyV0 = typeof UPGRADE_GATE_KEYS_V0[number];
export type UpgradeGateKeyLikeV0 = UpgradeGateKeyV0 | (string & {});
export type UpgradeGateStatusV0 = typeof UPGRADE_GATE_STATUSES_V0[number];
export type UpgradeGateStatusLikeV0 = UpgradeGateStatusV0 | (string & {});
export type HealthSignalStatusV0 = typeof HEALTH_SIGNAL_STATUSES_V0[number];
export type HealthSignalStatusLikeV0 = HealthSignalStatusV0 | (string & {});
export type RuntimePairingStatusV0 = typeof RUNTIME_PAIRING_STATUSES_V0[number];
export type RuntimePairingStatusLikeV0 = RuntimePairingStatusV0 | "done" | (string & {});

interface UpgradeRecordRefsV0 {
  approvalRefs: string[];
  backupRefs: string[];
  healthRefs: string[];
  rollbackRefs: string[];
  evidenceRefs: string[];
}

interface UpgradeRuntimeScopeV0 {
  workspaceId: string;
  sourceRuntimeVersion: string;
  targetRuntimeVersion: string;
}

export interface UpgradePlanV0 extends UpgradeRuntimeScopeV0, UpgradeRecordRefsV0 {
  schema: "pluto.ops.upgrade-plan";
  schemaVersion: 0;
  id: string;
  requestedById: string;
  status: UpgradeRunStatusLikeV0;
  summary: string;
  createdAt: string;
  updatedAt: string;
}

export interface UpgradeRunV0 extends UpgradeRuntimeScopeV0, UpgradeRecordRefsV0 {
  schema: "pluto.ops.upgrade-run";
  schemaVersion: 0;
  id: string;
  planId: string;
  status: UpgradeRunStatusLikeV0;
  lastTransitionAt: string;
  lastTransitionKey: string | null;
  startedAt: string | null;
  finishedAt: string | null;
  failureReason: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface BackupManifestV0 extends UpgradeRuntimeScopeV0, UpgradeRecordRefsV0 {
  schema: "pluto.ops.backup-manifest";
  schemaVersion: 0;
  id: string;
  planId: string;
  upgradeRunId: string;
  manifestRef: string;
  createdAt: string;
}

export interface UpgradeGateV0 extends UpgradeRuntimeScopeV0, UpgradeRecordRefsV0 {
  schema: "pluto.ops.upgrade-gate";
  schemaVersion: 0;
  id: string;
  planId: string;
  upgradeRunId: string;
  gateKey: UpgradeGateKeyLikeV0;
  status: UpgradeGateStatusLikeV0;
  summary: string;
  checkedAt: string;
}

export interface HealthSignalV0 extends UpgradeRuntimeScopeV0, UpgradeRecordRefsV0 {
  schema: "pluto.ops.health-signal";
  schemaVersion: 0;
  id: string;
  planId: string;
  upgradeRunId: string;
  signalKey: string;
  status: HealthSignalStatusLikeV0;
  summary: string;
  recordedAt: string;
}

export interface RollbackPlaybookV0 extends UpgradeRuntimeScopeV0, UpgradeRecordRefsV0 {
  schema: "pluto.ops.rollback-playbook";
  schemaVersion: 0;
  id: string;
  planId: string;
  upgradeRunId: string;
  triggerSummary: string;
  steps: string[];
  createdAt: string;
  updatedAt: string;
}

export interface RuntimePairingStateV0 extends UpgradeRuntimeScopeV0, UpgradeRecordRefsV0 {
  schema: "pluto.ops.runtime-pairing-state";
  schemaVersion: 0;
  id: string;
  planId: string;
  upgradeRunId: string;
  status: RuntimePairingStatusLikeV0;
  pairedRuntimeIds: string[];
  createdAt: string;
  updatedAt: string;
}

export interface UpgradeReadinessItemV0 {
  schemaVersion: 0;
  workspaceId: string;
  planId: string;
  upgradeRunId: string;
  planStatus: string | null;
  runStatus: string;
  backupVerified: boolean;
  verifiedBackupCount: number;
  latestHealthStatus: string | null;
  rollbackPrepared: boolean;
  rollbackPlaybookCount: number;
  gateStatus: Record<UpgradeGateKeyV0, UpgradeGateStatusLikeV0 | "missing">;
  blockingGateKeys: UpgradeGateKeyV0[];
  pendingGateKeys: UpgradeGateKeyV0[];
  recentEventTypes: string[];
  evidenceRefs: string[];
  ready: boolean;
}

export type UpgradeRecordV0 =
  | UpgradePlanV0
  | UpgradeRunV0
  | BackupManifestV0
  | UpgradeGateV0
  | HealthSignalV0
  | RollbackPlaybookV0
  | RuntimePairingStateV0;

export type UpgradeRecordSchemaV0 = UpgradeRecordV0["schema"];

const UPGRADE_RUN_STATUS_SET = new Set<string>(UPGRADE_RUN_STATUSES_V0);
const UPGRADE_GATE_KEY_SET = new Set<string>(UPGRADE_GATE_KEYS_V0);
const UPGRADE_GATE_STATUS_SET = new Set<string>(UPGRADE_GATE_STATUSES_V0);
const HEALTH_SIGNAL_STATUS_SET = new Set<string>(HEALTH_SIGNAL_STATUSES_V0);
const RUNTIME_PAIRING_STATUS_SET = new Set<string>(RUNTIME_PAIRING_STATUSES_V0);

function hasOwnProperty(object: Record<string, unknown>, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(object, key);
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (typeof value !== "object" || value === null) {
    return null;
  }

  return value as Record<string, unknown>;
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

function validateBooleanField(record: Record<string, unknown>, field: string, errors: string[]): void {
  if (!hasOwnProperty(record, field)) {
    errors.push(`missing required field: ${field}`);
    return;
  }

  if (typeof record[field] !== "boolean") {
    errors.push(`${field} must be a boolean`);
  }
}

function validateNumberField(record: Record<string, unknown>, field: string, errors: string[]): void {
  if (!hasOwnProperty(record, field)) {
    errors.push(`missing required field: ${field}`);
    return;
  }

  if (typeof record[field] !== "number" || Number.isNaN(record[field])) {
    errors.push(`${field} must be a number`);
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

function uniqueStrings(values: readonly string[]): string[] {
  return [...new Set(values)];
}

function validateUpgradeRecordBase(
  value: unknown,
  expectedSchema: UpgradeRecordSchemaV0,
): GovernanceRecordValidationResult<Record<string, unknown>> {
  const record = asRecord(value);
  if (!record) {
    return { ok: false, errors: ["record must be an object"] };
  }

  const errors: string[] = [];
  if (record["schema"] !== expectedSchema) {
    errors.push(`schema must be ${expectedSchema}`);
  }

  if (record["schemaVersion"] !== 0) {
    errors.push("schemaVersion must be 0");
  }

  validateStringField(record, "id", errors);
  validateStringField(record, "workspaceId", errors);
  validateStringField(record, "sourceRuntimeVersion", errors);
  validateStringField(record, "targetRuntimeVersion", errors);
  validateStringArrayField(record, "approvalRefs", errors);
  validateStringArrayField(record, "backupRefs", errors);
  validateStringArrayField(record, "healthRefs", errors);
  validateStringArrayField(record, "rollbackRefs", errors);
  validateStringArrayField(record, "evidenceRefs", errors);

  return errors.length === 0 ? { ok: true, value: record } : { ok: false, errors };
}

function validateStringStatusField(record: Record<string, unknown>, field: string, errors: string[]): void {
  validateStringField(record, field, errors);
}

export function parseUpgradeRunStatusV0(value: unknown): UpgradeRunStatusLikeV0 | null {
  if (typeof value !== "string") return null;
  if (UPGRADE_RUN_STATUS_SET.has(value)) {
    return value as UpgradeRunStatusV0;
  }

  return value;
}

export function parseUpgradeGateKeyV0(value: unknown): UpgradeGateKeyLikeV0 | null {
  if (typeof value !== "string") return null;
  if (UPGRADE_GATE_KEY_SET.has(value)) {
    return value as UpgradeGateKeyV0;
  }

  return value;
}

export function parseUpgradeGateStatusV0(value: unknown): UpgradeGateStatusLikeV0 | null {
  if (typeof value !== "string") return null;
  if (UPGRADE_GATE_STATUS_SET.has(value)) {
    return value as UpgradeGateStatusV0;
  }

  return value;
}

export function parseHealthSignalStatusV0(value: unknown): HealthSignalStatusLikeV0 | null {
  if (typeof value !== "string") return null;
  if (HEALTH_SIGNAL_STATUS_SET.has(value)) {
    return value as HealthSignalStatusV0;
  }

  return value;
}

export function parseRuntimePairingStatusV0(value: unknown): RuntimePairingStatusLikeV0 | null {
  if (typeof value !== "string") return null;
  if (value === "done") return value;
  if (RUNTIME_PAIRING_STATUS_SET.has(value)) {
    return value as RuntimePairingStatusV0;
  }

  return value;
}

export function normalizeRuntimePairingStatusV0(value: unknown): RuntimePairingStatusLikeV0 | null {
  if (typeof value !== "string") return null;
  if (value === "done") return "succeeded";
  if (RUNTIME_PAIRING_STATUS_SET.has(value)) {
    return value as RuntimePairingStatusV0;
  }

  return value;
}

export function toUpgradePlanV0(value: UpgradePlanV0 & Record<string, unknown>): UpgradePlanV0 {
  return {
    schema: "pluto.ops.upgrade-plan",
    schemaVersion: 0,
    id: value.id,
    workspaceId: value.workspaceId,
    requestedById: value.requestedById,
    sourceRuntimeVersion: value.sourceRuntimeVersion,
    targetRuntimeVersion: value.targetRuntimeVersion,
    status: parseUpgradeRunStatusV0(value.status) ?? "planned",
    summary: value.summary,
    approvalRefs: uniqueStrings(value.approvalRefs),
    backupRefs: uniqueStrings(value.backupRefs),
    healthRefs: uniqueStrings(value.healthRefs),
    rollbackRefs: uniqueStrings(value.rollbackRefs),
    evidenceRefs: uniqueStrings(value.evidenceRefs),
    createdAt: value.createdAt,
    updatedAt: value.updatedAt,
  };
}

export function toUpgradeRunV0(value: UpgradeRunV0 & Record<string, unknown>): UpgradeRunV0 {
  return {
    schema: "pluto.ops.upgrade-run",
    schemaVersion: 0,
    id: value.id,
    workspaceId: value.workspaceId,
    planId: value.planId,
    sourceRuntimeVersion: value.sourceRuntimeVersion,
    targetRuntimeVersion: value.targetRuntimeVersion,
    status: parseUpgradeRunStatusV0(value.status) ?? "planned",
    approvalRefs: uniqueStrings(value.approvalRefs),
    backupRefs: uniqueStrings(value.backupRefs),
    healthRefs: uniqueStrings(value.healthRefs),
    rollbackRefs: uniqueStrings(value.rollbackRefs),
    evidenceRefs: uniqueStrings(value.evidenceRefs),
    lastTransitionAt: value.lastTransitionAt,
    lastTransitionKey: value.lastTransitionKey,
    startedAt: value.startedAt,
    finishedAt: value.finishedAt,
    failureReason: value.failureReason,
    createdAt: value.createdAt,
    updatedAt: value.updatedAt,
  };
}

export function toBackupManifestV0(value: BackupManifestV0 & Record<string, unknown>): BackupManifestV0 {
  return {
    schema: "pluto.ops.backup-manifest",
    schemaVersion: 0,
    id: value.id,
    workspaceId: value.workspaceId,
    planId: value.planId,
    upgradeRunId: value.upgradeRunId,
    sourceRuntimeVersion: value.sourceRuntimeVersion,
    targetRuntimeVersion: value.targetRuntimeVersion,
    manifestRef: value.manifestRef,
    approvalRefs: uniqueStrings(value.approvalRefs),
    backupRefs: uniqueStrings(value.backupRefs),
    healthRefs: uniqueStrings(value.healthRefs),
    rollbackRefs: uniqueStrings(value.rollbackRefs),
    evidenceRefs: uniqueStrings(value.evidenceRefs),
    createdAt: value.createdAt,
  };
}

export function toUpgradeGateV0(value: UpgradeGateV0 & Record<string, unknown>): UpgradeGateV0 {
  return {
    schema: "pluto.ops.upgrade-gate",
    schemaVersion: 0,
    id: value.id,
    workspaceId: value.workspaceId,
    planId: value.planId,
    upgradeRunId: value.upgradeRunId,
    sourceRuntimeVersion: value.sourceRuntimeVersion,
    targetRuntimeVersion: value.targetRuntimeVersion,
    gateKey: parseUpgradeGateKeyV0(value.gateKey) ?? "approval",
    status: parseUpgradeGateStatusV0(value.status) ?? "pending",
    summary: value.summary,
    approvalRefs: uniqueStrings(value.approvalRefs),
    backupRefs: uniqueStrings(value.backupRefs),
    healthRefs: uniqueStrings(value.healthRefs),
    rollbackRefs: uniqueStrings(value.rollbackRefs),
    evidenceRefs: uniqueStrings(value.evidenceRefs),
    checkedAt: value.checkedAt,
  };
}

export function toHealthSignalV0(value: HealthSignalV0 & Record<string, unknown>): HealthSignalV0 {
  return {
    schema: "pluto.ops.health-signal",
    schemaVersion: 0,
    id: value.id,
    workspaceId: value.workspaceId,
    planId: value.planId,
    upgradeRunId: value.upgradeRunId,
    sourceRuntimeVersion: value.sourceRuntimeVersion,
    targetRuntimeVersion: value.targetRuntimeVersion,
    signalKey: value.signalKey,
    status: parseHealthSignalStatusV0(value.status) ?? "healthy",
    summary: value.summary,
    approvalRefs: uniqueStrings(value.approvalRefs),
    backupRefs: uniqueStrings(value.backupRefs),
    healthRefs: uniqueStrings(value.healthRefs),
    rollbackRefs: uniqueStrings(value.rollbackRefs),
    evidenceRefs: uniqueStrings(value.evidenceRefs),
    recordedAt: value.recordedAt,
  };
}

export function toRollbackPlaybookV0(value: RollbackPlaybookV0 & Record<string, unknown>): RollbackPlaybookV0 {
  return {
    schema: "pluto.ops.rollback-playbook",
    schemaVersion: 0,
    id: value.id,
    workspaceId: value.workspaceId,
    planId: value.planId,
    upgradeRunId: value.upgradeRunId,
    sourceRuntimeVersion: value.sourceRuntimeVersion,
    targetRuntimeVersion: value.targetRuntimeVersion,
    triggerSummary: value.triggerSummary,
    steps: uniqueStrings(value.steps),
    approvalRefs: uniqueStrings(value.approvalRefs),
    backupRefs: uniqueStrings(value.backupRefs),
    healthRefs: uniqueStrings(value.healthRefs),
    rollbackRefs: uniqueStrings(value.rollbackRefs),
    evidenceRefs: uniqueStrings(value.evidenceRefs),
    createdAt: value.createdAt,
    updatedAt: value.updatedAt,
  };
}

export function toRuntimePairingStateV0(
  value: RuntimePairingStateV0 & Record<string, unknown>,
): RuntimePairingStateV0 {
  return {
    schema: "pluto.ops.runtime-pairing-state",
    schemaVersion: 0,
    id: value.id,
    workspaceId: value.workspaceId,
    planId: value.planId,
    upgradeRunId: value.upgradeRunId,
    sourceRuntimeVersion: value.sourceRuntimeVersion,
    targetRuntimeVersion: value.targetRuntimeVersion,
    status: parseRuntimePairingStatusV0(value.status) ?? "pending",
    pairedRuntimeIds: uniqueStrings(value.pairedRuntimeIds),
    approvalRefs: uniqueStrings(value.approvalRefs),
    backupRefs: uniqueStrings(value.backupRefs),
    healthRefs: uniqueStrings(value.healthRefs),
    rollbackRefs: uniqueStrings(value.rollbackRefs),
    evidenceRefs: uniqueStrings(value.evidenceRefs),
    createdAt: value.createdAt,
    updatedAt: value.updatedAt,
  };
}

export function validateUpgradePlanV0(value: unknown): GovernanceRecordValidationResult<UpgradePlanV0> {
  const base = validateUpgradeRecordBase(value, "pluto.ops.upgrade-plan");
  if (!base.ok) return base;

  const record = base.value;
  const errors: string[] = [];
  validateStringField(record, "requestedById", errors);
  validateStringStatusField(record, "status", errors);
  validateStringField(record, "summary", errors);
  validateStringField(record, "createdAt", errors);
  validateStringField(record, "updatedAt", errors);

  return errors.length === 0
    ? { ok: true, value: record as unknown as UpgradePlanV0 }
    : { ok: false, errors };
}

export function validateUpgradeRunV0(value: unknown): GovernanceRecordValidationResult<UpgradeRunV0> {
  const base = validateUpgradeRecordBase(value, "pluto.ops.upgrade-run");
  if (!base.ok) return base;

  const record = base.value;
  const errors: string[] = [];
  validateStringField(record, "planId", errors);
  validateStringStatusField(record, "status", errors);
  validateStringField(record, "lastTransitionAt", errors);
  validateNullableStringField(record, "lastTransitionKey", errors);
  validateNullableStringField(record, "startedAt", errors);
  validateNullableStringField(record, "finishedAt", errors);
  validateNullableStringField(record, "failureReason", errors);
  validateStringField(record, "createdAt", errors);
  validateStringField(record, "updatedAt", errors);

  return errors.length === 0
    ? { ok: true, value: record as unknown as UpgradeRunV0 }
    : { ok: false, errors };
}

export function validateBackupManifestV0(value: unknown): GovernanceRecordValidationResult<BackupManifestV0> {
  const base = validateUpgradeRecordBase(value, "pluto.ops.backup-manifest");
  if (!base.ok) return base;

  const record = base.value;
  const errors: string[] = [];
  validateStringField(record, "planId", errors);
  validateStringField(record, "upgradeRunId", errors);
  validateStringField(record, "manifestRef", errors);
  validateStringField(record, "createdAt", errors);

  return errors.length === 0
    ? { ok: true, value: record as unknown as BackupManifestV0 }
    : { ok: false, errors };
}

export function validateUpgradeGateV0(value: unknown): GovernanceRecordValidationResult<UpgradeGateV0> {
  const base = validateUpgradeRecordBase(value, "pluto.ops.upgrade-gate");
  if (!base.ok) return base;

  const record = base.value;
  const errors: string[] = [];
  validateStringField(record, "planId", errors);
  validateStringField(record, "upgradeRunId", errors);
  validateStringStatusField(record, "gateKey", errors);
  validateStringStatusField(record, "status", errors);
  validateStringField(record, "summary", errors);
  validateStringField(record, "checkedAt", errors);

  return errors.length === 0
    ? { ok: true, value: record as unknown as UpgradeGateV0 }
    : { ok: false, errors };
}

export function validateHealthSignalV0(value: unknown): GovernanceRecordValidationResult<HealthSignalV0> {
  const base = validateUpgradeRecordBase(value, "pluto.ops.health-signal");
  if (!base.ok) return base;

  const record = base.value;
  const errors: string[] = [];
  validateStringField(record, "planId", errors);
  validateStringField(record, "upgradeRunId", errors);
  validateStringField(record, "signalKey", errors);
  validateStringStatusField(record, "status", errors);
  validateStringField(record, "summary", errors);
  validateStringField(record, "recordedAt", errors);

  return errors.length === 0
    ? { ok: true, value: record as unknown as HealthSignalV0 }
    : { ok: false, errors };
}

export function validateRollbackPlaybookV0(value: unknown): GovernanceRecordValidationResult<RollbackPlaybookV0> {
  const base = validateUpgradeRecordBase(value, "pluto.ops.rollback-playbook");
  if (!base.ok) return base;

  const record = base.value;
  const errors: string[] = [];
  validateStringField(record, "planId", errors);
  validateStringField(record, "upgradeRunId", errors);
  validateStringField(record, "triggerSummary", errors);
  validateStringArrayField(record, "steps", errors);
  validateStringField(record, "createdAt", errors);
  validateStringField(record, "updatedAt", errors);

  return errors.length === 0
    ? { ok: true, value: record as unknown as RollbackPlaybookV0 }
    : { ok: false, errors };
}

export function validateRuntimePairingStateV0(
  value: unknown,
): GovernanceRecordValidationResult<RuntimePairingStateV0> {
  const base = validateUpgradeRecordBase(value, "pluto.ops.runtime-pairing-state");
  if (!base.ok) return base;

  const record = base.value;
  const errors: string[] = [];
  validateStringField(record, "planId", errors);
  validateStringField(record, "upgradeRunId", errors);
  validateStringStatusField(record, "status", errors);
  validateStringArrayField(record, "pairedRuntimeIds", errors);
  validateStringField(record, "createdAt", errors);
  validateStringField(record, "updatedAt", errors);

  return errors.length === 0
    ? { ok: true, value: record as unknown as RuntimePairingStateV0 }
    : { ok: false, errors };
}

export function validateUpgradeReadinessItemV0(
  value: unknown,
): GovernanceRecordValidationResult<UpgradeReadinessItemV0> {
  const record = asRecord(value);
  if (!record) {
    return { ok: false, errors: ["record must be an object"] };
  }

  const errors: string[] = [];
  if (record["schemaVersion"] !== 0) {
    errors.push("schemaVersion must be 0");
  }

  validateStringField(record, "workspaceId", errors);
  validateStringField(record, "planId", errors);
  validateStringField(record, "upgradeRunId", errors);
  validateNullableStringField(record, "planStatus", errors);
  validateStringField(record, "runStatus", errors);
  validateBooleanField(record, "backupVerified", errors);
  validateNumberField(record, "verifiedBackupCount", errors);
  validateNullableStringField(record, "latestHealthStatus", errors);
  validateBooleanField(record, "rollbackPrepared", errors);
  validateNumberField(record, "rollbackPlaybookCount", errors);
  validateStringArrayField(record, "blockingGateKeys", errors);
  validateStringArrayField(record, "pendingGateKeys", errors);
  validateStringArrayField(record, "recentEventTypes", errors);
  validateStringArrayField(record, "evidenceRefs", errors);
  validateBooleanField(record, "ready", errors);

  if (!hasOwnProperty(record, "gateStatus")) {
    errors.push("missing required field: gateStatus");
  } else {
    const gateStatus = asRecord(record["gateStatus"]);
    if (!gateStatus) {
      errors.push("gateStatus must be an object");
    } else {
      for (const key of UPGRADE_GATE_KEYS_V0) {
        if (!hasOwnProperty(gateStatus, key)) {
          errors.push(`gateStatus.${key} is required`);
          continue;
        }

        if (typeof gateStatus[key] !== "string") {
          errors.push(`gateStatus.${key} must be a string`);
        }
      }
    }
  }

  return errors.length === 0
    ? { ok: true, value: record as unknown as UpgradeReadinessItemV0 }
    : { ok: false, errors };
}
