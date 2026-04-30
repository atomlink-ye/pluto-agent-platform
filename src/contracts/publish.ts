import type {
  GovernanceRecordValidationResult,
  GovernanceStatusLikeV0,
  PublishPackageRecordV0 as GovernancePublishPackageRecordV0,
} from "./governance.js";
import { validatePublishPackageRecordV0 as validateBaselinePublishPackageRecordV0 } from "./governance.js";

export const PUBLISH_READY_BLOCKED_REASONS_V0 = [
  "missing_approval",
  "missing_sealed_evidence",
  "failed_readiness_gate",
  "duplicate_idempotency_key",
  "credential_leakage",
] as const;

export const CHANNEL_TARGET_STATUSES_V0 = ["ready", "blocked", "degraded"] as const;
export const PUBLISH_ATTEMPT_STATUSES_V0 = ["queued", "blocked", "succeeded", "failed"] as const;
export const ROLLBACK_ACTIONS_V0 = ["rollback", "retract", "supersede"] as const;

export type PublishReadyBlockedReasonV0 = typeof PUBLISH_READY_BLOCKED_REASONS_V0[number] | (string & {});
export type ChannelTargetStatusV0 = typeof CHANNEL_TARGET_STATUSES_V0[number];
export type ChannelTargetStatusLikeV0 = ChannelTargetStatusV0 | (string & {});
export type PublishAttemptStatusV0 = typeof PUBLISH_ATTEMPT_STATUSES_V0[number];
export type PublishAttemptStatusLikeV0 = PublishAttemptStatusV0 | (string & {});
export type RollbackActionV0 = typeof ROLLBACK_ACTIONS_V0[number];
export type RollbackActionLikeV0 = RollbackActionV0 | (string & {});

export interface VersionSourceRefV0 {
  documentId: string;
  versionId: string;
  label?: string;
}

export interface ReleaseReadinessRefV0 {
  id: string;
  status: string;
  summary: string;
  checkedAt?: string;
}

export interface ChannelTargetRefV0 {
  schemaVersion: 0;
  channelId: string;
  targetId: string;
  targetKind: string;
  destinationSummary: string;
  readinessRef: string | null;
  approvalRef: string | null;
  blockedNotes: string[];
  degradedNotes: string[];
}

export interface ChannelTargetSummaryV0 extends ChannelTargetRefV0 {
  status: ChannelTargetStatusLikeV0;
}

export interface PublishPackageRecordV0 extends GovernancePublishPackageRecordV0 {
  schema: "pluto.publish.package";
  sourceVersionRefs: VersionSourceRefV0[];
  approvalRefs: string[];
  sealedEvidenceRefs: string[];
  releaseReadinessRefs: ReleaseReadinessRefV0[];
  channelTargets: ChannelTargetSummaryV0[];
  publishReadyBlockedReasons: PublishReadyBlockedReasonV0[];
}

export interface ExportAssetRecordV0 {
  schema: "pluto.publish.export-asset";
  schemaVersion: 0;
  id: string;
  publishPackageId: string;
  workspaceId: string;
  channelTarget: ChannelTargetRefV0;
  checksum: string;
  contentType: string;
  sourceVersionRefs: VersionSourceRefV0[];
  sealedEvidenceRefs: string[];
  redactionSummary: {
    redactedAt: string | null;
    fieldsRedacted: number;
    summary: string;
  };
  assetSummary: string;
  createdAt: string;
}

export interface CredentialRedactedPayloadSummaryV0 {
  summary: string;
  redactedFields: string[];
  detailKeys: string[];
}

export interface PublishAttemptRecordV0 {
  schema: "pluto.publish.attempt";
  schemaVersion: 0;
  id: string;
  publishPackageId: string;
  exportAssetId: string | null;
  channelTarget: ChannelTargetSummaryV0;
  idempotencyKey: string;
  publisher: {
    principalId: string;
    roleLabels: string[];
  };
  providerResultRefs: {
    externalRef: string | null;
    receiptPath: string | null;
    summary: string;
  };
  payloadSummary: CredentialRedactedPayloadSummaryV0;
  status: PublishAttemptStatusLikeV0;
  blockedReasons: PublishReadyBlockedReasonV0[];
  createdAt: string;
}

export interface RollbackRetractRecordV0 {
  schema: "pluto.publish.rollback";
  schemaVersion: 0;
  id: string;
  publishPackageId: string;
  publishAttemptId: string;
  action: RollbackActionLikeV0;
  actorId: string;
  reason: string;
  replacementPackageId: string | null;
  createdAt: string;
}

export interface PublishAuditEventV0 {
  schema: "pluto.publish.audit-event";
  schemaVersion: 0;
  id: string;
  eventType: "publish" | "rollback" | "retract" | "supersede";
  publishPackageId: string;
  publishAttemptId: string | null;
  recordId: string;
  actorId: string;
  createdAt: string;
  summary: string;
}

export interface PublishReadinessV0 {
  schema: "pluto.publish.readiness";
  schemaVersion: 0;
  publishPackageId: string;
  status: GovernanceStatusLikeV0;
  blockedReasons: PublishReadyBlockedReasonV0[];
  duplicateIdempotencyKeys: string[];
}

const BLOCKED_REASON_SET = new Set<string>(PUBLISH_READY_BLOCKED_REASONS_V0);
const CHANNEL_TARGET_STATUS_SET = new Set<string>(CHANNEL_TARGET_STATUSES_V0);
const PUBLISH_ATTEMPT_STATUS_SET = new Set<string>(PUBLISH_ATTEMPT_STATUSES_V0);
const ROLLBACK_ACTION_SET = new Set<string>(ROLLBACK_ACTIONS_V0);
const SECRET_KEY_RE = /(?:token|secret|password|credential|authorization|api[_-]?key|auth)/i;
const SECRET_VALUE_RE = /(?:bearer\s+\S+|api[_-]?key\s*[:=]\s*\S+|token\s*[:=]\s*\S+|secret\s*[:=]\s*\S+|password\s*[:=]\s*\S+)/i;

export function parsePublishReadyBlockedReasonV0(value: unknown): PublishReadyBlockedReasonV0 | null {
  if (typeof value !== "string") return null;
  if (BLOCKED_REASON_SET.has(value)) {
    return value as PublishReadyBlockedReasonV0;
  }

  return value;
}

export function toChannelTargetRefV0(value: ChannelTargetRefV0): ChannelTargetRefV0 {
  return {
    schemaVersion: 0,
    channelId: value.channelId,
    targetId: value.targetId,
    targetKind: value.targetKind,
    destinationSummary: value.destinationSummary,
    readinessRef: typeof value.readinessRef === "string" ? value.readinessRef : null,
    approvalRef: typeof value.approvalRef === "string" ? value.approvalRef : null,
    blockedNotes: sanitizeStringArray(value.blockedNotes),
    degradedNotes: sanitizeStringArray(value.degradedNotes),
  };
}

export function toChannelTargetSummaryV0(value: ChannelTargetSummaryV0): ChannelTargetSummaryV0 {
  return {
    ...toChannelTargetRefV0(value),
    status: normalizeChannelTargetStatusV0(value.status) ?? "blocked",
  };
}

export function toPublishPackageRecordV0(value: GovernancePublishPackageRecordV0 & Partial<PublishPackageRecordV0>): PublishPackageRecordV0 {
  return {
    ...value,
    schema: "pluto.publish.package",
    schemaVersion: 0,
    sourceVersionRefs: sanitizeVersionSourceRefs(value.sourceVersionRefs, value),
    approvalRefs: sanitizeStringArray(value.approvalRefs),
    sealedEvidenceRefs: sanitizeStringArray(value.sealedEvidenceRefs),
    releaseReadinessRefs: sanitizeReleaseReadinessRefs(value.releaseReadinessRefs),
    channelTargets: sanitizeChannelTargets(value.channelTargets, value.targetId),
    publishReadyBlockedReasons: sanitizeBlockedReasons(value.publishReadyBlockedReasons),
  };
}

export function toExportAssetRecordV0(value: ExportAssetRecordV0): ExportAssetRecordV0 {
  return {
    schema: "pluto.publish.export-asset",
    schemaVersion: 0,
    id: value.id,
    publishPackageId: value.publishPackageId,
    workspaceId: value.workspaceId,
    channelTarget: toChannelTargetRefV0(value.channelTarget),
    checksum: value.checksum,
    contentType: value.contentType,
    sourceVersionRefs: sanitizeVersionSourceRefs(value.sourceVersionRefs),
    sealedEvidenceRefs: sanitizeStringArray(value.sealedEvidenceRefs),
    redactionSummary: sanitizeRedactionSummary(value.redactionSummary),
    assetSummary: value.assetSummary,
    createdAt: value.createdAt,
  };
}

export function toCredentialRedactedPayloadSummaryV0(
  value: CredentialRedactedPayloadSummaryV0,
): CredentialRedactedPayloadSummaryV0 {
  assertNoCredentialLeakage(value, "payloadSummary");

  return {
    summary: value.summary,
    redactedFields: sanitizeStringArray(value.redactedFields),
    detailKeys: sanitizeStringArray(value.detailKeys),
  };
}

export function toPublishAttemptRecordV0(value: PublishAttemptRecordV0): PublishAttemptRecordV0 {
  assertNoCredentialLeakage(value.payloadSummary, "payloadSummary");

  return {
    schema: "pluto.publish.attempt",
    schemaVersion: 0,
    id: value.id,
    publishPackageId: value.publishPackageId,
    exportAssetId: typeof value.exportAssetId === "string" ? value.exportAssetId : null,
    channelTarget: toChannelTargetSummaryV0(value.channelTarget),
    idempotencyKey: value.idempotencyKey,
    publisher: {
      principalId: value.publisher.principalId,
      roleLabels: sanitizeStringArray(value.publisher.roleLabels),
    },
    providerResultRefs: {
      externalRef: typeof value.providerResultRefs.externalRef === "string"
        ? value.providerResultRefs.externalRef
        : null,
      receiptPath: typeof value.providerResultRefs.receiptPath === "string"
        ? value.providerResultRefs.receiptPath
        : null,
      summary: value.providerResultRefs.summary,
    },
    payloadSummary: toCredentialRedactedPayloadSummaryV0(value.payloadSummary),
    status: normalizePublishAttemptStatusV0(value.status) ?? "blocked",
    blockedReasons: sanitizeBlockedReasons(value.blockedReasons),
    createdAt: value.createdAt,
  };
}

export function toRollbackRetractRecordV0(value: RollbackRetractRecordV0): RollbackRetractRecordV0 {
  return {
    schema: "pluto.publish.rollback",
    schemaVersion: 0,
    id: value.id,
    publishPackageId: value.publishPackageId,
    publishAttemptId: value.publishAttemptId,
    action: normalizeRollbackActionV0(value.action) ?? "rollback",
    actorId: value.actorId,
    reason: value.reason,
    replacementPackageId: typeof value.replacementPackageId === "string" ? value.replacementPackageId : null,
    createdAt: value.createdAt,
  };
}

export function validatePublishPackageRecordV0(value: unknown): GovernanceRecordValidationResult<PublishPackageRecordV0> {
  const base = validateBaselinePublishPackageRecordV0(value);
  if (!base.ok) {
    return base;
  }

  const record = asRecord(value);
  if (!record) {
    return { ok: false, errors: ["publish package record must be an object"] };
  }

  const errors: string[] = [];
  validateStringArrayField(record, "approvalRefs", errors, true);
  validateStringArrayField(record, "sealedEvidenceRefs", errors, true);
  validateBlockedReasonsField(record, "publishReadyBlockedReasons", errors, true);
  validateVersionSourceRefs(record["sourceVersionRefs"], errors, true);
  validateReleaseReadinessRefs(record["releaseReadinessRefs"], errors, true);
  validateChannelTargets(record["channelTargets"], errors, true);

  if (errors.length > 0) {
    return { ok: false, errors };
  }

  return {
    ok: true,
    value: toPublishPackageRecordV0(record as unknown as GovernancePublishPackageRecordV0 & Partial<PublishPackageRecordV0>),
  };
}

export function validateExportAssetRecordV0(value: unknown): GovernanceRecordValidationResult<ExportAssetRecordV0> {
  const record = asRecord(value);
  if (!record) {
    return { ok: false, errors: ["export asset record must be an object"] };
  }

  const errors: string[] = [];
  validateSchema(record, "pluto.publish.export-asset", errors);
  validateStringField(record, "id", errors);
  validateStringField(record, "publishPackageId", errors);
  validateStringField(record, "workspaceId", errors);
  validateStringField(record, "checksum", errors);
  validateStringField(record, "contentType", errors);
  validateStringField(record, "assetSummary", errors);
  validateStringField(record, "createdAt", errors);
  validateChannelTargetRef(record["channelTarget"], "channelTarget", errors);
  validateVersionSourceRefs(record["sourceVersionRefs"], errors);
  validateStringArray(record["sealedEvidenceRefs"], "sealedEvidenceRefs", errors);
  validateRedactionSummary(record["redactionSummary"], errors);

  if (errors.length > 0) {
    return { ok: false, errors };
  }

  return { ok: true, value: toExportAssetRecordV0(record as unknown as ExportAssetRecordV0) };
}

export function validatePublishAttemptRecordV0(value: unknown): GovernanceRecordValidationResult<PublishAttemptRecordV0> {
  const record = asRecord(value);
  if (!record) {
    return { ok: false, errors: ["publish attempt record must be an object"] };
  }

  const errors: string[] = [];
  validateSchema(record, "pluto.publish.attempt", errors);
  validateStringField(record, "id", errors);
  validateStringField(record, "publishPackageId", errors);
  validateNullableStringField(record, "exportAssetId", errors);
  validateStringField(record, "idempotencyKey", errors);
  validateStringField(record, "createdAt", errors);
  validateChannelTargetSummary(record["channelTarget"], "channelTarget", errors);
  validatePublisher(record["publisher"], errors);
  validateProviderResultRefs(record["providerResultRefs"], errors);
  validatePayloadSummary(record["payloadSummary"], errors);
  validateBlockedReasonsField(record, "blockedReasons", errors);
  if (record["status"] !== undefined && normalizePublishAttemptStatusV0(record["status"]) === null) {
    errors.push("status must be a string");
  }

  if (errors.length > 0) {
    return { ok: false, errors };
  }

  try {
    return { ok: true, value: toPublishAttemptRecordV0(record as unknown as PublishAttemptRecordV0) };
  } catch (error) {
    return { ok: false, errors: [error instanceof Error ? error.message : String(error)] };
  }
}

export function validateRollbackRetractRecordV0(value: unknown): GovernanceRecordValidationResult<RollbackRetractRecordV0> {
  const record = asRecord(value);
  if (!record) {
    return { ok: false, errors: ["rollback record must be an object"] };
  }

  const errors: string[] = [];
  validateSchema(record, "pluto.publish.rollback", errors);
  validateStringField(record, "id", errors);
  validateStringField(record, "publishPackageId", errors);
  validateStringField(record, "publishAttemptId", errors);
  validateStringField(record, "actorId", errors);
  validateStringField(record, "reason", errors);
  validateStringField(record, "createdAt", errors);
  validateNullableStringField(record, "replacementPackageId", errors);
  if (record["action"] !== undefined && normalizeRollbackActionV0(record["action"]) === null) {
    errors.push("action must be a string");
  }

  if (errors.length > 0) {
    return { ok: false, errors };
  }

  return { ok: true, value: toRollbackRetractRecordV0(record as unknown as RollbackRetractRecordV0) };
}

export function validatePublishAuditEventV0(value: unknown): GovernanceRecordValidationResult<PublishAuditEventV0> {
  const record = asRecord(value);
  if (!record) {
    return { ok: false, errors: ["publish audit event must be an object"] };
  }

  const errors: string[] = [];
  validateSchema(record, "pluto.publish.audit-event", errors);
  validateStringField(record, "id", errors);
  validateStringField(record, "eventType", errors);
  validateStringField(record, "publishPackageId", errors);
  validateNullableStringField(record, "publishAttemptId", errors);
  validateStringField(record, "recordId", errors);
  validateStringField(record, "actorId", errors);
  validateStringField(record, "createdAt", errors);
  validateStringField(record, "summary", errors);

  return errors.length === 0
    ? { ok: true, value: record as unknown as PublishAuditEventV0 }
    : { ok: false, errors };
}

export function normalizeChannelTargetStatusV0(value: unknown): ChannelTargetStatusLikeV0 | null {
  if (typeof value !== "string") return null;
  if (CHANNEL_TARGET_STATUS_SET.has(value)) {
    return value as ChannelTargetStatusV0;
  }

  return value;
}

export function normalizePublishAttemptStatusV0(value: unknown): PublishAttemptStatusLikeV0 | null {
  if (typeof value !== "string") return null;
  if (PUBLISH_ATTEMPT_STATUS_SET.has(value)) {
    return value as PublishAttemptStatusV0;
  }

  return value;
}

export function normalizeRollbackActionV0(value: unknown): RollbackActionLikeV0 | null {
  if (typeof value !== "string") return null;
  if (ROLLBACK_ACTION_SET.has(value)) {
    return value as RollbackActionV0;
  }

  return value;
}

export function assertNoCredentialLeakage(value: unknown, path = "value"): void {
  const leaks = collectCredentialLeaks(value, path);
  if (leaks.length > 0) {
    throw new Error(`credential leakage detected in ${leaks[0]}`);
  }
}

function sanitizeVersionSourceRefs(value: unknown, fallback?: GovernancePublishPackageRecordV0): VersionSourceRefV0[] {
  if (!Array.isArray(value) || value.length === 0) {
    return fallback
      ? [{ documentId: fallback.documentId, versionId: fallback.versionId }]
      : [];
  }

  return value
    .map((entry) => asRecord(entry))
    .filter((entry): entry is Record<string, unknown> => entry !== null)
    .map((entry) => ({
      documentId: String(entry.documentId ?? ""),
      versionId: String(entry.versionId ?? ""),
      ...(typeof entry.label === "string" ? { label: entry.label } : {}),
    }))
    .filter((entry) => entry.documentId.length > 0 && entry.versionId.length > 0);
}

function sanitizeReleaseReadinessRefs(value: unknown): ReleaseReadinessRefV0[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((entry) => asRecord(entry))
    .filter((entry): entry is Record<string, unknown> => entry !== null)
    .map((entry) => ({
      id: String(entry.id ?? ""),
      status: String(entry.status ?? ""),
      summary: String(entry.summary ?? ""),
      ...(typeof entry.checkedAt === "string" ? { checkedAt: entry.checkedAt } : {}),
    }))
    .filter((entry) => entry.id.length > 0 && entry.status.length > 0 && entry.summary.length > 0);
}

function sanitizeChannelTargets(value: unknown, targetId: string): ChannelTargetSummaryV0[] {
  if (!Array.isArray(value) || value.length === 0) {
    return [{
      schemaVersion: 0,
      channelId: targetId,
      targetId,
      targetKind: "unspecified",
      destinationSummary: targetId,
      readinessRef: null,
      approvalRef: null,
      blockedNotes: [],
      degradedNotes: [],
      status: "blocked",
    }];
  }

  return value
    .map((entry) => asRecord(entry))
    .filter((entry): entry is Record<string, unknown> => entry !== null)
    .map((entry) => toChannelTargetSummaryV0(entry as unknown as ChannelTargetSummaryV0));
}

function sanitizeBlockedReasons(value: unknown): PublishReadyBlockedReasonV0[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((entry) => parsePublishReadyBlockedReasonV0(entry))
    .filter((entry): entry is PublishReadyBlockedReasonV0 => entry !== null);
}

function sanitizeRedactionSummary(value: unknown): ExportAssetRecordV0["redactionSummary"] {
  const record = asRecord(value);
  return {
    redactedAt: record && typeof record.redactedAt === "string" ? record.redactedAt : null,
    fieldsRedacted: record && typeof record.fieldsRedacted === "number" ? record.fieldsRedacted : 0,
    summary: record && typeof record.summary === "string" ? record.summary : "",
  };
}

function sanitizeStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.filter((entry): entry is string => typeof entry === "string");
}

function validateSchema(record: Record<string, unknown>, schema: string, errors: string[]): void {
  if (record["schemaVersion"] !== 0) {
    errors.push("schemaVersion must be 0");
  }
  if (record["schema"] !== schema) {
    errors.push(`schema must be ${schema}`);
  }
}

function validateStringField(record: Record<string, unknown>, field: string, errors: string[]): void {
  if (typeof record[field] !== "string") {
    errors.push(`${field} must be a string`);
  }
}

function validateNullableStringField(record: Record<string, unknown>, field: string, errors: string[]): void {
  if (record[field] !== null && typeof record[field] !== "string") {
    errors.push(`${field} must be a string or null`);
  }
}

function validateStringArrayField(record: Record<string, unknown>, field: string, errors: string[], optional = false): void {
  if (record[field] === undefined && optional) {
    return;
  }
  validateStringArray(record[field], field, errors);
}

function validateStringArray(value: unknown, field: string, errors: string[]): void {
  if (!Array.isArray(value) || value.some((entry) => typeof entry !== "string")) {
    errors.push(`${field} must be an array of strings`);
  }
}

function validateBlockedReasonsField(record: Record<string, unknown>, field: string, errors: string[], optional = false): void {
  if (record[field] === undefined && optional) {
    return;
  }
  if (!Array.isArray(record[field]) || record[field].some((entry) => parsePublishReadyBlockedReasonV0(entry) === null)) {
    errors.push(`${field} must be an array of strings`);
  }
}

function validateVersionSourceRefs(value: unknown, errors: string[], optional = false): void {
  if (value === undefined && optional) {
    return;
  }
  if (!Array.isArray(value)) {
    errors.push("sourceVersionRefs must be an array");
    return;
  }

  value.forEach((entry, index) => {
    const record = asRecord(entry);
    if (!record) {
      errors.push(`sourceVersionRefs[${index}] must be an object`);
      return;
    }
    if (typeof record.documentId !== "string") {
      errors.push(`sourceVersionRefs[${index}].documentId must be a string`);
    }
    if (typeof record.versionId !== "string") {
      errors.push(`sourceVersionRefs[${index}].versionId must be a string`);
    }
    if (record.label !== undefined && typeof record.label !== "string") {
      errors.push(`sourceVersionRefs[${index}].label must be a string`);
    }
  });
}

function validateReleaseReadinessRefs(value: unknown, errors: string[], optional = false): void {
  if (value === undefined && optional) {
    return;
  }
  if (!Array.isArray(value)) {
    errors.push("releaseReadinessRefs must be an array");
    return;
  }

  value.forEach((entry, index) => {
    const record = asRecord(entry);
    if (!record) {
      errors.push(`releaseReadinessRefs[${index}] must be an object`);
      return;
    }
    if (typeof record.id !== "string") errors.push(`releaseReadinessRefs[${index}].id must be a string`);
    if (typeof record.status !== "string") errors.push(`releaseReadinessRefs[${index}].status must be a string`);
    if (typeof record.summary !== "string") errors.push(`releaseReadinessRefs[${index}].summary must be a string`);
    if (record.checkedAt !== undefined && typeof record.checkedAt !== "string") {
      errors.push(`releaseReadinessRefs[${index}].checkedAt must be a string`);
    }
  });
}

function validateChannelTargets(value: unknown, errors: string[], optional = false): void {
  if (value === undefined && optional) {
    return;
  }
  if (!Array.isArray(value)) {
    errors.push("channelTargets must be an array");
    return;
  }

  value.forEach((entry, index) => {
    validateChannelTargetSummary(entry, `channelTargets[${index}]`, errors);
  });
}

function validateChannelTargetRef(value: unknown, path: string, errors: string[]): void {
  const record = asRecord(value);
  if (!record) {
    errors.push(`${path} must be an object`);
    return;
  }

  if (record.schemaVersion !== 0) errors.push(`${path}.schemaVersion must be 0`);
  if (typeof record.channelId !== "string") errors.push(`${path}.channelId must be a string`);
  if (typeof record.targetId !== "string") errors.push(`${path}.targetId must be a string`);
  if (typeof record.targetKind !== "string") errors.push(`${path}.targetKind must be a string`);
  if (typeof record.destinationSummary !== "string") errors.push(`${path}.destinationSummary must be a string`);
  if (record.readinessRef !== null && typeof record.readinessRef !== "string") {
    errors.push(`${path}.readinessRef must be a string or null`);
  }
  if (record.approvalRef !== null && typeof record.approvalRef !== "string") {
    errors.push(`${path}.approvalRef must be a string or null`);
  }
  validateStringArray(record.blockedNotes, `${path}.blockedNotes`, errors);
  validateStringArray(record.degradedNotes, `${path}.degradedNotes`, errors);
}

function validateChannelTargetSummary(value: unknown, path: string, errors: string[]): void {
  validateChannelTargetRef(value, path, errors);
  const record = asRecord(value);
  if (!record) {
    return;
  }
  if (normalizeChannelTargetStatusV0(record.status) === null) {
    errors.push(`${path}.status must be a string`);
  }
}

function validateRedactionSummary(value: unknown, errors: string[]): void {
  const record = asRecord(value);
  if (!record) {
    errors.push("redactionSummary must be an object");
    return;
  }

  if (record.redactedAt !== null && typeof record.redactedAt !== "string") {
    errors.push("redactionSummary.redactedAt must be a string or null");
  }
  if (typeof record.fieldsRedacted !== "number") {
    errors.push("redactionSummary.fieldsRedacted must be a number");
  }
  if (typeof record.summary !== "string") {
    errors.push("redactionSummary.summary must be a string");
  }
}

function validatePublisher(value: unknown, errors: string[]): void {
  const record = asRecord(value);
  if (!record) {
    errors.push("publisher must be an object");
    return;
  }
  if (typeof record.principalId !== "string") {
    errors.push("publisher.principalId must be a string");
  }
  validateStringArray(record.roleLabels, "publisher.roleLabels", errors);
}

function validateProviderResultRefs(value: unknown, errors: string[]): void {
  const record = asRecord(value);
  if (!record) {
    errors.push("providerResultRefs must be an object");
    return;
  }
  if (record.externalRef !== null && typeof record.externalRef !== "string") {
    errors.push("providerResultRefs.externalRef must be a string or null");
  }
  if (record.receiptPath !== null && typeof record.receiptPath !== "string") {
    errors.push("providerResultRefs.receiptPath must be a string or null");
  }
  if (typeof record.summary !== "string") {
    errors.push("providerResultRefs.summary must be a string");
  }
}

function validatePayloadSummary(value: unknown, errors: string[]): void {
  const record = asRecord(value);
  if (!record) {
    errors.push("payloadSummary must be an object");
    return;
  }
  if (typeof record.summary !== "string") {
    errors.push("payloadSummary.summary must be a string");
  }
  validateStringArray(record.redactedFields, "payloadSummary.redactedFields", errors);
  validateStringArray(record.detailKeys, "payloadSummary.detailKeys", errors);
  try {
    assertNoCredentialLeakage(record, "payloadSummary");
  } catch (error) {
    errors.push(error instanceof Error ? error.message : String(error));
  }
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (typeof value !== "object" || value === null) {
    return null;
  }

  return value as Record<string, unknown>;
}

function collectCredentialLeaks(value: unknown, path: string): string[] {
  if (typeof value === "string") {
    return SECRET_VALUE_RE.test(value) ? [path] : [];
  }

  if (Array.isArray(value)) {
    return value.flatMap((entry, index) => collectCredentialLeaks(entry, `${path}[${index}]`));
  }

  const record = asRecord(value);
  if (!record) {
    return [];
  }

  const leaks: string[] = [];
  for (const [key, entry] of Object.entries(record)) {
    const nextPath = `${path}.${key}`;
    if (SECRET_KEY_RE.test(key)) {
      leaks.push(nextPath);
      continue;
    }
    leaks.push(...collectCredentialLeaks(entry, nextPath));
  }

  return leaks;
}
