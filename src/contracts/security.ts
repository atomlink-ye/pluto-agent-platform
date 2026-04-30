import type { PrincipalRefV0 } from "./identity.js";

export const SECURITY_OBJECT_KINDS_V0 = [
  "secret_ref",
  "scoped_tool_permit",
  "redaction_policy",
  "redaction_result",
  "audit_event",
] as const;

export type SecurityObjectKindV0 = typeof SECURITY_OBJECT_KINDS_V0[number];

export const DATA_SENSITIVITY_CLASSES_V0 = ["public", "internal", "confidential", "restricted", "regulated"] as const;

export type DataSensitivityClassV0 = typeof DATA_SENSITIVITY_CLASSES_V0[number];
export type DataSensitivityClassLikeV0 = DataSensitivityClassV0 | (string & {});

export const SANDBOX_POSTURES_V0 = ["local_v0", "workspace_write", "network_egress", "connector_bridge"] as const;

export type SandboxPostureV0 = typeof SANDBOX_POSTURES_V0[number];
export type SandboxPostureLikeV0 = SandboxPostureV0 | (string & {});

export const TRUST_BOUNDARIES_V0 = ["local_workspace", "operator_approved", "external_service", "human_reviewed"] as const;

export type TrustBoundaryV0 = typeof TRUST_BOUNDARIES_V0[number];
export type TrustBoundaryLikeV0 = TrustBoundaryV0 | (string & {});

export const SECURITY_REASON_CODES_V0 = [
  "operator_approved",
  "policy_required",
  "sensitivity_exceeded",
  "sandbox_required",
  "trust_boundary_required",
  "permit_expired",
  "permit_revoked",
  "target_denied",
  "approval_missing",
  "unknown_enum_fail_closed",
] as const;

export type SecurityReasonCodeV0 = typeof SECURITY_REASON_CODES_V0[number];
export type SecurityReasonCodeLikeV0 = SecurityReasonCodeV0 | (string & {});

export const SCOPED_TOOL_ACTION_FAMILIES_V0 = [
  "filesystem",
  "shell",
  "browser",
  "http",
  "mcp",
  "lark",
  "github",
  "connector",
] as const;

export type ScopedToolActionFamilyV0 = typeof SCOPED_TOOL_ACTION_FAMILIES_V0[number];
export type ScopedToolActionFamilyLikeV0 = ScopedToolActionFamilyV0 | (string & {});

export const REDACTION_OUTCOMES_V0 = ["unchanged", "redacted", "blocked"] as const;

export type RedactionOutcomeV0 = typeof REDACTION_OUTCOMES_V0[number];
export type RedactionOutcomeLikeV0 = RedactionOutcomeV0 | (string & {});

export const AUDIT_EVENT_OUTCOMES_V0 = ["allowed", "denied", "redacted"] as const;

export type AuditEventOutcomeV0 = typeof AUDIT_EVENT_OUTCOMES_V0[number];
export type AuditEventOutcomeLikeV0 = AuditEventOutcomeV0 | (string & {});

export interface SecurityRecordValidationError {
  ok: false;
  errors: string[];
}

export interface SecurityRecordValidationSuccess<T> {
  ok: true;
  value: T;
}

export type SecurityRecordValidationResult<T> =
  | SecurityRecordValidationSuccess<T>
  | SecurityRecordValidationError;

interface SecurityRecordBaseV0<K extends SecurityObjectKindV0> {
  schemaVersion: 0;
  kind: K;
  workspaceId: string;
}

export interface SecretRefV0 extends SecurityRecordBaseV0<"secret_ref"> {
  name: string;
  ref: string;
  displayLabel: string;
  status: string;
  createdAt: string;
  updatedAt: string;
  providerType?: string;
  actorRefs: PrincipalRefV0[];
}

export interface PermitTargetSummaryV0 {
  allow: string[];
  deny: string[];
}

export interface ScopedToolPermitV0 extends SecurityRecordBaseV0<"scoped_tool_permit"> {
  permitId: string;
  actionFamily: ScopedToolActionFamilyLikeV0;
  targetSummary: PermitTargetSummaryV0;
  sensitivityCeiling: DataSensitivityClassLikeV0;
  sandboxPosture: SandboxPostureLikeV0;
  trustBoundary: TrustBoundaryLikeV0;
  grantedAt: string;
  expiresAt: string | null;
  revokedAt?: string | null;
  revocationReason?: SecurityReasonCodeLikeV0 | null;
  approvalRefs: string[];
}

export interface RedactionRuleV0 {
  path: string;
  action: "mask" | "remove" | "hash" | (string & {});
  minSensitivity: DataSensitivityClassLikeV0;
  reasonCode: SecurityReasonCodeLikeV0;
}

export interface RedactionPolicyV0 extends SecurityRecordBaseV0<"redaction_policy"> {
  policyId: string;
  name: string;
  updatedAt: string;
  defaultAction: "mask" | "remove" | "hash" | (string & {});
  rules: RedactionRuleV0[];
}

export interface RedactionResultV0 extends SecurityRecordBaseV0<"redaction_result"> {
  resultId: string;
  policyId: string;
  redactedAt: string;
  sourceSensitivity: DataSensitivityClassLikeV0;
  resultSensitivity: DataSensitivityClassLikeV0;
  outcome: RedactionOutcomeLikeV0;
  redactionCount: number;
  reasonCodes: SecurityReasonCodeLikeV0[];
}

export interface AuditEventV0 extends SecurityRecordBaseV0<"audit_event"> {
  eventId: string;
  occurredAt: string;
  actionFamily: ScopedToolActionFamilyLikeV0;
  action: string;
  target: string;
  permitId: string | null;
  approvalRefs: string[];
  outcome: AuditEventOutcomeLikeV0;
  sensitivity: DataSensitivityClassLikeV0;
  sandboxPosture: SandboxPostureLikeV0;
  trustBoundary: TrustBoundaryLikeV0;
  reasonCodes: SecurityReasonCodeLikeV0[];
}

const DATA_SENSITIVITY_CLASS_SET = new Set<string>(DATA_SENSITIVITY_CLASSES_V0);
const SANDBOX_POSTURE_SET = new Set<string>(SANDBOX_POSTURES_V0);
const TRUST_BOUNDARY_SET = new Set<string>(TRUST_BOUNDARIES_V0);
const SECURITY_REASON_CODE_SET = new Set<string>(SECURITY_REASON_CODES_V0);
const SCOPED_TOOL_ACTION_FAMILY_SET = new Set<string>(SCOPED_TOOL_ACTION_FAMILIES_V0);
const SECRET_REF_FORBIDDEN_FIELDS = new Set([
  "value",
  "secretValue",
  "resolvedValue",
  "plaintext",
  "token",
  "apiKey",
  "secret",
]);
const SECRET_REF_LEGACY_FIELDS = new Set(["secretId", "provider", "alias", "lastRotatedAt", "tags"]);
const DATA_SENSITIVITY_ORDER: Record<DataSensitivityClassV0, number> = {
  public: 0,
  internal: 1,
  confidential: 2,
  restricted: 3,
  regulated: 4,
};

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
  if (!hasOwnProperty(record, field)) {
    errors.push(`missing required field: ${field}`);
    return;
  }

  const value = record[field];
  if (!Array.isArray(value) || value.some((entry) => typeof entry !== "string")) {
    errors.push(`${field} must be an array of strings`);
  }
}

function validateNumberField(record: Record<string, unknown>, field: string, errors: string[]): void {
  if (!hasOwnProperty(record, field)) {
    errors.push(`missing required field: ${field}`);
    return;
  }

  if (typeof record[field] !== "number" || !Number.isFinite(record[field])) {
    errors.push(`${field} must be a finite number`);
  }
}

function validateBaseRecord(
  value: unknown,
  expectedKind: SecurityObjectKindV0,
): SecurityRecordValidationResult<Record<string, unknown>> {
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

  validateStringField(record, "workspaceId", errors);
  return errors.length === 0 ? { ok: true, value: record } : { ok: false, errors };
}

function validateTargetSummary(value: unknown): value is PermitTargetSummaryV0 {
  if (typeof value !== "object" || value === null) return false;
  const summary = value as Record<string, unknown>;
  return Array.isArray(summary["allow"]) && Array.isArray(summary["deny"])
    && (summary["allow"] as unknown[]).every((entry) => typeof entry === "string")
    && (summary["deny"] as unknown[]).every((entry) => typeof entry === "string");
}

function validatePrincipalRefArrayField(record: Record<string, unknown>, field: string, errors: string[]): void {
  if (!hasOwnProperty(record, field)) {
    errors.push(`missing required field: ${field}`);
    return;
  }

  const value = record[field];
  if (!Array.isArray(value)) {
    errors.push(`${field} must be an array of principal refs`);
    return;
  }

  for (const ref of value) {
    if (typeof ref !== "object" || ref === null) {
      errors.push(`${field} must be an array of principal refs`);
      return;
    }

    const principal = ref as Record<string, unknown>;
    if (
      typeof principal["workspaceId"] !== "string"
      || typeof principal["kind"] !== "string"
      || typeof principal["principalId"] !== "string"
    ) {
      errors.push(`${field} must be an array of principal refs`);
      return;
    }
  }
}

function validateRedactionRules(value: unknown): value is RedactionRuleV0[] {
  if (!Array.isArray(value)) return false;
  return value.every((entry) => {
    if (typeof entry !== "object" || entry === null) return false;
    const rule = entry as Record<string, unknown>;
    return typeof rule["path"] === "string"
      && typeof rule["action"] === "string"
      && typeof rule["minSensitivity"] === "string"
      && typeof rule["reasonCode"] === "string";
  });
}

function parseKnownOrString<T extends string>(value: unknown, known: Set<string>): T | (string & {}) | null {
  if (typeof value !== "string") return null;
  if (known.has(value)) return value as T;
  return value;
}

function isKnownString(value: string, known: Set<string>): boolean {
  return known.has(value);
}

function isKnownSensitivity(value: string): value is DataSensitivityClassV0 {
  return isKnownString(value, DATA_SENSITIVITY_CLASS_SET);
}

function isKnownActionFamily(value: string): value is ScopedToolActionFamilyV0 {
  return isKnownString(value, SCOPED_TOOL_ACTION_FAMILY_SET);
}

function isKnownSandboxPosture(value: string): value is SandboxPostureV0 {
  return isKnownString(value, SANDBOX_POSTURE_SET);
}

function isKnownTrustBoundary(value: string): value is TrustBoundaryV0 {
  return isKnownString(value, TRUST_BOUNDARY_SET);
}

function isExpiredAt(value: string | null | undefined, now: number): boolean {
  if (value === undefined || value === null) return false;
  const expiresAt = Date.parse(value);
  if (!Number.isFinite(expiresAt)) return true;
  return expiresAt <= now;
}

function targetMatches(pattern: string, target: string): boolean {
  if (pattern === "*") return true;
  if (pattern.endsWith("*")) {
    return target.startsWith(pattern.slice(0, -1));
  }

  return pattern === target;
}

function targetAllowed(summary: PermitTargetSummaryV0, target: string): boolean {
  if (summary.deny.some((pattern) => targetMatches(pattern, target))) return false;
  if (summary.allow.length === 0) return false;
  return summary.allow.some((pattern) => targetMatches(pattern, target));
}

export function parseDataSensitivityClassV0(value: unknown): DataSensitivityClassLikeV0 | null {
  return parseKnownOrString<DataSensitivityClassV0>(value, DATA_SENSITIVITY_CLASS_SET);
}

export function parseSandboxPostureV0(value: unknown): SandboxPostureLikeV0 | null {
  return parseKnownOrString<SandboxPostureV0>(value, SANDBOX_POSTURE_SET);
}

export function parseTrustBoundaryV0(value: unknown): TrustBoundaryLikeV0 | null {
  return parseKnownOrString<TrustBoundaryV0>(value, TRUST_BOUNDARY_SET);
}

export function parseSecurityReasonCodeV0(value: unknown): SecurityReasonCodeLikeV0 | null {
  return parseKnownOrString<SecurityReasonCodeV0>(value, SECURITY_REASON_CODE_SET);
}

export function parseScopedToolActionFamilyV0(value: unknown): ScopedToolActionFamilyLikeV0 | null {
  return parseKnownOrString<ScopedToolActionFamilyV0>(value, SCOPED_TOOL_ACTION_FAMILY_SET);
}

export function validateSecretRefV0(value: unknown): SecurityRecordValidationResult<SecretRefV0> {
  const base = validateBaseRecord(value, "secret_ref");
  if (!base.ok) return base;

  const record = base.value;
  const errors: string[] = [];
  validateStringField(record, "name", errors);
  validateStringField(record, "ref", errors);
  validateStringField(record, "displayLabel", errors);
  validateStringField(record, "status", errors);
  validateStringField(record, "createdAt", errors);
  validateStringField(record, "updatedAt", errors);
  validatePrincipalRefArrayField(record, "actorRefs", errors);

  if (hasOwnProperty(record, "providerType") && typeof record["providerType"] !== "string") {
    errors.push("providerType must be a string");
  }

  for (const forbiddenField of SECRET_REF_FORBIDDEN_FIELDS) {
    if (hasOwnProperty(record, forbiddenField)) {
      errors.push(`secret refs must not contain ${forbiddenField}`);
    }
  }

  for (const legacyField of SECRET_REF_LEGACY_FIELDS) {
    if (hasOwnProperty(record, legacyField)) {
      errors.push(`secret refs must not contain ${legacyField}`);
    }
  }

  return errors.length === 0
    ? { ok: true, value: record as unknown as SecretRefV0 }
    : { ok: false, errors };
}

export function validateScopedToolPermitV0(value: unknown): SecurityRecordValidationResult<ScopedToolPermitV0> {
  const base = validateBaseRecord(value, "scoped_tool_permit");
  if (!base.ok) return base;

  const record = base.value;
  const errors: string[] = [];
  validateStringField(record, "permitId", errors);
  validateStringField(record, "actionFamily", errors);
  validateStringField(record, "sensitivityCeiling", errors);
  validateStringField(record, "sandboxPosture", errors);
  validateStringField(record, "trustBoundary", errors);
  validateStringField(record, "grantedAt", errors);
  validateNullableStringField(record, "expiresAt", errors);
  validateStringArrayField(record, "approvalRefs", errors);

  if (!hasOwnProperty(record, "targetSummary") || !validateTargetSummary(record["targetSummary"])) {
    errors.push("targetSummary must be an object with allow and deny string arrays");
  }

  if (hasOwnProperty(record, "revokedAt")) {
    const revokedAt = record["revokedAt"];
    if (revokedAt !== null && typeof revokedAt !== "string") {
      errors.push("revokedAt must be a string or null");
    }
  }

  if (hasOwnProperty(record, "revocationReason")) {
    const reason = record["revocationReason"];
    if (reason !== null && typeof reason !== "string") {
      errors.push("revocationReason must be a string or null");
    }
  }

  return errors.length === 0
    ? { ok: true, value: record as unknown as ScopedToolPermitV0 }
    : { ok: false, errors };
}

export function validateRedactionPolicyV0(value: unknown): SecurityRecordValidationResult<RedactionPolicyV0> {
  const base = validateBaseRecord(value, "redaction_policy");
  if (!base.ok) return base;

  const record = base.value;
  const errors: string[] = [];
  validateStringField(record, "policyId", errors);
  validateStringField(record, "name", errors);
  validateStringField(record, "updatedAt", errors);
  validateStringField(record, "defaultAction", errors);
  if (!hasOwnProperty(record, "rules") || !validateRedactionRules(record["rules"])) {
    errors.push("rules must be an array of redaction rule objects");
  }

  return errors.length === 0
    ? { ok: true, value: record as unknown as RedactionPolicyV0 }
    : { ok: false, errors };
}

export function validateRedactionResultV0(value: unknown): SecurityRecordValidationResult<RedactionResultV0> {
  const base = validateBaseRecord(value, "redaction_result");
  if (!base.ok) return base;

  const record = base.value;
  const errors: string[] = [];
  validateStringField(record, "resultId", errors);
  validateStringField(record, "policyId", errors);
  validateStringField(record, "redactedAt", errors);
  validateStringField(record, "sourceSensitivity", errors);
  validateStringField(record, "resultSensitivity", errors);
  validateStringField(record, "outcome", errors);
  validateNumberField(record, "redactionCount", errors);
  validateStringArrayField(record, "reasonCodes", errors);

  return errors.length === 0
    ? { ok: true, value: record as unknown as RedactionResultV0 }
    : { ok: false, errors };
}

export function validateAuditEventV0(value: unknown): SecurityRecordValidationResult<AuditEventV0> {
  const base = validateBaseRecord(value, "audit_event");
  if (!base.ok) return base;

  const record = base.value;
  const errors: string[] = [];
  validateStringField(record, "eventId", errors);
  validateStringField(record, "occurredAt", errors);
  validateStringField(record, "actionFamily", errors);
  validateStringField(record, "action", errors);
  validateStringField(record, "target", errors);
  validateNullableStringField(record, "permitId", errors);
  validateStringArrayField(record, "approvalRefs", errors);
  validateStringField(record, "outcome", errors);
  validateStringField(record, "sensitivity", errors);
  validateStringField(record, "sandboxPosture", errors);
  validateStringField(record, "trustBoundary", errors);
  validateStringArrayField(record, "reasonCodes", errors);

  return errors.length === 0
    ? { ok: true, value: record as unknown as AuditEventV0 }
    : { ok: false, errors };
}

export function isScopedToolPermitActiveV0(
  permit: ScopedToolPermitV0,
  at: string | number | Date = Date.now(),
): boolean {
  const now = typeof at === "string" || at instanceof Date ? Date.parse(String(at)) : at;
  if (!Number.isFinite(now)) return false;
  if (permit.revokedAt !== undefined && permit.revokedAt !== null) return false;
  return !isExpiredAt(permit.expiresAt, now);
}

export function allowsSensitiveDataV0(
  permit: ScopedToolPermitV0,
  requestedSensitivity: unknown,
  sandboxPosture: unknown,
  trustBoundary: unknown,
): boolean {
  if (!isScopedToolPermitActiveV0(permit)) return false;
  if (typeof requestedSensitivity !== "string") return false;
  if (typeof permit.sensitivityCeiling !== "string") return false;
  if (typeof sandboxPosture !== "string" || typeof permit.sandboxPosture !== "string") return false;
  if (typeof trustBoundary !== "string" || typeof permit.trustBoundary !== "string") return false;
  if (!isKnownSensitivity(requestedSensitivity) || !isKnownSensitivity(permit.sensitivityCeiling)) return false;
  if (!isKnownSandboxPosture(sandboxPosture) || !isKnownSandboxPosture(permit.sandboxPosture)) return false;
  if (!isKnownTrustBoundary(trustBoundary) || !isKnownTrustBoundary(permit.trustBoundary)) return false;
  if (sandboxPosture !== permit.sandboxPosture) return false;
  if (trustBoundary !== permit.trustBoundary) return false;
  return DATA_SENSITIVITY_ORDER[requestedSensitivity] <= DATA_SENSITIVITY_ORDER[permit.sensitivityCeiling];
}

export function allowsMutatingActionV0(
  permit: ScopedToolPermitV0,
  actionFamily: unknown,
  target: string,
  requestedSensitivity: unknown,
  sandboxPosture: unknown,
  trustBoundary: unknown,
): boolean {
  if (typeof actionFamily !== "string" || !isKnownActionFamily(actionFamily)) return false;
  if (typeof permit.actionFamily !== "string" || !isKnownActionFamily(permit.actionFamily)) return false;
  if (permit.actionFamily !== actionFamily) return false;
  if (!allowsSensitiveDataV0(permit, requestedSensitivity, sandboxPosture, trustBoundary)) return false;
  return targetAllowed(permit.targetSummary, target);
}
