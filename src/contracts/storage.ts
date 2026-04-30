export const STORAGE_OBJECT_KINDS_V0 = [
  "metadata",
  "content_blob",
  "external_ref",
  "event_ledger",
  "retention_policy",
  "deletion_request",
  "tombstone",
  "legal_hold_overlay",
] as const;

export type StorageObjectKindV0 = typeof STORAGE_OBJECT_KINDS_V0[number];
export type StorageObjectKindLikeV0 = StorageObjectKindV0 | (string & {});

export const STORAGE_STATUSES_V0 = [
  "pending",
  "active",
  "held",
  "archived",
  "deleted",
  "external",
] as const;

export type StorageStatusKindV0 = typeof STORAGE_STATUSES_V0[number];
export type StorageStatusLikeV0 = StorageStatusKindV0 | (string & {});

export const RETENTION_CLASSES_V0 = ["ephemeral", "session", "durable", "regulated"] as const;
export type RetentionClassV0 = typeof RETENTION_CLASSES_V0[number];
export type RetentionClassLikeV0 = RetentionClassV0 | (string & {});

export const SENSITIVITY_CLASSES_V0 = ["public", "internal", "confidential", "restricted"] as const;
export type SensitivityClassV0 = typeof SENSITIVITY_CLASSES_V0[number];
export type SensitivityClassLikeV0 = SensitivityClassV0 | (string & {});

export interface ActorRefV0 {
  actorId: string;
  actorType: "user" | "service" | "system" | (string & {});
  displayName?: string;
}

export interface ChecksumV0 {
  algorithm: "sha256" | (string & {});
  digest: string;
}

export interface StorageRefV0 {
  schema: "pluto.storage.ref";
  schemaVersion: 0;
  storageVersion: "local-v0";
  kind: StorageObjectKindV0;
  recordId: string;
  workspaceId: string;
  objectType: string;
  status: StorageStatusLikeV0;
  summary: string;
  checksum?: ChecksumV0;
}

interface StorageRecordBaseV0<K extends StorageObjectKindV0> {
  schemaVersion: 0;
  storageVersion: "local-v0";
  kind: K;
  id: string;
  workspaceId: string;
  objectType: string;
  status: StorageStatusLikeV0;
  actorRefs: ActorRefV0[];
  createdAt: string;
  updatedAt: string;
  retentionClass: RetentionClassLikeV0;
  sensitivityClass: SensitivityClassLikeV0;
  summary: string;
}

export interface MetadataRecordV0 extends StorageRecordBaseV0<"metadata"> {
  metadata: Record<string, unknown>;
  checksum: ChecksumV0;
  sourceRefs?: StorageRefV0[];
}

export interface ContentBlobRecordV0 extends StorageRecordBaseV0<"content_blob"> {
  content: {
    mediaType: string;
    contentLengthBytes: number;
    encoding?: string | null;
    checksum: ChecksumV0;
    contentRef?: string;
  };
  derivedFromRefs?: StorageRefV0[];
}

export interface ExternalRefRecordV0 extends StorageRecordBaseV0<"external_ref"> {
  external: {
    uri: string;
    availability: "online" | "degraded" | "offline" | (string & {});
    trustNote: string;
    availabilityNote: string;
    retentionNote: string;
    deletionGuarantee: "none";
    checksum?: ChecksumV0;
    externalVersion?: string | null;
  };
}

export interface EventLedgerEntryV0 extends StorageRecordBaseV0<"event_ledger"> {
  eventType: string;
  subjectRef: StorageRefV0;
  occurredAt: string;
  detail: Record<string, unknown>;
  relatedRefs?: StorageRefV0[];
  checksum?: ChecksumV0;
}

export interface RetentionPolicyV0 extends StorageRecordBaseV0<"retention_policy"> {
  appliesTo: StorageRefV0[];
  mode: "class-default" | "retain-until" | "hold-aware" | (string & {});
  retainUntil: string | null;
  note: string;
}

export interface DeletionRequestV0 extends StorageRecordBaseV0<"deletion_request"> {
  targetRef: StorageRefV0;
  requestedBy: ActorRefV0;
  requestedAt: string;
  reason: string;
  approvalRef?: StorageRefV0;
  deletionGuarantee: "best-effort-local" | "none";
}

export interface TombstoneRecordV0 extends StorageRecordBaseV0<"tombstone"> {
  targetRef: StorageRefV0;
  tombstonedAt: string;
  tombstoneReason: string;
  deletionRequestRef?: StorageRefV0;
  priorChecksum?: ChecksumV0;
}

export interface LegalHoldOverlayV0 extends StorageRecordBaseV0<"legal_hold_overlay"> {
  holdId: string;
  targetRefs: StorageRefV0[];
  activatedAt: string;
  releasedAt: string | null;
  note: string;
}

export type StorageRecordV0 =
  | MetadataRecordV0
  | ContentBlobRecordV0
  | ExternalRefRecordV0
  | EventLedgerEntryV0
  | RetentionPolicyV0
  | DeletionRequestV0
  | TombstoneRecordV0
  | LegalHoldOverlayV0;

export interface StorageStatusV0 {
  schema: "pluto.storage.status";
  schemaVersion: 0;
  storageVersion: "local-v0";
  ref: StorageRefV0;
  actorRefs: ActorRefV0[];
  createdAt: string;
  updatedAt: string;
  retentionClass: RetentionClassLikeV0;
  sensitivityClass: SensitivityClassLikeV0;
  notes: string[];
  deletionGuarantee: "best-effort-local" | "none";
}

export interface StorageRecordValidationError {
  ok: false;
  errors: string[];
}

export interface StorageRecordValidationSuccess<T> {
  ok: true;
  value: T;
}

export type StorageRecordValidationResult<T> =
  | StorageRecordValidationSuccess<T>
  | StorageRecordValidationError;

const STORAGE_OBJECT_KIND_SET = new Set<string>(STORAGE_OBJECT_KINDS_V0);
const STORAGE_STATUS_SET = new Set<string>(STORAGE_STATUSES_V0);
const RETENTION_CLASS_SET = new Set<string>(RETENTION_CLASSES_V0);
const SENSITIVITY_CLASS_SET = new Set<string>(SENSITIVITY_CLASSES_V0);

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

function validateArrayField(record: Record<string, unknown>, field: string, errors: string[]): void {
  if (!hasOwnProperty(record, field)) {
    errors.push(`missing required field: ${field}`);
    return;
  }

  if (!Array.isArray(record[field])) {
    errors.push(`${field} must be an array`);
  }
}

function validateObjectField(record: Record<string, unknown>, field: string, errors: string[]): void {
  if (!hasOwnProperty(record, field)) {
    errors.push(`missing required field: ${field}`);
    return;
  }

  const value = record[field];
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    errors.push(`${field} must be an object`);
  }
}

function validateBaseRecord(
  value: unknown,
  expectedKind: StorageObjectKindV0,
  extraStringFields: readonly string[] = [],
  extraNullableStringFields: readonly string[] = [],
  extraArrayFields: readonly string[] = [],
  extraObjectFields: readonly string[] = [],
): StorageRecordValidationResult<Record<string, unknown>> {
  if (typeof value !== "object" || value === null) {
    return { ok: false, errors: ["record must be an object"] };
  }

  const record = value as Record<string, unknown>;
  const errors: string[] = [];

  if (record["schemaVersion"] !== 0) {
    errors.push("schemaVersion must be 0");
  }

  if (record["storageVersion"] !== "local-v0") {
    errors.push("storageVersion must be local-v0");
  }

  if (record["kind"] !== expectedKind) {
    errors.push(`kind must be ${expectedKind}`);
  }

  validateStringField(record, "id", errors);
  validateStringField(record, "workspaceId", errors);
  validateStringField(record, "objectType", errors);
  validateStringField(record, "status", errors);
  validateArrayField(record, "actorRefs", errors);
  validateStringField(record, "createdAt", errors);
  validateStringField(record, "updatedAt", errors);
  validateStringField(record, "retentionClass", errors);
  validateStringField(record, "sensitivityClass", errors);
  validateStringField(record, "summary", errors);

  for (const field of extraStringFields) {
    validateStringField(record, field, errors);
  }

  for (const field of extraNullableStringFields) {
    validateNullableStringField(record, field, errors);
  }

  for (const field of extraArrayFields) {
    validateArrayField(record, field, errors);
  }

  for (const field of extraObjectFields) {
    validateObjectField(record, field, errors);
  }

  return errors.length === 0 ? { ok: true, value: record } : { ok: false, errors };
}

export function parseStorageObjectKindV0(value: unknown): StorageObjectKindLikeV0 | null {
  if (typeof value !== "string") return null;
  if (STORAGE_OBJECT_KIND_SET.has(value)) {
    return value as StorageObjectKindV0;
  }
  return value;
}

export function parseStorageStatusV0(value: unknown): StorageStatusLikeV0 | null {
  if (typeof value !== "string") return null;
  if (STORAGE_STATUS_SET.has(value)) {
    return value as StorageStatusKindV0;
  }
  return value;
}

export function parseRetentionClassV0(value: unknown): RetentionClassLikeV0 | null {
  if (typeof value !== "string") return null;
  if (RETENTION_CLASS_SET.has(value)) {
    return value as RetentionClassV0;
  }
  return value;
}

export function parseSensitivityClassV0(value: unknown): SensitivityClassLikeV0 | null {
  if (typeof value !== "string") return null;
  if (SENSITIVITY_CLASS_SET.has(value)) {
    return value as SensitivityClassV0;
  }
  return value;
}

export function toStorageRefV0(record: StorageRecordV0): StorageRefV0 {
  return {
    schema: "pluto.storage.ref",
    schemaVersion: 0,
    storageVersion: "local-v0",
    kind: record.kind,
    recordId: record.id,
    workspaceId: record.workspaceId,
    objectType: record.objectType,
    status: record.status,
    summary: record.summary,
    checksum: getRecordChecksum(record),
  };
}

export function toStorageStatusV0(record: StorageRecordV0): StorageStatusV0 {
  return {
    schema: "pluto.storage.status",
    schemaVersion: 0,
    storageVersion: "local-v0",
    ref: toStorageRefV0(record),
    actorRefs: record.actorRefs,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
    retentionClass: record.retentionClass,
    sensitivityClass: record.sensitivityClass,
    notes: getStatusNotes(record),
    deletionGuarantee: getDeletionGuarantee(record),
  };
}

function getRecordChecksum(record: StorageRecordV0): ChecksumV0 | undefined {
  switch (record.kind) {
    case "metadata":
      return record.checksum;
    case "content_blob":
      return record.content.checksum;
    case "external_ref":
      return record.external.checksum;
    case "event_ledger":
      return record.checksum;
    case "tombstone":
      return record.priorChecksum;
    default:
      return undefined;
  }
}

function getDeletionGuarantee(record: StorageRecordV0): "best-effort-local" | "none" {
  switch (record.kind) {
    case "external_ref":
      return "none";
    case "deletion_request":
      return record.deletionGuarantee;
    default:
      return "best-effort-local";
  }
}

function getStatusNotes(record: StorageRecordV0): string[] {
  switch (record.kind) {
    case "external_ref":
      return [
        record.external.trustNote,
        record.external.availabilityNote,
        record.external.retentionNote,
        "Pluto does not guarantee deletion of externally managed content.",
      ];
    case "retention_policy":
      return [record.note];
    case "deletion_request":
      return [record.reason];
    case "tombstone":
      return [record.tombstoneReason];
    case "legal_hold_overlay":
      return [record.note];
    default:
      return [];
  }
}

export function validateMetadataRecordV0(value: unknown): StorageRecordValidationResult<MetadataRecordV0> {
  const result = validateBaseRecord(value, "metadata", [], [], [], ["metadata", "checksum"]);
  return result.ok ? { ok: true, value: result.value as unknown as MetadataRecordV0 } : result;
}

export function validateContentBlobRecordV0(value: unknown): StorageRecordValidationResult<ContentBlobRecordV0> {
  const result = validateBaseRecord(value, "content_blob", [], [], [], ["content"]);
  return result.ok ? { ok: true, value: result.value as unknown as ContentBlobRecordV0 } : result;
}

export function validateExternalRefRecordV0(value: unknown): StorageRecordValidationResult<ExternalRefRecordV0> {
  const result = validateBaseRecord(value, "external_ref", [], [], [], ["external"]);
  return result.ok ? { ok: true, value: result.value as unknown as ExternalRefRecordV0 } : result;
}

export function validateEventLedgerEntryV0(value: unknown): StorageRecordValidationResult<EventLedgerEntryV0> {
  const result = validateBaseRecord(
    value,
    "event_ledger",
    ["eventType", "occurredAt"],
    [],
    [],
    ["subjectRef", "detail"],
  );
  return result.ok ? { ok: true, value: result.value as unknown as EventLedgerEntryV0 } : result;
}

export function validateRetentionPolicyV0(value: unknown): StorageRecordValidationResult<RetentionPolicyV0> {
  const result = validateBaseRecord(
    value,
    "retention_policy",
    ["mode", "note"],
    ["retainUntil"],
    ["appliesTo"],
  );
  return result.ok ? { ok: true, value: result.value as unknown as RetentionPolicyV0 } : result;
}

export function validateDeletionRequestV0(value: unknown): StorageRecordValidationResult<DeletionRequestV0> {
  const result = validateBaseRecord(
    value,
    "deletion_request",
    ["requestedAt", "reason", "deletionGuarantee"],
    [],
    [],
    ["targetRef", "requestedBy"],
  );
  return result.ok ? { ok: true, value: result.value as unknown as DeletionRequestV0 } : result;
}

export function validateTombstoneRecordV0(value: unknown): StorageRecordValidationResult<TombstoneRecordV0> {
  const result = validateBaseRecord(
    value,
    "tombstone",
    ["tombstonedAt", "tombstoneReason"],
    [],
    [],
    ["targetRef"],
  );
  return result.ok ? { ok: true, value: result.value as unknown as TombstoneRecordV0 } : result;
}

export function validateLegalHoldOverlayV0(value: unknown): StorageRecordValidationResult<LegalHoldOverlayV0> {
  const result = validateBaseRecord(
    value,
    "legal_hold_overlay",
    ["holdId", "activatedAt", "note"],
    ["releasedAt"],
    ["targetRefs"],
  );
  return result.ok ? { ok: true, value: result.value as unknown as LegalHoldOverlayV0 } : result;
}
