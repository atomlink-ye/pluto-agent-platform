export const GOVERNANCE_OBJECT_KINDS_V0 = [
  "document",
  "version",
  "review",
  "approval",
  "publish_package",
  "playbook",
  "scenario",
  "schedule",
] as const;

export type GovernanceObjectKindV0 = typeof GOVERNANCE_OBJECT_KINDS_V0[number];

export const GOVERNANCE_STATUSES_V0 = [
  "draft",
  "active",
  "blocked",
  "ready",
  "archived",
] as const;

export type GovernanceStatusV0 = typeof GOVERNANCE_STATUSES_V0[number];

export type GovernanceObjectKindLikeV0 = GovernanceObjectKindV0 | (string & {});
export type GovernanceStatusLikeV0 = GovernanceStatusV0 | (string & {});

export const GOVERNANCE_RUN_STATUSES_V0 = [
  "queued",
  "running",
  "blocked",
  "failed",
  "succeeded",
] as const;

export type GovernanceRunStatusV0 = typeof GOVERNANCE_RUN_STATUSES_V0[number];
export type GovernanceRunStatusLikeV0 = GovernanceRunStatusV0 | "done" | (string & {});

export type EvidenceValidationOutcomeV0 = "pass" | "fail" | "na" | (string & {});

export interface RunRefV0 {
  runId: string;
  status: GovernanceRunStatusLikeV0;
  blockerReason: string | null;
  finishedAt: string | null;
}

export interface EvidencePacketRefV0 {
  runId: string;
  evidencePath: string;
  validationOutcome: EvidenceValidationOutcomeV0;
}

export interface VersionProvenanceRefsV0 {
  latestRun?: RunRefV0;
  latestEvidence?: EvidencePacketRefV0;
  supportingRuns?: RunRefV0[];
}

export interface GovernanceRecordValidationError {
  ok: false;
  errors: string[];
}

export interface GovernanceRecordValidationSuccess<T> {
  ok: true;
  value: T;
}

export type GovernanceRecordValidationResult<T> =
  | GovernanceRecordValidationSuccess<T>
  | GovernanceRecordValidationError;

interface GovernanceRecordBaseV0<K extends GovernanceObjectKindV0> {
  schemaVersion: 0;
  kind: K;
  id: string;
  workspaceId: string;
  createdAt: string;
  updatedAt: string;
  /**
   * Object-local lifecycle value. Readers should tolerate future additions and
   * only map into GovernanceStatusV0 summaries when they need a projection.
   */
  status: GovernanceStatusLikeV0;
}

export interface DocumentRecordV0 extends GovernanceRecordBaseV0<"document"> {
  title: string;
  ownerId: string;
  currentVersionId: string | null;
}

export interface VersionRecordV0 extends GovernanceRecordBaseV0<"version"> {
  documentId: string;
  createdById: string;
  label: string;
}

export interface ReviewRecordV0 extends GovernanceRecordBaseV0<"review"> {
  documentId: string;
  versionId: string;
  requestedById: string;
  reviewerId: string;
}

export interface ApprovalRecordV0 extends GovernanceRecordBaseV0<"approval"> {
  documentId: string;
  versionId: string;
  requestedById: string;
  approverId: string;
}

export interface PublishPackageRecordV0 extends GovernanceRecordBaseV0<"publish_package"> {
  documentId: string;
  versionId: string;
  ownerId: string;
  targetId: string;
}

export interface PlaybookRecordV0 extends GovernanceRecordBaseV0<"playbook"> {
  title: string;
  ownerId: string;
}

export interface ScenarioRecordV0 extends GovernanceRecordBaseV0<"scenario"> {
  playbookId: string;
  title: string;
  ownerId: string;
}

export interface ScheduleRecordV0 extends GovernanceRecordBaseV0<"schedule"> {
  playbookId: string;
  scenarioId: string;
  ownerId: string;
  cadence: string;
}

export type GovernanceRecordV0 =
  | DocumentRecordV0
  | VersionRecordV0
  | ReviewRecordV0
  | ApprovalRecordV0
  | PublishPackageRecordV0
  | PlaybookRecordV0
  | ScenarioRecordV0
  | ScheduleRecordV0;

export interface GovernanceListOutputV0 {
  schemaVersion: 0;
  kind: GovernanceObjectKindV0;
  items: GovernanceRecordV0[];
}

export interface GovernanceShowOutputV0 {
  schemaVersion: 0;
  kind: GovernanceObjectKindV0;
  item: GovernanceRecordV0;
}

const GOVERNANCE_OBJECT_KIND_SET = new Set<string>(GOVERNANCE_OBJECT_KINDS_V0);
const GOVERNANCE_STATUS_SET = new Set<string>(GOVERNANCE_STATUSES_V0);
const GOVERNANCE_RUN_STATUS_SET = new Set<string>(GOVERNANCE_RUN_STATUSES_V0);

function hasOwnProperty(object: Record<string, unknown>, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(object, key);
}

function validateStringField(
  record: Record<string, unknown>,
  field: string,
  errors: string[],
): void {
  if (!hasOwnProperty(record, field)) {
    errors.push(`missing required field: ${field}`);
    return;
  }

  if (typeof record[field] !== "string") {
    errors.push(`${field} must be a string`);
  }
}

function validateNullableStringField(
  record: Record<string, unknown>,
  field: string,
  errors: string[],
): void {
  if (!hasOwnProperty(record, field)) {
    errors.push(`missing required field: ${field}`);
    return;
  }

  const value = record[field];
  if (value !== null && typeof value !== "string") {
    errors.push(`${field} must be a string or null`);
  }
}

function validateBaseRecord(
  value: unknown,
  expectedKind: GovernanceObjectKindV0,
  extraStringFields: readonly string[],
  extraNullableStringFields: readonly string[] = [],
): GovernanceRecordValidationResult<Record<string, unknown>> {
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

  return errors.length === 0
    ? { ok: true, value: record }
    : { ok: false, errors };
}

export function parseGovernanceObjectKindV0(
  value: unknown,
): GovernanceObjectKindLikeV0 | null {
  if (typeof value !== "string") return null;
  if (GOVERNANCE_OBJECT_KIND_SET.has(value)) {
    return value as GovernanceObjectKindV0;
  }

  return value;
}

export function parseGovernanceStatusV0(
  value: unknown,
): GovernanceStatusLikeV0 | null {
  if (typeof value !== "string") return null;
  if (GOVERNANCE_STATUS_SET.has(value)) {
    return value as GovernanceStatusV0;
  }

  return value;
}

export function normalizeGovernanceRunStatusV0(
  value: unknown,
): GovernanceRunStatusLikeV0 | null {
  if (typeof value !== "string") return null;
  if (value === "done") return "succeeded";
  if (GOVERNANCE_RUN_STATUS_SET.has(value)) {
    return value as GovernanceRunStatusV0;
  }

  return value;
}

export function toRunRefV0(value: {
  runId: string;
  status: unknown;
  blockerReason?: unknown;
  finishedAt?: unknown;
}): RunRefV0 {
  return {
    runId: value.runId,
    status: normalizeGovernanceRunStatusV0(value.status) ?? "failed",
    blockerReason: typeof value.blockerReason === "string" ? value.blockerReason : null,
    finishedAt: typeof value.finishedAt === "string" ? value.finishedAt : null,
  };
}

export function toEvidencePacketRefV0(value: {
  runId: string;
  evidencePath: string;
  validationOutcome?: unknown;
  validation?: { outcome?: unknown } | null;
}): EvidencePacketRefV0 {
  const validationOutcome = typeof value.validationOutcome === "string"
    ? value.validationOutcome
    : typeof value.validation?.outcome === "string"
      ? value.validation.outcome
      : "na";

  return {
    runId: value.runId,
    evidencePath: value.evidencePath,
    validationOutcome,
  };
}

export function toVersionProvenanceRefsV0(value: {
  latestRun?: {
    runId: string;
    status: unknown;
    blockerReason?: unknown;
    finishedAt?: unknown;
  } | null;
  latestEvidence?: {
    runId: string;
    evidencePath: string;
    validationOutcome?: unknown;
    validation?: { outcome?: unknown } | null;
  } | null;
  supportingRuns?: Array<{
    runId: string;
    status: unknown;
    blockerReason?: unknown;
    finishedAt?: unknown;
  }> | null;
}): VersionProvenanceRefsV0 {
  const refs: VersionProvenanceRefsV0 = {};

  if (value.latestRun) {
    refs.latestRun = toRunRefV0(value.latestRun);
  }

  if (value.latestEvidence) {
    refs.latestEvidence = toEvidencePacketRefV0(value.latestEvidence);
  }

  if (value.supportingRuns) {
    refs.supportingRuns = value.supportingRuns.map((run) => toRunRefV0(run));
  }

  return refs;
}

export function validateDocumentRecordV0(
  value: unknown,
): GovernanceRecordValidationResult<DocumentRecordV0> {
  const result = validateBaseRecord(value, "document", ["title", "ownerId"], ["currentVersionId"]);
  return result.ok ? { ok: true, value: result.value as unknown as DocumentRecordV0 } : result;
}

export function validateVersionRecordV0(
  value: unknown,
): GovernanceRecordValidationResult<VersionRecordV0> {
  const result = validateBaseRecord(value, "version", ["documentId", "createdById", "label"]);
  return result.ok ? { ok: true, value: result.value as unknown as VersionRecordV0 } : result;
}

export function validateReviewRecordV0(
  value: unknown,
): GovernanceRecordValidationResult<ReviewRecordV0> {
  const result = validateBaseRecord(value, "review", ["documentId", "versionId", "requestedById", "reviewerId"]);
  return result.ok ? { ok: true, value: result.value as unknown as ReviewRecordV0 } : result;
}

export function validateApprovalRecordV0(
  value: unknown,
): GovernanceRecordValidationResult<ApprovalRecordV0> {
  const result = validateBaseRecord(value, "approval", ["documentId", "versionId", "requestedById", "approverId"]);
  return result.ok ? { ok: true, value: result.value as unknown as ApprovalRecordV0 } : result;
}

export function validatePublishPackageRecordV0(
  value: unknown,
): GovernanceRecordValidationResult<PublishPackageRecordV0> {
  const result = validateBaseRecord(value, "publish_package", ["documentId", "versionId", "ownerId", "targetId"]);
  return result.ok ? { ok: true, value: result.value as unknown as PublishPackageRecordV0 } : result;
}

export function validatePlaybookRecordV0(
  value: unknown,
): GovernanceRecordValidationResult<PlaybookRecordV0> {
  const result = validateBaseRecord(value, "playbook", ["title", "ownerId"]);
  return result.ok ? { ok: true, value: result.value as unknown as PlaybookRecordV0 } : result;
}

export function validateScenarioRecordV0(
  value: unknown,
): GovernanceRecordValidationResult<ScenarioRecordV0> {
  const result = validateBaseRecord(value, "scenario", ["playbookId", "title", "ownerId"]);
  return result.ok ? { ok: true, value: result.value as unknown as ScenarioRecordV0 } : result;
}

export function validateScheduleRecordV0(
  value: unknown,
): GovernanceRecordValidationResult<ScheduleRecordV0> {
  const result = validateBaseRecord(value, "schedule", ["playbookId", "scenarioId", "ownerId", "cadence"]);
  return result.ok ? { ok: true, value: result.value as unknown as ScheduleRecordV0 } : result;
}
