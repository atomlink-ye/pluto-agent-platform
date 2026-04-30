export const IDENTITY_KINDS_V0 = [
  "org",
  "workspace",
  "project",
  "user",
  "service_account",
  "membership_binding",
  "api_token",
] as const;

export type IdentityKindV0 = typeof IDENTITY_KINDS_V0[number];

export const ROLE_VOCABULARY_V0 = [
  "viewer",
  "editor",
  "reviewer",
  "approver",
  "publisher",
  "admin",
] as const;

export type RoleV0 = typeof ROLE_VOCABULARY_V0[number];
export type RoleLikeV0 = RoleV0 | (string & {});

export const PERMISSION_VOCABULARY_V0 = [
  "workspace.read",
  "workspace.write",
  "governance.review",
  "governance.approve",
  "governance.publish",
  "runs.trigger",
  "membership.manage",
  "token.manage",
  "permit.manage",
  "record.delete",
] as const;

export type PermissionV0 = typeof PERMISSION_VOCABULARY_V0[number];
export type PermissionLikeV0 = PermissionV0 | (string & {});

export type IdentityStatusV0 = "active" | "suspended" | "revoked" | "disabled" | "archived" | (string & {});

export interface WorkspaceScopedRefV0 {
  workspaceId: string;
  kind: string;
  id: string;
}

export interface PrincipalRefV0 {
  workspaceId: string;
  kind: "user" | "service_account" | (string & {});
  principalId: string;
}

interface IdentityRecordBaseV0<K extends IdentityKindV0> {
  schemaVersion: 0;
  kind: K;
  id: string;
  createdAt: string;
  updatedAt: string;
  status: IdentityStatusV0;
}

interface WorkspaceIdentityRecordBaseV0<K extends IdentityKindV0> extends IdentityRecordBaseV0<K> {
  orgId: string;
  workspaceId: string;
}

export interface OrgRecordV0 extends IdentityRecordBaseV0<"org"> {
  slug: string;
  displayName: string;
}

export interface WorkspaceRecordV0 extends IdentityRecordBaseV0<"workspace"> {
  orgId: string;
  slug: string;
  displayName: string;
  ownerRef: PrincipalRefV0;
  suspendedAt?: string | null;
}

export interface ProjectRecordV0 extends WorkspaceIdentityRecordBaseV0<"project"> {
  projectKey: string;
  displayName: string;
  groupingOnly: true;
}

export interface UserRecordV0 extends IdentityRecordBaseV0<"user"> {
  orgId: string;
  displayName: string;
  primaryWorkspaceRef: WorkspaceScopedRefV0;
}

export interface ServiceAccountRecordV0 extends WorkspaceIdentityRecordBaseV0<"service_account"> {
  displayName: string;
  ownerRef: PrincipalRefV0;
  revokedAt?: string | null;
}

export interface MembershipBindingV0 extends WorkspaceIdentityRecordBaseV0<"membership_binding"> {
  principal: PrincipalRefV0;
  role: RoleLikeV0;
  permissions: PermissionLikeV0[];
  expiresAt?: string | null;
  revokedAt?: string | null;
}

export interface ApiTokenVerificationMetadataV0 {
  hashAlgorithm: string;
  verificationState: "verified" | "unverified" | "revoked" | "expired" | (string & {});
  verifiedAt?: string | null;
  lastUsedAt?: string | null;
}

export interface ApiTokenRecordV0 extends WorkspaceIdentityRecordBaseV0<"api_token"> {
  principal: PrincipalRefV0;
  actorRef: PrincipalRefV0;
  label: string;
  tokenPrefix: string;
  tokenHash: string;
  verification: ApiTokenVerificationMetadataV0;
  allowedActions: PermissionLikeV0[];
  expiresAt?: string | null;
  rotatedAt?: string | null;
  revokedAt?: string | null;
  replacedByTokenId?: string | null;
}

export type IdentityRecordV0 =
  | OrgRecordV0
  | WorkspaceRecordV0
  | ProjectRecordV0
  | UserRecordV0
  | ServiceAccountRecordV0
  | MembershipBindingV0
  | ApiTokenRecordV0;

export interface IdentityRecordValidationError {
  ok: false;
  errors: string[];
}

export interface IdentityRecordValidationSuccess<T> {
  ok: true;
  value: T;
}

export type IdentityRecordValidationResult<T> =
  | IdentityRecordValidationError
  | IdentityRecordValidationSuccess<T>;

const ROLE_SET = new Set<string>(ROLE_VOCABULARY_V0);
const PERMISSION_SET = new Set<string>(PERMISSION_VOCABULARY_V0);

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

function validateWorkspaceScopedRefV0Value(value: unknown, field: string, errors: string[]): void {
  if (typeof value !== "object" || value === null) {
    errors.push(`${field} must be an object`);
    return;
  }

  const ref = value as Record<string, unknown>;
  validateStringField(ref, "workspaceId", errors);
  validateStringField(ref, "kind", errors);
  validateStringField(ref, "id", errors);
}

function validatePrincipalRefV0Value(value: unknown, field: string, errors: string[]): void {
  if (typeof value !== "object" || value === null) {
    errors.push(`${field} must be an object`);
    return;
  }

  const ref = value as Record<string, unknown>;
  validateStringField(ref, "workspaceId", errors);
  validateStringField(ref, "kind", errors);
  validateStringField(ref, "principalId", errors);
}

function validateBaseRecord(
  value: unknown,
  expectedKind: IdentityKindV0,
  extraStringFields: readonly string[],
): IdentityRecordValidationResult<Record<string, unknown>> {
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
  validateStringField(record, "createdAt", errors);
  validateStringField(record, "updatedAt", errors);
  validateStringField(record, "status", errors);

  for (const field of extraStringFields) {
    validateStringField(record, field, errors);
  }

  return errors.length === 0 ? { ok: true, value: record } : { ok: false, errors };
}

function validateWorkspaceBaseRecord(
  value: unknown,
  expectedKind: IdentityKindV0,
  extraStringFields: readonly string[],
): IdentityRecordValidationResult<Record<string, unknown>> {
  return validateBaseRecord(value, expectedKind, ["orgId", "workspaceId", ...extraStringFields]);
}

export function parseRoleV0(value: unknown): RoleLikeV0 | null {
  if (typeof value !== "string") return null;
  if (ROLE_SET.has(value)) {
    return value as RoleV0;
  }

  return value;
}

export function parsePermissionV0(value: unknown): PermissionLikeV0 | null {
  if (typeof value !== "string") return null;
  if (PERMISSION_SET.has(value)) {
    return value as PermissionV0;
  }

  return value;
}

export function workspaceScopeAllowsV0(workspaceId: string, ref: WorkspaceScopedRefV0): boolean {
  return ref.workspaceId === workspaceId;
}

export function validateOrgRecordV0(value: unknown): IdentityRecordValidationResult<OrgRecordV0> {
  const result = validateBaseRecord(value, "org", ["slug", "displayName"]);
  return result.ok ? { ok: true, value: result.value as unknown as OrgRecordV0 } : result;
}

export function validateWorkspaceRecordV0(value: unknown): IdentityRecordValidationResult<WorkspaceRecordV0> {
  const result = validateBaseRecord(value, "workspace", ["orgId", "slug", "displayName"]);
  if (!result.ok) return result;

  const errors: string[] = [];
  validatePrincipalRefV0Value(result.value["ownerRef"], "ownerRef", errors);
  if (hasOwnProperty(result.value, "suspendedAt")) {
    validateNullableStringField(result.value, "suspendedAt", errors);
  }

  return errors.length === 0 ? { ok: true, value: result.value as unknown as WorkspaceRecordV0 } : { ok: false, errors };
}

export function validateProjectRecordV0(value: unknown): IdentityRecordValidationResult<ProjectRecordV0> {
  const result = validateWorkspaceBaseRecord(value, "project", ["projectKey", "displayName"]);
  if (!result.ok) return result;

  if (result.value["groupingOnly"] !== true) {
    return { ok: false, errors: ["groupingOnly must be true"] };
  }

  return { ok: true, value: result.value as unknown as ProjectRecordV0 };
}

export function validateUserRecordV0(value: unknown): IdentityRecordValidationResult<UserRecordV0> {
  const result = validateBaseRecord(value, "user", ["orgId", "displayName"]);
  if (!result.ok) return result;

  const errors: string[] = [];
  validateWorkspaceScopedRefV0Value(result.value["primaryWorkspaceRef"], "primaryWorkspaceRef", errors);
  return errors.length === 0 ? { ok: true, value: result.value as unknown as UserRecordV0 } : { ok: false, errors };
}

export function validateServiceAccountRecordV0(value: unknown): IdentityRecordValidationResult<ServiceAccountRecordV0> {
  const result = validateWorkspaceBaseRecord(value, "service_account", ["displayName"]);
  if (!result.ok) return result;

  const errors: string[] = [];
  validatePrincipalRefV0Value(result.value["ownerRef"], "ownerRef", errors);
  if (hasOwnProperty(result.value, "revokedAt")) {
    validateNullableStringField(result.value, "revokedAt", errors);
  }

  return errors.length === 0 ? { ok: true, value: result.value as unknown as ServiceAccountRecordV0 } : { ok: false, errors };
}

export function validateMembershipBindingV0(value: unknown): IdentityRecordValidationResult<MembershipBindingV0> {
  const result = validateWorkspaceBaseRecord(value, "membership_binding", ["role"]);
  if (!result.ok) return result;

  const errors: string[] = [];
  validatePrincipalRefV0Value(result.value["principal"], "principal", errors);
  validateStringArrayField(result.value, "permissions", errors);
  if (hasOwnProperty(result.value, "expiresAt")) {
    validateNullableStringField(result.value, "expiresAt", errors);
  }
  if (hasOwnProperty(result.value, "revokedAt")) {
    validateNullableStringField(result.value, "revokedAt", errors);
  }

  return errors.length === 0 ? { ok: true, value: result.value as unknown as MembershipBindingV0 } : { ok: false, errors };
}

export function validateApiTokenRecordV0(value: unknown): IdentityRecordValidationResult<ApiTokenRecordV0> {
  const result = validateWorkspaceBaseRecord(value, "api_token", ["label", "tokenPrefix", "tokenHash"]);
  if (!result.ok) return result;

  const errors: string[] = [];
  validatePrincipalRefV0Value(result.value["principal"], "principal", errors);
  validatePrincipalRefV0Value(result.value["actorRef"], "actorRef", errors);
  validateStringArrayField(result.value, "allowedActions", errors);
  if (hasOwnProperty(result.value, "expiresAt")) {
    validateNullableStringField(result.value, "expiresAt", errors);
  }
  if (hasOwnProperty(result.value, "rotatedAt")) {
    validateNullableStringField(result.value, "rotatedAt", errors);
  }
  if (hasOwnProperty(result.value, "revokedAt")) {
    validateNullableStringField(result.value, "revokedAt", errors);
  }
  if (hasOwnProperty(result.value, "replacedByTokenId")) {
    validateNullableStringField(result.value, "replacedByTokenId", errors);
  }

  if (typeof result.value["verification"] !== "object" || result.value["verification"] === null) {
    errors.push("verification must be an object");
  } else {
    const verification = result.value["verification"] as Record<string, unknown>;
    validateStringField(verification, "hashAlgorithm", errors);
    validateStringField(verification, "verificationState", errors);
    if (hasOwnProperty(verification, "verifiedAt")) {
      validateNullableStringField(verification, "verifiedAt", errors);
    }
    if (hasOwnProperty(verification, "lastUsedAt")) {
      validateNullableStringField(verification, "lastUsedAt", errors);
    }
  }

  if ("token" in result.value || "secret" in result.value || "tokenValue" in result.value || "rawToken" in result.value) {
    errors.push("api token records must not include token secret material");
  }

  return errors.length === 0 ? { ok: true, value: result.value as unknown as ApiTokenRecordV0 } : { ok: false, errors };
}
