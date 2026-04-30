import type { GovernanceRecordValidationResult } from "./governance.js";

export const RELEASE_CANDIDATE_STATUSES_V0 = [
  "draft",
  "candidate",
  "ready",
  "blocked",
  "released",
  "archived",
] as const;

export const QA_GATE_KINDS_V0 = [
  "test",
  "eval",
  "manual_check",
  "artifact_check",
] as const;

export const QA_GATE_OUTCOMES_V0 = [
  "pass",
  "fail",
  "pending",
  "waived",
] as const;

export const WAIVER_STATUSES_V0 = [
  "draft",
  "approved",
  "expired",
  "revoked",
] as const;

export const RELEASE_READINESS_STATUSES_V0 = [
  "pending",
  "ready",
  "blocked",
] as const;

export type ReleaseCandidateStatusV0 = typeof RELEASE_CANDIDATE_STATUSES_V0[number];
export type ReleaseCandidateStatusLikeV0 = ReleaseCandidateStatusV0 | (string & {});
export type QAGateKindV0 = typeof QA_GATE_KINDS_V0[number];
export type QAGateKindLikeV0 = QAGateKindV0 | (string & {});
export type QAGateOutcomeV0 = typeof QA_GATE_OUTCOMES_V0[number];
export type QAGateOutcomeLikeV0 = QAGateOutcomeV0 | (string & {});
export type WaiverStatusV0 = typeof WAIVER_STATUSES_V0[number];
export type WaiverStatusLikeV0 = WaiverStatusV0 | (string & {});
export type ReleaseReadinessStatusV0 = typeof RELEASE_READINESS_STATUSES_V0[number];
export type ReleaseReadinessStatusLikeV0 = ReleaseReadinessStatusV0 | (string & {});

export interface ReleaseCandidateScopeV0 {
  targetKind: string;
  targetId: string;
  summary: string;
}

export interface ReleaseCandidateRecordV0 {
  schema: "pluto.release.candidate";
  schemaVersion: 0;
  id: string;
  workspaceId: string;
  documentId: string;
  versionId: string;
  packageId: string;
  targetScope: ReleaseCandidateScopeV0;
  candidateEvidenceRefs: string[];
  createdById: string;
  status: ReleaseCandidateStatusLikeV0;
  createdAt: string;
  updatedAt: string;
}

export interface QAGateRecordV0 {
  schema: "pluto.release.qa-gate";
  schemaVersion: 0;
  id: string;
  candidateId: string;
  gateKind: QAGateKindLikeV0;
  label: string;
  mandatory: boolean;
  expectedEvidenceRefs: string[];
  observedEvidenceRefs: string[];
  observedOutcome: QAGateOutcomeLikeV0;
  failureSummary: string | null;
  evalRubricRefId: string | null;
  checkedAt: string | null;
}

export interface EvalRubricRefV0 {
  schema: "pluto.release.eval-rubric-ref";
  schemaVersion: 0;
  id: string;
  candidateId: string;
  gateId: string;
  rubricId: string;
  rubricVersion: string;
  expectedPassCondition: string;
  summaryRef: string | null;
}

export interface EvalRubricSummaryV0 {
  schema: "pluto.release.eval-rubric-summary";
  schemaVersion: 0;
  id: string;
  rubricRefId: string;
  candidateId: string;
  gateId: string;
  outcome: QAGateOutcomeLikeV0;
  summaryRef: string | null;
  evidenceRefs: string[];
  evaluatedAt: string | null;
}

export interface WaiverScopeV0 {
  candidateId: string;
  gateIds: string[];
}

export interface WaiverRecordV0 {
  schema: "pluto.release.waiver";
  schemaVersion: 0;
  id: string;
  candidateId: string;
  approverId: string;
  justification: string;
  scope: WaiverScopeV0;
  approvalEvidenceRefs: string[];
  decisionEvidenceRefs: string[];
  status: WaiverStatusLikeV0;
  expiresAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ReleaseGateResultV0 {
  gateId: string;
  gateKind: QAGateKindLikeV0;
  label: string;
  mandatory: boolean;
  observedOutcome: QAGateOutcomeLikeV0;
  effectiveOutcome: QAGateOutcomeLikeV0;
  waivedBy: string | null;
  expectedEvidenceRefs: string[];
  observedEvidenceRefs: string[];
  evalRubricRefId: string | null;
  blockedReasons: string[];
}

export interface ReleaseReadinessReportV0 {
  schema: "pluto.release.readiness-report";
  schemaVersion: 0;
  id: string;
  candidateId: string;
  workspaceId: string;
  documentId: string;
  versionId: string;
  packageId: string;
  status: ReleaseReadinessStatusLikeV0;
  blockedReasons: string[];
  generatedAt: string;
  gateResults: ReleaseGateResultV0[];
  waiverIds: string[];
  testEvidenceRefs: string[];
  evalEvidenceRefs: string[];
  manualCheckEvidenceRefs: string[];
  artifactCheckEvidenceRefs: string[];
  evalRubricRefs: EvalRubricRefV0[];
  evalRubricSummaries: EvalRubricSummaryV0[];
}

const RELEASE_CANDIDATE_STATUS_SET = new Set<string>(RELEASE_CANDIDATE_STATUSES_V0);
const QA_GATE_KIND_SET = new Set<string>(QA_GATE_KINDS_V0);
const QA_GATE_OUTCOME_SET = new Set<string>(QA_GATE_OUTCOMES_V0);
const WAIVER_STATUS_SET = new Set<string>(WAIVER_STATUSES_V0);
const RELEASE_READINESS_STATUS_SET = new Set<string>(RELEASE_READINESS_STATUSES_V0);

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

function validateBooleanField(record: Record<string, unknown>, field: string, errors: string[]): void {
  if (!hasOwnProperty(record, field)) {
    errors.push(`missing required field: ${field}`);
    return;
  }

  if (typeof record[field] !== "boolean") {
    errors.push(`${field} must be a boolean`);
  }
}

function validateStringArray(value: unknown, field: string, errors: string[]): void {
  if (!Array.isArray(value) || value.some((entry) => typeof entry !== "string")) {
    errors.push(`${field} must be an array of strings`);
  }
}

function uniqueStrings(values: readonly string[]): string[] {
  return [...new Set(values)];
}

function validateReleaseCandidateScopeV0(
  value: unknown,
): GovernanceRecordValidationResult<ReleaseCandidateScopeV0> {
  const record = asRecord(value);
  if (!record) {
    return { ok: false, errors: ["targetScope must be an object"] };
  }

  const errors: string[] = [];
  validateStringField(record, "targetKind", errors);
  validateStringField(record, "targetId", errors);
  validateStringField(record, "summary", errors);

  return errors.length === 0
    ? { ok: true, value: record as unknown as ReleaseCandidateScopeV0 }
    : { ok: false, errors };
}

function validateWaiverScopeV0(value: unknown): GovernanceRecordValidationResult<WaiverScopeV0> {
  const record = asRecord(value);
  if (!record) {
    return { ok: false, errors: ["scope must be an object"] };
  }

  const errors: string[] = [];
  validateStringField(record, "candidateId", errors);
  validateStringArray(record["gateIds"], "scope.gateIds", errors);

  return errors.length === 0
    ? { ok: true, value: record as unknown as WaiverScopeV0 }
    : { ok: false, errors };
}

function validateReleaseGateResultV0(
  value: unknown,
): GovernanceRecordValidationResult<ReleaseGateResultV0> {
  const record = asRecord(value);
  if (!record) {
    return { ok: false, errors: ["gateResults entry must be an object"] };
  }

  const errors: string[] = [];
  validateStringField(record, "gateId", errors);
  validateStringField(record, "gateKind", errors);
  validateStringField(record, "label", errors);
  validateBooleanField(record, "mandatory", errors);
  validateStringField(record, "observedOutcome", errors);
  validateStringField(record, "effectiveOutcome", errors);
  validateNullableStringField(record, "waivedBy", errors);
  validateStringArray(record["expectedEvidenceRefs"], "expectedEvidenceRefs", errors);
  validateStringArray(record["observedEvidenceRefs"], "observedEvidenceRefs", errors);
  validateNullableStringField(record, "evalRubricRefId", errors);
  validateStringArray(record["blockedReasons"], "blockedReasons", errors);

  return errors.length === 0
    ? { ok: true, value: record as unknown as ReleaseGateResultV0 }
    : { ok: false, errors };
}

export function parseQAGateKindV0(value: unknown): QAGateKindLikeV0 | null {
  if (typeof value !== "string") return null;
  return QA_GATE_KIND_SET.has(value) ? value as QAGateKindV0 : value;
}

export function parseQAGateOutcomeV0(value: unknown): QAGateOutcomeLikeV0 | null {
  if (typeof value !== "string") return null;
  return QA_GATE_OUTCOME_SET.has(value) ? value as QAGateOutcomeV0 : value;
}

export function parseWaiverStatusV0(value: unknown): WaiverStatusLikeV0 | null {
  if (typeof value !== "string") return null;
  return WAIVER_STATUS_SET.has(value) ? value as WaiverStatusV0 : value;
}

export function parseReleaseCandidateStatusV0(value: unknown): ReleaseCandidateStatusLikeV0 | null {
  if (typeof value !== "string") return null;
  return RELEASE_CANDIDATE_STATUS_SET.has(value) ? value as ReleaseCandidateStatusV0 : value;
}

export function toReleaseCandidateRecordV0(value: ReleaseCandidateRecordV0 & Record<string, unknown>): ReleaseCandidateRecordV0 {
  return {
    schema: "pluto.release.candidate",
    schemaVersion: 0,
    id: value.id,
    workspaceId: value.workspaceId,
    documentId: value.documentId,
    versionId: value.versionId,
    packageId: value.packageId,
    targetScope: {
      targetKind: value.targetScope.targetKind,
      targetId: value.targetScope.targetId,
      summary: value.targetScope.summary,
    },
    candidateEvidenceRefs: uniqueStrings(value.candidateEvidenceRefs),
    createdById: value.createdById,
    status: parseReleaseCandidateStatusV0(value.status) ?? "draft",
    createdAt: value.createdAt,
    updatedAt: value.updatedAt,
  };
}

export function toQAGateRecordV0(value: QAGateRecordV0 & Record<string, unknown>): QAGateRecordV0 {
  return {
    schema: "pluto.release.qa-gate",
    schemaVersion: 0,
    id: value.id,
    candidateId: value.candidateId,
    gateKind: parseQAGateKindV0(value.gateKind) ?? "manual_check",
    label: value.label,
    mandatory: value.mandatory,
    expectedEvidenceRefs: uniqueStrings(value.expectedEvidenceRefs),
    observedEvidenceRefs: uniqueStrings(value.observedEvidenceRefs),
    observedOutcome: parseQAGateOutcomeV0(value.observedOutcome) ?? "pending",
    failureSummary: value.failureSummary,
    evalRubricRefId: value.evalRubricRefId,
    checkedAt: value.checkedAt,
  };
}

export function toEvalRubricRefV0(value: EvalRubricRefV0 & Record<string, unknown>): EvalRubricRefV0 {
  return {
    schema: "pluto.release.eval-rubric-ref",
    schemaVersion: 0,
    id: value.id,
    candidateId: value.candidateId,
    gateId: value.gateId,
    rubricId: value.rubricId,
    rubricVersion: value.rubricVersion,
    expectedPassCondition: value.expectedPassCondition,
    summaryRef: value.summaryRef,
  };
}

export function toEvalRubricSummaryV0(value: EvalRubricSummaryV0 & Record<string, unknown>): EvalRubricSummaryV0 {
  return {
    schema: "pluto.release.eval-rubric-summary",
    schemaVersion: 0,
    id: value.id,
    rubricRefId: value.rubricRefId,
    candidateId: value.candidateId,
    gateId: value.gateId,
    outcome: parseQAGateOutcomeV0(value.outcome) ?? "pending",
    summaryRef: value.summaryRef,
    evidenceRefs: uniqueStrings(value.evidenceRefs),
    evaluatedAt: value.evaluatedAt,
  };
}

export function toWaiverRecordV0(value: WaiverRecordV0 & Record<string, unknown>): WaiverRecordV0 {
  return {
    schema: "pluto.release.waiver",
    schemaVersion: 0,
    id: value.id,
    candidateId: value.candidateId,
    approverId: value.approverId,
    justification: value.justification,
    scope: {
      candidateId: value.scope.candidateId,
      gateIds: uniqueStrings(value.scope.gateIds),
    },
    approvalEvidenceRefs: uniqueStrings(value.approvalEvidenceRefs),
    decisionEvidenceRefs: uniqueStrings(value.decisionEvidenceRefs),
    status: parseWaiverStatusV0(value.status) ?? "draft",
    expiresAt: value.expiresAt,
    createdAt: value.createdAt,
    updatedAt: value.updatedAt,
  };
}

export function toReleaseReadinessReportV0(
  value: ReleaseReadinessReportV0 & Record<string, unknown>,
): ReleaseReadinessReportV0 {
  return {
    schema: "pluto.release.readiness-report",
    schemaVersion: 0,
    id: value.id,
    candidateId: value.candidateId,
    workspaceId: value.workspaceId,
    documentId: value.documentId,
    versionId: value.versionId,
    packageId: value.packageId,
    status: RELEASE_READINESS_STATUS_SET.has(value.status) ? value.status : "pending",
    blockedReasons: uniqueStrings(value.blockedReasons),
    generatedAt: value.generatedAt,
    gateResults: value.gateResults.map((entry) => ({
      gateId: entry.gateId,
      gateKind: entry.gateKind,
      label: entry.label,
      mandatory: entry.mandatory,
      observedOutcome: entry.observedOutcome,
      effectiveOutcome: entry.effectiveOutcome,
      waivedBy: entry.waivedBy,
      expectedEvidenceRefs: uniqueStrings(entry.expectedEvidenceRefs),
      observedEvidenceRefs: uniqueStrings(entry.observedEvidenceRefs),
      evalRubricRefId: entry.evalRubricRefId,
      blockedReasons: uniqueStrings(entry.blockedReasons),
    })),
    waiverIds: uniqueStrings(value.waiverIds),
    testEvidenceRefs: uniqueStrings(value.testEvidenceRefs),
    evalEvidenceRefs: uniqueStrings(value.evalEvidenceRefs),
    manualCheckEvidenceRefs: uniqueStrings(value.manualCheckEvidenceRefs),
    artifactCheckEvidenceRefs: uniqueStrings(value.artifactCheckEvidenceRefs),
    evalRubricRefs: value.evalRubricRefs.map((entry) => toEvalRubricRefV0(entry as EvalRubricRefV0 & Record<string, unknown>)),
    evalRubricSummaries: value.evalRubricSummaries.map((entry) => toEvalRubricSummaryV0(entry as EvalRubricSummaryV0 & Record<string, unknown>)),
  };
}

export function validateReleaseCandidateRecordV0(
  value: unknown,
): GovernanceRecordValidationResult<ReleaseCandidateRecordV0> {
  const record = asRecord(value);
  if (!record) {
    return { ok: false, errors: ["record must be an object"] };
  }

  const errors: string[] = [];
  if (record["schema"] !== "pluto.release.candidate") errors.push("schema must be pluto.release.candidate");
  if (record["schemaVersion"] !== 0) errors.push("schemaVersion must be 0");
  validateStringField(record, "id", errors);
  validateStringField(record, "workspaceId", errors);
  validateStringField(record, "documentId", errors);
  validateStringField(record, "versionId", errors);
  validateStringField(record, "packageId", errors);
  validateStringField(record, "createdById", errors);
  validateStringField(record, "status", errors);
  validateStringField(record, "createdAt", errors);
  validateStringField(record, "updatedAt", errors);
  validateStringArray(record["candidateEvidenceRefs"], "candidateEvidenceRefs", errors);

  const scopeResult = validateReleaseCandidateScopeV0(record["targetScope"]);
  if (!scopeResult.ok) {
    errors.push(...scopeResult.errors);
  }

  return errors.length === 0
    ? { ok: true, value: record as unknown as ReleaseCandidateRecordV0 }
    : { ok: false, errors };
}

export function validateQAGateRecordV0(value: unknown): GovernanceRecordValidationResult<QAGateRecordV0> {
  const record = asRecord(value);
  if (!record) {
    return { ok: false, errors: ["record must be an object"] };
  }

  const errors: string[] = [];
  if (record["schema"] !== "pluto.release.qa-gate") errors.push("schema must be pluto.release.qa-gate");
  if (record["schemaVersion"] !== 0) errors.push("schemaVersion must be 0");
  validateStringField(record, "id", errors);
  validateStringField(record, "candidateId", errors);
  validateStringField(record, "gateKind", errors);
  validateStringField(record, "label", errors);
  validateBooleanField(record, "mandatory", errors);
  validateStringField(record, "observedOutcome", errors);
  validateNullableStringField(record, "failureSummary", errors);
  validateNullableStringField(record, "evalRubricRefId", errors);
  validateNullableStringField(record, "checkedAt", errors);
  validateStringArray(record["expectedEvidenceRefs"], "expectedEvidenceRefs", errors);
  validateStringArray(record["observedEvidenceRefs"], "observedEvidenceRefs", errors);

  return errors.length === 0
    ? { ok: true, value: record as unknown as QAGateRecordV0 }
    : { ok: false, errors };
}

export function validateEvalRubricRefV0(value: unknown): GovernanceRecordValidationResult<EvalRubricRefV0> {
  const record = asRecord(value);
  if (!record) {
    return { ok: false, errors: ["record must be an object"] };
  }

  const errors: string[] = [];
  if (record["schema"] !== "pluto.release.eval-rubric-ref") errors.push("schema must be pluto.release.eval-rubric-ref");
  if (record["schemaVersion"] !== 0) errors.push("schemaVersion must be 0");
  validateStringField(record, "id", errors);
  validateStringField(record, "candidateId", errors);
  validateStringField(record, "gateId", errors);
  validateStringField(record, "rubricId", errors);
  validateStringField(record, "rubricVersion", errors);
  validateStringField(record, "expectedPassCondition", errors);
  validateNullableStringField(record, "summaryRef", errors);

  return errors.length === 0
    ? { ok: true, value: record as unknown as EvalRubricRefV0 }
    : { ok: false, errors };
}

export function validateEvalRubricSummaryV0(value: unknown): GovernanceRecordValidationResult<EvalRubricSummaryV0> {
  const record = asRecord(value);
  if (!record) {
    return { ok: false, errors: ["record must be an object"] };
  }

  const errors: string[] = [];
  if (record["schema"] !== "pluto.release.eval-rubric-summary") errors.push("schema must be pluto.release.eval-rubric-summary");
  if (record["schemaVersion"] !== 0) errors.push("schemaVersion must be 0");
  validateStringField(record, "id", errors);
  validateStringField(record, "rubricRefId", errors);
  validateStringField(record, "candidateId", errors);
  validateStringField(record, "gateId", errors);
  validateStringField(record, "outcome", errors);
  validateNullableStringField(record, "summaryRef", errors);
  validateNullableStringField(record, "evaluatedAt", errors);
  validateStringArray(record["evidenceRefs"], "evidenceRefs", errors);

  return errors.length === 0
    ? { ok: true, value: record as unknown as EvalRubricSummaryV0 }
    : { ok: false, errors };
}

export function validateWaiverRecordV0(value: unknown): GovernanceRecordValidationResult<WaiverRecordV0> {
  const record = asRecord(value);
  if (!record) {
    return { ok: false, errors: ["record must be an object"] };
  }

  const errors: string[] = [];
  if (record["schema"] !== "pluto.release.waiver") errors.push("schema must be pluto.release.waiver");
  if (record["schemaVersion"] !== 0) errors.push("schemaVersion must be 0");
  validateStringField(record, "id", errors);
  validateStringField(record, "candidateId", errors);
  validateStringField(record, "approverId", errors);
  validateStringField(record, "justification", errors);
  validateStringField(record, "status", errors);
  validateNullableStringField(record, "expiresAt", errors);
  validateStringField(record, "createdAt", errors);
  validateStringField(record, "updatedAt", errors);
  validateStringArray(record["approvalEvidenceRefs"], "approvalEvidenceRefs", errors);
  validateStringArray(record["decisionEvidenceRefs"], "decisionEvidenceRefs", errors);

  const scopeResult = validateWaiverScopeV0(record["scope"]);
  if (!scopeResult.ok) {
    errors.push(...scopeResult.errors);
  }

  return errors.length === 0
    ? { ok: true, value: record as unknown as WaiverRecordV0 }
    : { ok: false, errors };
}

export function validateReleaseReadinessReportV0(
  value: unknown,
): GovernanceRecordValidationResult<ReleaseReadinessReportV0> {
  const record = asRecord(value);
  if (!record) {
    return { ok: false, errors: ["record must be an object"] };
  }

  const errors: string[] = [];
  if (record["schema"] !== "pluto.release.readiness-report") errors.push("schema must be pluto.release.readiness-report");
  if (record["schemaVersion"] !== 0) errors.push("schemaVersion must be 0");
  validateStringField(record, "id", errors);
  validateStringField(record, "candidateId", errors);
  validateStringField(record, "workspaceId", errors);
  validateStringField(record, "documentId", errors);
  validateStringField(record, "versionId", errors);
  validateStringField(record, "packageId", errors);
  validateStringField(record, "status", errors);
  validateStringField(record, "generatedAt", errors);
  validateStringArray(record["blockedReasons"], "blockedReasons", errors);
  validateStringArray(record["waiverIds"], "waiverIds", errors);
  validateStringArray(record["testEvidenceRefs"], "testEvidenceRefs", errors);
  validateStringArray(record["evalEvidenceRefs"], "evalEvidenceRefs", errors);
  validateStringArray(record["manualCheckEvidenceRefs"], "manualCheckEvidenceRefs", errors);
  validateStringArray(record["artifactCheckEvidenceRefs"], "artifactCheckEvidenceRefs", errors);

  if (!Array.isArray(record["gateResults"])) {
    errors.push("gateResults must be an array");
  } else {
    record["gateResults"].forEach((entry, index) => {
      const result = validateReleaseGateResultV0(entry);
      if (!result.ok) {
        errors.push(...result.errors.map((message) => `gateResults[${index}].${message}`));
      }
    });
  }

  if (!Array.isArray(record["evalRubricRefs"])) {
    errors.push("evalRubricRefs must be an array");
  } else {
    record["evalRubricRefs"].forEach((entry, index) => {
      const result = validateEvalRubricRefV0(entry);
      if (!result.ok) {
        errors.push(...result.errors.map((message) => `evalRubricRefs[${index}].${message}`));
      }
    });
  }

  if (!Array.isArray(record["evalRubricSummaries"])) {
    errors.push("evalRubricSummaries must be an array");
  } else {
    record["evalRubricSummaries"].forEach((entry, index) => {
      const result = validateEvalRubricSummaryV0(entry);
      if (!result.ok) {
        errors.push(...result.errors.map((message) => `evalRubricSummaries[${index}].${message}`));
      }
    });
  }

  return errors.length === 0
    ? { ok: true, value: record as unknown as ReleaseReadinessReportV0 }
    : { ok: false, errors };
}
