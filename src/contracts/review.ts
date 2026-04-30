import type { GovernanceRecordValidationResult } from "./governance.js";

export const REVIEW_TARGET_KINDS_V0 = [
  "document",
  "version",
  "section",
  "publish_package",
] as const;

export type ReviewTargetKindV0 = typeof REVIEW_TARGET_KINDS_V0[number];
export type ReviewTargetKindLikeV0 = ReviewTargetKindV0 | (string & {});

export const DECISION_EVENTS_V0 = [
  "requested",
  "commented",
  "changes_requested",
  "approved",
  "rejected",
  "revoked",
  "delegated",
  "expired",
] as const;

export type DecisionEventV0 = typeof DECISION_EVENTS_V0[number];
export type DecisionEventLikeV0 = DecisionEventV0 | (string & {});

export const REVIEW_STATUSES_V0 = [
  "draft",
  "requested",
  "in_review",
  "changes_requested",
  "blocked",
  "succeeded",
  "rejected",
  "revoked",
  "expired",
] as const;

export const APPROVAL_STATUSES_V0 = [
  "draft",
  "requested",
  "in_review",
  "changes_requested",
  "blocked",
  "succeeded",
  "rejected",
  "revoked",
  "expired",
] as const;

export type ReviewStatusV0 = typeof REVIEW_STATUSES_V0[number];
export type ApprovalStatusV0 = typeof APPROVAL_STATUSES_V0[number];
export type ReviewStatusLikeV0 = ReviewStatusV0 | "done" | (string & {});
export type ApprovalStatusLikeV0 = ApprovalStatusV0 | "done" | (string & {});

export interface DocumentTargetRefV0 {
  kind: "document";
  documentId: string;
}

export interface VersionTargetRefV0 {
  kind: "version";
  documentId: string;
  versionId: string;
}

export interface SectionTargetRefV0 {
  kind: "section";
  documentId: string;
  versionId: string;
  sectionId: string;
}

export interface PublishPackageTargetRefV0 {
  kind: "publish_package";
  documentId: string;
  versionId: string;
  packageId: string;
}

export type GovernedTargetRefV0 =
  | DocumentTargetRefV0
  | VersionTargetRefV0
  | SectionTargetRefV0
  | PublishPackageTargetRefV0;

export type ReviewMetadataValueV0 = string | number | boolean | null;
export type ReviewMetadataV0 = Record<string, ReviewMetadataValueV0>;

export interface EvidenceRequirementV0 {
  ref: string;
  required: boolean;
  note?: string;
}

export interface DiffSnapshotRefV0 {
  diffId: string;
  path: string;
  checksum?: string;
  summary?: string;
}

export interface ApprovalPolicySummaryV0 {
  policyId: string;
  summary: string;
  mode?: string;
}

export interface RequiredApproverRoleV0 {
  roleLabel: string;
  minApprovers: number;
  note?: string;
}

export interface DecisionSummaryV0 {
  latestDecisionId: string | null;
  latestEvent: DecisionEventLikeV0 | null;
  decidedAt: string | null;
  summary: string;
}

interface ReviewRequestBaseV0<S extends string> {
  schemaVersion: 0;
  id: string;
  workspaceId: string;
  target: GovernedTargetRefV0;
  requestedById: string;
  assigneeIds: string[];
  status: S;
  evidenceRequirements: EvidenceRequirementV0[];
  diffSnapshot: DiffSnapshotRefV0 | null;
  createdAt: string;
  updatedAt: string;
  requestedAt: string;
  metadata?: ReviewMetadataV0;
}

export interface ReviewRequestV0 extends ReviewRequestBaseV0<ReviewStatusLikeV0> {
  schema: "pluto.review.request";
}

export interface ApprovalRequestV0 extends ReviewRequestBaseV0<ApprovalStatusLikeV0> {
  schema: "pluto.review.approval-request";
  approvalPolicy: ApprovalPolicySummaryV0;
  requiredApproverRoles: RequiredApproverRoleV0[];
  decisionSummary: DecisionSummaryV0;
  blockedReasons: string[];
}

export interface DecisionRecordV0 {
  schema: "pluto.review.decision";
  schemaVersion: 0;
  id: string;
  requestId: string;
  requestKind: "review" | "approval";
  target: GovernedTargetRefV0;
  event: DecisionEventLikeV0;
  actorId: string;
  comment: string | null;
  delegatedToId: string | null;
  recordedAt: string;
  metadata?: ReviewMetadataV0;
}

export interface DelegationScopeV0 {
  requestKind?: "review" | "approval";
  requestId?: string;
  targetKind?: ReviewTargetKindLikeV0;
  targetId?: string;
}

export interface DelegationRecordV0 {
  schema: "pluto.review.delegation";
  schemaVersion: 0;
  id: string;
  workspaceId: string;
  delegatorId: string;
  delegateeId: string;
  roleLabel: string;
  scope: DelegationScopeV0;
  expiresAt: string | null;
  revokedAt: string | null;
  revokedById: string | null;
  createdAt: string;
  metadata?: ReviewMetadataV0;
}

export interface SlaOverlayV0 {
  schema: "pluto.review.sla-overlay";
  schemaVersion: 0;
  id: string;
  requestId: string;
  requestKind: "review" | "approval";
  dueAt: string | null;
  overdue: boolean;
  blocked: boolean;
  degraded: boolean;
  blockedReasons: string[];
  computedAt: string;
}

const REVIEW_TARGET_KIND_SET = new Set<string>(REVIEW_TARGET_KINDS_V0);
const DECISION_EVENT_SET = new Set<string>(DECISION_EVENTS_V0);
const REVIEW_STATUS_SET = new Set<string>(REVIEW_STATUSES_V0);
const APPROVAL_STATUS_SET = new Set<string>(APPROVAL_STATUSES_V0);

function hasOwnProperty(object: Record<string, unknown>, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(object, key);
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (typeof value !== "object" || value === null) {
    return null;
  }

  return value as Record<string, unknown>;
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

function validateStringArrayField(
  record: Record<string, unknown>,
  field: string,
  errors: string[],
): void {
  if (!hasOwnProperty(record, field)) {
    errors.push(`missing required field: ${field}`);
    return;
  }

  const value = record[field];
  if (!Array.isArray(value) || value.some((entry) => typeof entry !== "string")) {
    errors.push(`${field} must be an array of strings`);
  }
}

function validateReviewMetadata(value: unknown, field: string, errors: string[]): void {
  if (value === undefined) {
    return;
  }

  const record = asRecord(value);
  if (!record) {
    errors.push(`${field} must be an object`);
    return;
  }

  for (const [key, entry] of Object.entries(record)) {
    if (
      typeof entry !== "string"
      && typeof entry !== "number"
      && typeof entry !== "boolean"
      && entry !== null
    ) {
      errors.push(`${field}.${key} must be a string, number, boolean, or null`);
    }
  }
}

function validateEvidenceRequirements(value: unknown, errors: string[]): void {
  if (!Array.isArray(value)) {
    errors.push("evidenceRequirements must be an array");
    return;
  }

  value.forEach((entry, index) => {
    const record = asRecord(entry);
    if (!record) {
      errors.push(`evidenceRequirements[${index}] must be an object`);
      return;
    }

    if (typeof record["ref"] !== "string") {
      errors.push(`evidenceRequirements[${index}].ref must be a string`);
    }

    if (typeof record["required"] !== "boolean") {
      errors.push(`evidenceRequirements[${index}].required must be a boolean`);
    }

    if (record["note"] !== undefined && typeof record["note"] !== "string") {
      errors.push(`evidenceRequirements[${index}].note must be a string when present`);
    }
  });
}

function validateDiffSnapshot(value: unknown, errors: string[]): void {
  if (value === null) {
    return;
  }

  const record = asRecord(value);
  if (!record) {
    errors.push("diffSnapshot must be an object or null");
    return;
  }

  if (typeof record["diffId"] !== "string") {
    errors.push("diffSnapshot.diffId must be a string");
  }

  if (typeof record["path"] !== "string") {
    errors.push("diffSnapshot.path must be a string");
  }

  if (record["checksum"] !== undefined && typeof record["checksum"] !== "string") {
    errors.push("diffSnapshot.checksum must be a string when present");
  }

  if (record["summary"] !== undefined && typeof record["summary"] !== "string") {
    errors.push("diffSnapshot.summary must be a string when present");
  }
}

function validateApprovalPolicySummary(value: unknown, errors: string[]): void {
  const record = asRecord(value);
  if (!record) {
    errors.push("approvalPolicy must be an object");
    return;
  }

  if (typeof record["policyId"] !== "string") {
    errors.push("approvalPolicy.policyId must be a string");
  }

  if (typeof record["summary"] !== "string") {
    errors.push("approvalPolicy.summary must be a string");
  }

  if (record["mode"] !== undefined && typeof record["mode"] !== "string") {
    errors.push("approvalPolicy.mode must be a string when present");
  }
}

function validateRequiredApproverRoles(value: unknown, errors: string[]): void {
  if (!Array.isArray(value)) {
    errors.push("requiredApproverRoles must be an array");
    return;
  }

  value.forEach((entry, index) => {
    const record = asRecord(entry);
    if (!record) {
      errors.push(`requiredApproverRoles[${index}] must be an object`);
      return;
    }

    if (typeof record["roleLabel"] !== "string") {
      errors.push(`requiredApproverRoles[${index}].roleLabel must be a string`);
    }

    if (typeof record["minApprovers"] !== "number") {
      errors.push(`requiredApproverRoles[${index}].minApprovers must be a number`);
    }

    if (record["note"] !== undefined && typeof record["note"] !== "string") {
      errors.push(`requiredApproverRoles[${index}].note must be a string when present`);
    }
  });
}

function validateDecisionSummary(value: unknown, errors: string[]): void {
  const record = asRecord(value);
  if (!record) {
    errors.push("decisionSummary must be an object");
    return;
  }

  if (record["latestDecisionId"] !== null && typeof record["latestDecisionId"] !== "string") {
    errors.push("decisionSummary.latestDecisionId must be a string or null");
  }

  if (record["latestEvent"] !== null && typeof record["latestEvent"] !== "string") {
    errors.push("decisionSummary.latestEvent must be a string or null");
  }

  if (record["decidedAt"] !== null && typeof record["decidedAt"] !== "string") {
    errors.push("decisionSummary.decidedAt must be a string or null");
  }

  if (typeof record["summary"] !== "string") {
    errors.push("decisionSummary.summary must be a string");
  }
}

function validateDelegationScope(value: unknown, errors: string[]): void {
  const record = asRecord(value);
  if (!record) {
    errors.push("scope must be an object");
    return;
  }

  if (record["requestKind"] !== undefined && record["requestKind"] !== "review" && record["requestKind"] !== "approval") {
    errors.push("scope.requestKind must be review or approval when present");
  }

  if (record["requestId"] !== undefined && typeof record["requestId"] !== "string") {
    errors.push("scope.requestId must be a string when present");
  }

  if (record["targetKind"] !== undefined && typeof record["targetKind"] !== "string") {
    errors.push("scope.targetKind must be a string when present");
  }

  if (record["targetId"] !== undefined && typeof record["targetId"] !== "string") {
    errors.push("scope.targetId must be a string when present");
  }
}

function validateRequestBase(
  value: unknown,
  expectedSchema: string,
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
  validateStringField(record, "requestedById", errors);
  validateStringField(record, "status", errors);
  validateStringField(record, "createdAt", errors);
  validateStringField(record, "updatedAt", errors);
  validateStringField(record, "requestedAt", errors);
  validateStringArrayField(record, "assigneeIds", errors);

  if (!hasOwnProperty(record, "target")) {
    errors.push("missing required field: target");
  } else {
    const targetResult = validateGovernedTargetRefV0(record["target"]);
    if (!targetResult.ok) {
      errors.push(...targetResult.errors);
    }
  }

  if (!hasOwnProperty(record, "evidenceRequirements")) {
    errors.push("missing required field: evidenceRequirements");
  } else {
    validateEvidenceRequirements(record["evidenceRequirements"], errors);
  }

  if (!hasOwnProperty(record, "diffSnapshot")) {
    errors.push("missing required field: diffSnapshot");
  } else {
    validateDiffSnapshot(record["diffSnapshot"], errors);
  }

  validateReviewMetadata(record["metadata"], "metadata", errors);

  return errors.length === 0 ? { ok: true, value: record } : { ok: false, errors };
}

export function parseReviewTargetKindV0(value: unknown): ReviewTargetKindLikeV0 | null {
  if (typeof value !== "string") return null;
  if (REVIEW_TARGET_KIND_SET.has(value)) {
    return value as ReviewTargetKindV0;
  }

  return value;
}

export function parseDecisionEventV0(value: unknown): DecisionEventLikeV0 | null {
  if (typeof value !== "string") return null;
  if (DECISION_EVENT_SET.has(value)) {
    return value as DecisionEventV0;
  }

  return value;
}

export function normalizeReviewStatusV0(value: unknown): ReviewStatusLikeV0 | null {
  if (typeof value !== "string") return null;
  if (value === "done") return "succeeded";
  if (REVIEW_STATUS_SET.has(value)) {
    return value as ReviewStatusV0;
  }

  return value;
}

export function normalizeApprovalStatusV0(value: unknown): ApprovalStatusLikeV0 | null {
  if (typeof value !== "string") return null;
  if (value === "done") return "succeeded";
  if (APPROVAL_STATUS_SET.has(value)) {
    return value as ApprovalStatusV0;
  }

  return value;
}

export function validateGovernedTargetRefV0(
  value: unknown,
): GovernanceRecordValidationResult<GovernedTargetRefV0> {
  const record = asRecord(value);
  if (!record) {
    return { ok: false, errors: ["target must be an object"] };
  }

  const errors: string[] = [];
  const kind = record["kind"];

  if (typeof kind !== "string") {
    errors.push("target.kind must be a string");
  } else if (!REVIEW_TARGET_KIND_SET.has(kind)) {
    errors.push(`target.kind must be one of: ${REVIEW_TARGET_KINDS_V0.join(", ")}`);
  }

  if (typeof record["documentId"] !== "string") {
    errors.push("target.documentId must be a string");
  }

  if ((kind === "version" || kind === "section" || kind === "publish_package") && typeof record["versionId"] !== "string") {
    errors.push("target.versionId must be a string");
  }

  if (kind === "section" && typeof record["sectionId"] !== "string") {
    errors.push("target.sectionId must be a string");
  }

  if (kind === "publish_package" && typeof record["packageId"] !== "string") {
    errors.push("target.packageId must be a string");
  }

  return errors.length === 0
    ? { ok: true, value: record as unknown as GovernedTargetRefV0 }
    : { ok: false, errors };
}

export function validateReviewRequestV0(
  value: unknown,
): GovernanceRecordValidationResult<ReviewRequestV0> {
  const result = validateRequestBase(value, "pluto.review.request");
  return result.ok ? { ok: true, value: result.value as unknown as ReviewRequestV0 } : result;
}

export function validateApprovalRequestV0(
  value: unknown,
): GovernanceRecordValidationResult<ApprovalRequestV0> {
  const result = validateRequestBase(value, "pluto.review.approval-request");
  if (!result.ok) {
    return result;
  }

  const record = result.value;
  const errors: string[] = [];

  if (!hasOwnProperty(record, "approvalPolicy")) {
    errors.push("missing required field: approvalPolicy");
  } else {
    validateApprovalPolicySummary(record["approvalPolicy"], errors);
  }

  if (!hasOwnProperty(record, "requiredApproverRoles")) {
    errors.push("missing required field: requiredApproverRoles");
  } else {
    validateRequiredApproverRoles(record["requiredApproverRoles"], errors);
  }

  if (!hasOwnProperty(record, "decisionSummary")) {
    errors.push("missing required field: decisionSummary");
  } else {
    validateDecisionSummary(record["decisionSummary"], errors);
  }

  validateStringArrayField(record, "blockedReasons", errors);

  return errors.length === 0
    ? { ok: true, value: record as unknown as ApprovalRequestV0 }
    : { ok: false, errors };
}

export function validateDecisionRecordV0(
  value: unknown,
): GovernanceRecordValidationResult<DecisionRecordV0> {
  const record = asRecord(value);
  if (!record) {
    return { ok: false, errors: ["record must be an object"] };
  }

  const errors: string[] = [];

  if (record["schema"] !== "pluto.review.decision") {
    errors.push("schema must be pluto.review.decision");
  }

  if (record["schemaVersion"] !== 0) {
    errors.push("schemaVersion must be 0");
  }

  validateStringField(record, "id", errors);
  validateStringField(record, "requestId", errors);
  validateStringField(record, "requestKind", errors);
  validateStringField(record, "event", errors);
  validateStringField(record, "actorId", errors);
  validateNullableStringField(record, "comment", errors);
  validateNullableStringField(record, "delegatedToId", errors);
  validateStringField(record, "recordedAt", errors);

  if (record["requestKind"] !== "review" && record["requestKind"] !== "approval") {
    errors.push("requestKind must be review or approval");
  }

  if (!hasOwnProperty(record, "target")) {
    errors.push("missing required field: target");
  } else {
    const targetResult = validateGovernedTargetRefV0(record["target"]);
    if (!targetResult.ok) {
      errors.push(...targetResult.errors);
    }
  }

  validateReviewMetadata(record["metadata"], "metadata", errors);

  return errors.length === 0
    ? { ok: true, value: record as unknown as DecisionRecordV0 }
    : { ok: false, errors };
}

export function validateDelegationRecordV0(
  value: unknown,
): GovernanceRecordValidationResult<DelegationRecordV0> {
  const record = asRecord(value);
  if (!record) {
    return { ok: false, errors: ["record must be an object"] };
  }

  const errors: string[] = [];

  if (record["schema"] !== "pluto.review.delegation") {
    errors.push("schema must be pluto.review.delegation");
  }

  if (record["schemaVersion"] !== 0) {
    errors.push("schemaVersion must be 0");
  }

  validateStringField(record, "id", errors);
  validateStringField(record, "workspaceId", errors);
  validateStringField(record, "delegatorId", errors);
  validateStringField(record, "delegateeId", errors);
  validateStringField(record, "roleLabel", errors);
  validateNullableStringField(record, "expiresAt", errors);
  validateNullableStringField(record, "revokedAt", errors);
  validateNullableStringField(record, "revokedById", errors);
  validateStringField(record, "createdAt", errors);

  if (!hasOwnProperty(record, "scope")) {
    errors.push("missing required field: scope");
  } else {
    validateDelegationScope(record["scope"], errors);
  }

  validateReviewMetadata(record["metadata"], "metadata", errors);

  return errors.length === 0
    ? { ok: true, value: record as unknown as DelegationRecordV0 }
    : { ok: false, errors };
}

export function validateSlaOverlayV0(
  value: unknown,
): GovernanceRecordValidationResult<SlaOverlayV0> {
  const record = asRecord(value);
  if (!record) {
    return { ok: false, errors: ["record must be an object"] };
  }

  const errors: string[] = [];

  if (record["schema"] !== "pluto.review.sla-overlay") {
    errors.push("schema must be pluto.review.sla-overlay");
  }

  if (record["schemaVersion"] !== 0) {
    errors.push("schemaVersion must be 0");
  }

  validateStringField(record, "id", errors);
  validateStringField(record, "requestId", errors);
  validateStringField(record, "requestKind", errors);
  validateNullableStringField(record, "dueAt", errors);
  validateStringField(record, "computedAt", errors);
  validateStringArrayField(record, "blockedReasons", errors);

  if (record["requestKind"] !== "review" && record["requestKind"] !== "approval") {
    errors.push("requestKind must be review or approval");
  }

  if (typeof record["overdue"] !== "boolean") {
    errors.push("overdue must be a boolean");
  }

  if (typeof record["blocked"] !== "boolean") {
    errors.push("blocked must be a boolean");
  }

  if (typeof record["degraded"] !== "boolean") {
    errors.push("degraded must be a boolean");
  }

  return errors.length === 0
    ? { ok: true, value: record as unknown as SlaOverlayV0 }
    : { ok: false, errors };
}
