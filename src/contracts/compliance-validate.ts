import type { SealedEvidenceRefV0 } from "./evidence-graph.js";
import type { PublishPackageRecordV0 } from "./publish.js";
import type { ApprovalRequestV0, ReviewRequestV0 } from "./review.js";

import type { GovernanceRecordValidationResult } from "./governance.js";

import type {
  ComplianceStatusLikeV0,
  ComplianceActionLikeV0,
  ComplianceActionEventLikeV0,
  ComplianceGovernedObjectKindLikeV0,
  RegulatedPublishGateBlockedReasonV0,
  GovernedObjectRefV0,
  GovernedDocumentRefV0,
  GovernedVersionRefV0,
  GovernedReviewRefV0,
  GovernedApprovalRefV0,
  GovernedPublishPackageRefV0,
  GovernedSealedEvidenceRefV0,
  RetentionPolicyV0,
  LegalHoldV0,
  DeletionAttemptV0,
  ComplianceEvidenceV0,
  AuditExportManifestV0,
  ComplianceActionEventV0,
  RegulatedPublishGateInputV0,
  RegulatedPublishDecisionV0,
  RegulatedPublishGateResultV0,
} from "./compliance-schema.js";

const COMPLIANCE_STATUS_SET = new Set<string>([
  "draft",
  "active",
  "suspended",
  "superseded",
  "placed",
  "under_review",
  "released",
  "expired",
  "blocked",
  "allowed",
  "completed",
  "failed",
  "generated",
  "signed",
  "delivered",
  "acknowledged",
  "succeeded",
]);
const COMPLIANCE_ACTION_SET = new Set<string>([
  "retention_assigned",
  "retention_changed",
  "legal_hold_placed",
  "legal_hold_released",
  "deletion_allowed",
  "deletion_blocked",
  "audit_export_generated",
  "audit_export_signed",
  "audit_export_delivered",
  "compliance_approved",
  "regulated_publish_allowed",
  "regulated_publish_blocked",
]);
const COMPLIANCE_GOVERNED_OBJECT_KIND_SET = new Set<string>([
  "document",
  "version",
  "review",
  "approval",
  "publish_package",
  "sealed_evidence",
]);
const REGULATED_PUBLISH_GATE_BLOCKED_REASON_SET = new Set<string>(["missing_compliance_evidence"]);

function hasOwnProperty(object: Record<string, unknown>, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(object, key);
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return null;
  }

  return value as Record<string, unknown>;
}

function validateSchema(
  record: Record<string, unknown>,
  expectedSchema: string,
  errors: string[],
): void {
  if (record["schema"] !== expectedSchema) {
    errors.push(`schema must be ${expectedSchema}`);
  }

  if (record["schemaVersion"] !== 0) {
    errors.push("schemaVersion must be 0");
  }
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

function validateComplianceStatus(value: unknown, field: string, errors: string[]): void {
  if (normalizeComplianceStatusV0(value) === null) {
    errors.push(`${field} must be a string`);
  }
}

function validateGovernedObjectRef(value: unknown, field: string, errors: string[]): void {
  const record = asRecord(value);
  if (!record) {
    errors.push(`${field} must be an object`);
    return;
  }

  if (record["schemaVersion"] !== 0) {
    errors.push(`${field}.schemaVersion must be 0`);
  }

  if (typeof record["kind"] !== "string") {
    errors.push(`${field}.kind must be a string`);
    return;
  }

  if (typeof record["stableId"] !== "string") {
    errors.push(`${field}.stableId must be a string`);
  }

  if (record["workspaceId"] !== undefined && typeof record["workspaceId"] !== "string") {
    errors.push(`${field}.workspaceId must be a string when present`);
  }

  if (record["summary"] !== undefined && typeof record["summary"] !== "string") {
    errors.push(`${field}.summary must be a string when present`);
  }

  switch (record["kind"]) {
    case "document":
      if (typeof record["documentId"] !== "string") errors.push(`${field}.documentId must be a string`);
      break;
    case "version":
      if (typeof record["documentId"] !== "string") errors.push(`${field}.documentId must be a string`);
      if (typeof record["versionId"] !== "string") errors.push(`${field}.versionId must be a string`);
      break;
    case "review":
      if (typeof record["documentId"] !== "string") errors.push(`${field}.documentId must be a string`);
      if (typeof record["versionId"] !== "string") errors.push(`${field}.versionId must be a string`);
      if (typeof record["reviewId"] !== "string") errors.push(`${field}.reviewId must be a string`);
      break;
    case "approval":
      if (typeof record["documentId"] !== "string") errors.push(`${field}.documentId must be a string`);
      if (typeof record["versionId"] !== "string") errors.push(`${field}.versionId must be a string`);
      if (typeof record["approvalId"] !== "string") errors.push(`${field}.approvalId must be a string`);
      break;
    case "publish_package":
      if (typeof record["documentId"] !== "string") errors.push(`${field}.documentId must be a string`);
      if (typeof record["versionId"] !== "string") errors.push(`${field}.versionId must be a string`);
      if (typeof record["packageId"] !== "string") errors.push(`${field}.packageId must be a string`);
      break;
    case "sealed_evidence":
      if (typeof record["runId"] !== "string") errors.push(`${field}.runId must be a string`);
      if (typeof record["evidenceId"] !== "string") errors.push(`${field}.evidenceId must be a string`);
      if (typeof record["packetId"] !== "string") errors.push(`${field}.packetId must be a string`);
      break;
    default:
      errors.push(`${field}.kind must be a supported governed object kind`);
  }
}

function validateGovernedObjectRefArray(value: unknown, field: string, errors: string[]): void {
  if (!Array.isArray(value)) {
    errors.push(`${field} must be an array`);
    return;
  }

  value.forEach((entry, index) => validateGovernedObjectRef(entry, `${field}[${index}]`, errors));
}

function validateSummaryObject(
  value: unknown,
  field: string,
  errors: string[],
  stringArrayFields: readonly string[],
  stringFields: readonly string[],
  nullableStringFields: readonly string[] = [],
): void {
  const record = asRecord(value);
  if (!record) {
    errors.push(`${field} must be an object`);
    return;
  }

  for (const item of stringArrayFields) {
    validateStringArrayField(record, item, errors);
  }

  for (const item of stringFields) {
    validateStringField(record, item, errors);
  }

  for (const item of nullableStringFields) {
    validateNullableStringField(record, item, errors);
  }
}

function validateBaseComplianceRecord(
  value: unknown,
  schema: string,
): GovernanceRecordValidationResult<Record<string, unknown>> {
  const record = asRecord(value);
  if (!record) {
    return { ok: false, errors: ["record must be an object"] };
  }

  const errors: string[] = [];
  validateSchema(record, schema, errors);
  validateStringField(record, "id", errors);
  validateStringField(record, "workspaceId", errors);

  return errors.length === 0 ? { ok: true, value: record } : { ok: false, errors };
}

export function normalizeComplianceStatusV0(value: unknown): ComplianceStatusLikeV0 | null {
  if (typeof value !== "string") return null;
  if (value === "done") return "succeeded";
  if (COMPLIANCE_STATUS_SET.has(value)) {
    return value as ComplianceStatusLikeV0;
  }

  return value;
}

export function parseComplianceActionV0(value: unknown): ComplianceActionLikeV0 | null {
  if (typeof value !== "string") return null;
  if (COMPLIANCE_ACTION_SET.has(value)) {
    return value as ComplianceActionLikeV0;
  }

  return value;
}

export function parseComplianceActionEventV0(value: unknown): ComplianceActionEventLikeV0 | null {
  return parseComplianceActionV0(value);
}

export function parseComplianceGovernedObjectKindV0(value: unknown): ComplianceGovernedObjectKindLikeV0 | null {
  if (typeof value !== "string") return null;
  if (COMPLIANCE_GOVERNED_OBJECT_KIND_SET.has(value)) {
    return value as ComplianceGovernedObjectKindLikeV0;
  }

  return value;
}

export function parseRegulatedPublishGateBlockedReasonV0(
  value: unknown,
): RegulatedPublishGateBlockedReasonV0 | null {
  if (typeof value !== "string") return null;
  if (REGULATED_PUBLISH_GATE_BLOCKED_REASON_SET.has(value)) {
    return value as RegulatedPublishGateBlockedReasonV0;
  }

  return value;
}

export function toGovernedDocumentRefV0(value: { documentId: string; workspaceId?: string; summary?: string }): GovernedDocumentRefV0 {
  return {
    schemaVersion: 0,
    kind: "document",
    stableId: value.documentId,
    documentId: value.documentId,
    workspaceId: value.workspaceId,
    summary: value.summary,
  };
}

export function toGovernedVersionRefV0(value: {
  documentId: string;
  versionId: string;
  workspaceId?: string;
  summary?: string;
}): GovernedVersionRefV0 {
  return {
    schemaVersion: 0,
    kind: "version",
    stableId: value.versionId,
    documentId: value.documentId,
    versionId: value.versionId,
    workspaceId: value.workspaceId,
    summary: value.summary,
  };
}

export function toGovernedReviewRefV0(
  value: Pick<ReviewRequestV0, "id" | "workspaceId"> & { target: { documentId: string; versionId: string }; summary?: string },
): GovernedReviewRefV0 {
  return {
    schemaVersion: 0,
    kind: "review",
    stableId: value.id,
    documentId: value.target.documentId,
    versionId: value.target.versionId,
    reviewId: value.id,
    workspaceId: value.workspaceId,
    summary: value.summary,
  };
}

export function toGovernedApprovalRefV0(
  value: Pick<ApprovalRequestV0, "id" | "workspaceId"> & { target: { documentId: string; versionId: string }; summary?: string },
): GovernedApprovalRefV0 {
  return {
    schemaVersion: 0,
    kind: "approval",
    stableId: value.id,
    documentId: value.target.documentId,
    versionId: value.target.versionId,
    approvalId: value.id,
    workspaceId: value.workspaceId,
    summary: value.summary,
  };
}

export function toGovernedPublishPackageRefV0(
  value: Pick<PublishPackageRecordV0, "id" | "documentId" | "versionId"> & { workspaceId?: string; summary?: string },
): GovernedPublishPackageRefV0 {
  return {
    schemaVersion: 0,
    kind: "publish_package",
    stableId: value.id,
    packageId: value.id,
    workspaceId: value.workspaceId,
    documentId: value.documentId,
    versionId: value.versionId,
    summary: value.summary,
  };
}

export function toGovernedSealedEvidenceRefV0(
  value: Pick<SealedEvidenceRefV0, "id" | "runId" | "packetId"> & { workspaceId?: string; summary?: string },
): GovernedSealedEvidenceRefV0 {
  return {
    schemaVersion: 0,
    kind: "sealed_evidence",
    stableId: value.id,
    evidenceId: value.id,
    runId: value.runId,
    packetId: value.packetId,
    workspaceId: value.workspaceId,
    summary: value.summary,
  };
}

export function toComplianceGovernedObjectRefV0(value: GovernedObjectRefV0): GovernedObjectRefV0 {
  switch (value.kind) {
    case "document":
      return toGovernedDocumentRefV0(value);
    case "version":
      return toGovernedVersionRefV0(value);
    case "review": {
      return {
        schemaVersion: 0,
        kind: "review",
        stableId: value.stableId,
        documentId: value.documentId,
        versionId: value.versionId,
        reviewId: value.reviewId,
        workspaceId: value.workspaceId,
        summary: value.summary,
      };
    }
    case "approval": {
      return {
        schemaVersion: 0,
        kind: "approval",
        stableId: value.stableId,
        documentId: value.documentId,
        versionId: value.versionId,
        approvalId: value.approvalId,
        workspaceId: value.workspaceId,
        summary: value.summary,
      };
    }
    case "publish_package":
      return toGovernedPublishPackageRefV0({
        id: value.packageId,
        workspaceId: value.workspaceId,
        documentId: value.documentId,
        versionId: value.versionId,
        summary: value.summary,
      });
    case "sealed_evidence":
      return toGovernedSealedEvidenceRefV0({
        id: value.evidenceId,
        runId: value.runId,
        packetId: value.packetId,
        workspaceId: value.workspaceId,
        summary: value.summary,
      });
  }
}

export function toComplianceEvidenceV0(value: ComplianceEvidenceV0): ComplianceEvidenceV0 {
  return {
    schema: "pluto.compliance.evidence",
    schemaVersion: 0,
    id: value.id,
    workspaceId: value.workspaceId,
    subjectRef: toComplianceGovernedObjectRefV0(value.subjectRef),
    supportingRefs: value.supportingRefs.map(toComplianceGovernedObjectRefV0),
    evidenceRefs: [...value.evidenceRefs],
    summary: value.summary,
    validationOutcome: value.validationOutcome,
    recordedById: value.recordedById,
    recordedAt: value.recordedAt,
  };
}

export function validateRetentionPolicyV0(value: unknown): GovernanceRecordValidationResult<RetentionPolicyV0> {
  const base = validateBaseComplianceRecord(value, "pluto.compliance.retention-policy");
  if (!base.ok) return base;

  const record = base.value;
  const errors: string[] = [];
  validateComplianceStatus(record["status"], "status", errors);
  validateStringField(record, "retentionClass", errors);
  validateGovernedObjectRefArray(record["governedRefs"], "governedRefs", errors);
  validateStringField(record, "assignedById", errors);
  validateStringField(record, "effectiveAt", errors);
  validateNullableStringField(record, "retainUntil", errors);
  validateStringField(record, "summary", errors);

  return errors.length === 0
    ? { ok: true, value: record as unknown as RetentionPolicyV0 }
    : { ok: false, errors };
}

export function validateLegalHoldV0(value: unknown): GovernanceRecordValidationResult<LegalHoldV0> {
  const base = validateBaseComplianceRecord(value, "pluto.compliance.legal-hold");
  if (!base.ok) return base;

  const record = base.value;
  const errors: string[] = [];
  validateComplianceStatus(record["status"], "status", errors);
  validateGovernedObjectRefArray(record["governedRefs"], "governedRefs", errors);
  validateStringField(record, "placedById", errors);
  validateStringField(record, "placedAt", errors);
  validateNullableStringField(record, "releasedAt", errors);
  validateNullableStringField(record, "releaseReviewRef", errors);
  validateNullableStringField(record, "releaseApprovalRef", errors);
  validateStringField(record, "reason", errors);
  validateStringField(record, "summary", errors);

  return errors.length === 0
    ? { ok: true, value: record as unknown as LegalHoldV0 }
    : { ok: false, errors };
}

export function validateDeletionAttemptV0(value: unknown): GovernanceRecordValidationResult<DeletionAttemptV0> {
  const base = validateBaseComplianceRecord(value, "pluto.compliance.deletion-attempt");
  if (!base.ok) return base;

  const record = base.value;
  const errors: string[] = [];
  validateGovernedObjectRef(record["targetRef"], "targetRef", errors);
  validateStringField(record, "requestedById", errors);
  validateStringField(record, "requestedAt", errors);
  validateStringField(record, "mode", errors);
  validateComplianceStatus(record["outcome"], "outcome", errors);
  validateNullableStringField(record, "blockReason", errors);
  validateStringArrayField(record, "evidenceRefs", errors);
  validateStringField(record, "summary", errors);
  validateStringField(record, "recordedAt", errors);

  return errors.length === 0
    ? { ok: true, value: record as unknown as DeletionAttemptV0 }
    : { ok: false, errors };
}

export function validateComplianceEvidenceV0(value: unknown): GovernanceRecordValidationResult<ComplianceEvidenceV0> {
  const base = validateBaseComplianceRecord(value, "pluto.compliance.evidence");
  if (!base.ok) return base;

  const record = base.value;
  const errors: string[] = [];
  validateGovernedObjectRef(record["subjectRef"], "subjectRef", errors);
  validateGovernedObjectRefArray(record["supportingRefs"], "supportingRefs", errors);
  validateStringArrayField(record, "evidenceRefs", errors);
  validateStringField(record, "summary", errors);
  validateStringField(record, "validationOutcome", errors);
  validateStringField(record, "recordedById", errors);
  validateStringField(record, "recordedAt", errors);

  return errors.length === 0
    ? { ok: true, value: record as unknown as ComplianceEvidenceV0 }
    : { ok: false, errors };
}

export function validateAuditExportManifestV0(value: unknown): GovernanceRecordValidationResult<AuditExportManifestV0> {
  const base = validateBaseComplianceRecord(value, "pluto.compliance.audit-export-manifest");
  if (!base.ok) return base;

  const record = base.value;
  const errors: string[] = [];
  validateComplianceStatus(record["status"], "status", errors);
  validateGovernedObjectRefArray(record["governedChain"], "governedChain", errors);
  validateStringArrayField(record, "evidenceRefs", errors);
  validateStringArrayField(record, "complianceEventRefs", errors);
  validateStringField(record, "createdById", errors);
  validateStringField(record, "createdAt", errors);
  validateSummaryObject(record["retentionSummary"], "retentionSummary", errors, ["policyIds"], ["summary"]);
  validateSummaryObject(record["holdSummary"], "holdSummary", errors, ["holdIds"], ["summary"]);
  validateSummaryObject(record["checksumSummary"], "checksumSummary", errors, [], ["algorithm", "digest"]);
  validateSummaryObject(record["recipient"], "recipient", errors, [], ["name", "deliveryMethod"], ["destination"]);

  const localSignature = asRecord(record["localSignature"]);
  if (!localSignature) {
    errors.push("localSignature must be an object");
  } else {
    validateComplianceStatus(localSignature["status"], "localSignature.status", errors);
    validateNullableStringField(localSignature, "signedAt", errors);
    validateStringField(localSignature, "sealId", errors);
  }

  return errors.length === 0
    ? { ok: true, value: record as unknown as AuditExportManifestV0 }
    : { ok: false, errors };
}

export function validateComplianceActionEventV0(value: unknown): GovernanceRecordValidationResult<ComplianceActionEventV0> {
  const base = validateBaseComplianceRecord(value, "pluto.compliance.action-event");
  if (!base.ok) return base;

  const record = base.value;
  const errors: string[] = [];
  if (parseComplianceActionV0(record["action"]) === null) {
    errors.push("action must be a string");
  }
  validateComplianceStatus(record["outcome"], "outcome", errors);
  validateStringField(record, "actorId", errors);
  validateGovernedObjectRef(record["subjectRef"], "subjectRef", errors);
  validateNullableStringField(record, "recordId", errors);
  validateStringArrayField(record, "evidenceRefs", errors);
  validateStringField(record, "occurredAt", errors);
  validateStringField(record, "summary", errors);

  return errors.length === 0
    ? { ok: true, value: record as unknown as ComplianceActionEventV0 }
    : { ok: false, errors };
}

export function validateComplianceActionEventRecordV0(
  value: unknown,
): GovernanceRecordValidationResult<ComplianceActionEventV0> {
  return validateComplianceActionEventV0(value);
}

export function evaluateRegulatedPublishDecisionV0(input: RegulatedPublishGateInputV0): RegulatedPublishDecisionV0 {
  const publishPackageRef = toGovernedPublishPackageRefV0(input.publishPackage);
  const evidenceSummaries = input.complianceEvidence
    .filter((record) => hasMatchingSubjectRef(record.subjectRef, publishPackageRef))
    .filter((record) => record.summary.trim().length > 0)
    .map((record) => ({
      evidenceId: record.id,
      summary: record.summary,
      validationOutcome: record.validationOutcome,
    }));

  const allowed = evidenceSummaries.length > 0;
  const status: RegulatedPublishDecisionV0["status"] = allowed ? "allowed" : "blocked";
  const blockedReasons = allowed ? [] : ["missing_compliance_evidence"];

  const event: ComplianceActionEventV0 = {
    schema: "pluto.compliance.action-event",
    schemaVersion: 0,
    id: `${input.id}:event`,
    workspaceId: input.publishPackage.workspaceId,
    action: allowed ? "regulated_publish_allowed" : "regulated_publish_blocked",
    outcome: status,
    actorId: input.actorId,
    subjectRef: publishPackageRef,
    recordId: input.id,
    evidenceRefs: evidenceSummaries.map((entry) => entry.evidenceId),
    occurredAt: input.decidedAt,
    summary: input.summary ?? (allowed
      ? "Regulated publish passed with explicit compliance evidence."
      : "Regulated publish blocked until explicit compliance evidence is attached."),
  };

  return {
    schema: "pluto.compliance.regulated-publish-decision",
    schemaVersion: 0,
    id: input.id,
    workspaceId: input.publishPackage.workspaceId,
    publishPackageRef,
    status,
    blockedReasons,
    evidenceSummaries,
    decidedById: input.actorId,
    decidedAt: input.decidedAt,
    event,
  };
}

export function evaluateRegulatedPublishGateV0(input: RegulatedPublishGateInputV0): RegulatedPublishGateResultV0 {
  return evaluateRegulatedPublishDecisionV0(input);
}

export function validateRegulatedPublishGateResultV0(
  value: unknown,
): GovernanceRecordValidationResult<RegulatedPublishGateResultV0> {
  const record = asRecord(value);
  if (!record) {
    return { ok: false, errors: ["regulated publish gate result must be an object"] };
  }

  const errors: string[] = [];
  validateSchema(record, "pluto.compliance.regulated-publish-decision", errors);
  validateStringField(record, "id", errors);
  validateStringField(record, "workspaceId", errors);
  validateGovernedObjectRef(record["publishPackageRef"], "publishPackageRef", errors);

  const status = record["status"];
  if (status !== "allowed" && status !== "blocked") {
    errors.push("status must be allowed or blocked");
  }

  validateStringArrayField(record, "blockedReasons", errors);

  if (!Array.isArray(record["evidenceSummaries"])) {
    errors.push("evidenceSummaries must be an array");
  }

  validateStringField(record, "decidedById", errors);
  validateStringField(record, "decidedAt", errors);

  const eventResult = validateComplianceActionEventV0(record["event"]);
  if (!eventResult.ok) {
    errors.push(...eventResult.errors.map((message) => `event.${message}`));
  }

  return errors.length === 0
    ? { ok: true, value: record as unknown as RegulatedPublishGateResultV0 }
    : { ok: false, errors };
}

function hasMatchingSubjectRef(subjectRef: GovernedObjectRefV0, publishPackageRef: GovernedPublishPackageRefV0): boolean {
  switch (subjectRef.kind) {
    case "publish_package":
      return subjectRef.packageId === publishPackageRef.packageId;
    case "version":
      return subjectRef.versionId === publishPackageRef.versionId;
    case "document":
      return subjectRef.documentId === publishPackageRef.documentId;
    default:
      return false;
  }
}