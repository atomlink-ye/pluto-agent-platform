import type { PrincipalRefV0, WorkspaceScopedRefV0 } from "../contracts/identity.js";

export const BOOTSTRAP_STATUS_VALUES_V0 = [
  "queued",
  "pending",
  "running",
  "blocked",
  "failed",
  "succeeded",
] as const;

export const BOOTSTRAP_FAILURE_STATUS_VALUES_V0 = ["active", "resolved"] as const;

export type BootstrapStatusV0 = typeof BOOTSTRAP_STATUS_VALUES_V0[number];
export type BootstrapStatusLikeV0 = BootstrapStatusV0 | "done" | (string & {});
export type BootstrapFailureStatusV0 = typeof BOOTSTRAP_FAILURE_STATUS_VALUES_V0[number];
export type BootstrapFailureStatusLikeV0 = BootstrapFailureStatusV0 | (string & {});

export interface BootstrapObjectRefV0 {
  schema: "pluto.bootstrap.object-ref";
  schemaVersion: 0;
  id: string;
  workspaceRef: WorkspaceScopedRefV0;
  objectRef: WorkspaceScopedRefV0;
  objectType: string;
  status: BootstrapStatusLikeV0;
  actorRefs: PrincipalRefV0[];
  summary: string;
  createdAt: string;
  updatedAt: string;
}

export interface BootstrapFailureV0 {
  schema: "pluto.bootstrap.failure";
  schemaVersion: 0;
  id: string;
  sessionId: string;
  stepId: string | null;
  workspaceRef: WorkspaceScopedRefV0;
  actorRefs: PrincipalRefV0[];
  status: BootstrapFailureStatusLikeV0;
  blockingReason: string;
  resolutionHint: string | null;
  createdObjectRefs: BootstrapObjectRefV0[];
  createdAt: string;
  updatedAt: string;
  resolvedAt: string | null;
}

export interface BootstrapSessionV0 {
  schema: "pluto.bootstrap.session";
  schemaVersion: 0;
  id: string;
  workspaceRef: WorkspaceScopedRefV0;
  actorRefs: PrincipalRefV0[];
  status: BootstrapStatusLikeV0;
  createdAt: string;
  updatedAt: string;
  startedAt: string | null;
  finishedAt: string | null;
  blockingReason: string | null;
  resolutionHint: string | null;
  stepIds: string[];
  createdObjectRefs: BootstrapObjectRefV0[];
}

export interface BootstrapStepV0 {
  schema: "pluto.bootstrap.step";
  schemaVersion: 0;
  id: string;
  sessionId: string;
  stableKey: string;
  title: string;
  workspaceRef: WorkspaceScopedRefV0;
  actorRefs: PrincipalRefV0[];
  status: BootstrapStatusLikeV0;
  createdAt: string;
  updatedAt: string;
  startedAt: string | null;
  finishedAt: string | null;
  blockingReason: string | null;
  resolutionHint: string | null;
  dependsOnStepIds: string[];
  createdObjectRefs: BootstrapObjectRefV0[];
}

export interface BootstrapChecklistItemV0 {
  stepId: string;
  stableKey: string;
  title: string;
  status: BootstrapStatusLikeV0;
  blockingReason: string | null;
  resolutionHint: string | null;
  dependsOnStepIds: string[];
  createdObjectRefs: BootstrapObjectRefV0[];
}

export interface BootstrapChecklistV0 {
  schema: "pluto.bootstrap.checklist";
  schemaVersion: 0;
  id: string;
  sessionId: string;
  workspaceRef: WorkspaceScopedRefV0;
  actorRefs: PrincipalRefV0[];
  status: BootstrapStatusLikeV0;
  createdAt: string;
  updatedAt: string;
  blockingReason: string | null;
  resolutionHint: string | null;
  totalStepCount: number;
  completedStepCount: number;
  createdObjectRefs: BootstrapObjectRefV0[];
  items: BootstrapChecklistItemV0[];
}

export interface BootstrapValidationError {
  ok: false;
  errors: string[];
}

export interface BootstrapValidationSuccess<T> {
  ok: true;
  value: T;
}

export type BootstrapValidationResult<T> =
  | BootstrapValidationError
  | BootstrapValidationSuccess<T>;

const BOOTSTRAP_STATUS_SET = new Set<string>(BOOTSTRAP_STATUS_VALUES_V0);
const BOOTSTRAP_FAILURE_STATUS_SET = new Set<string>(BOOTSTRAP_FAILURE_STATUS_VALUES_V0);

function hasOwnProperty(object: Record<string, unknown>, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(object, key);
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
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

function validateArrayField(record: Record<string, unknown>, field: string, errors: string[]): void {
  if (!hasOwnProperty(record, field)) {
    errors.push(`missing required field: ${field}`);
    return;
  }

  if (!Array.isArray(record[field])) {
    errors.push(`${field} must be an array`);
  }
}

function validateWorkspaceScopedRefV0Value(value: unknown, field: string, errors: string[]): void {
  const record = asRecord(value);
  if (!record) {
    errors.push(`${field} must be an object`);
    return;
  }

  validateStringField(record, "workspaceId", errors);
  validateStringField(record, "kind", errors);
  validateStringField(record, "id", errors);
}

function validatePrincipalRefV0Value(value: unknown, field: string, errors: string[]): void {
  const record = asRecord(value);
  if (!record) {
    errors.push(`${field} must be an object`);
    return;
  }

  validateStringField(record, "workspaceId", errors);
  validateStringField(record, "kind", errors);
  validateStringField(record, "principalId", errors);
}

function validatePrincipalRefArrayField(
  record: Record<string, unknown>,
  field: string,
  errors: string[],
): void {
  if (!Array.isArray(record[field])) {
    errors.push(`${field} must be an array`);
    return;
  }

  for (const entry of record[field] as unknown[]) {
    validatePrincipalRefV0Value(entry, field, errors);
  }
}

function validateStringArrayField(record: Record<string, unknown>, field: string, errors: string[]): void {
  if (!Array.isArray(record[field]) || (record[field] as unknown[]).some((entry) => typeof entry !== "string")) {
    errors.push(`${field} must be an array of strings`);
  }
}

function validateObjectRefArrayField(
  record: Record<string, unknown>,
  field: string,
  errors: string[],
): void {
  if (!Array.isArray(record[field])) {
    errors.push(`${field} must be an array`);
    return;
  }

  for (const entry of record[field] as unknown[]) {
    const result = validateBootstrapObjectRefV0(entry);
    if (!result.ok) {
      for (const error of result.errors) {
        errors.push(`${field}: ${error}`);
      }
    }
  }
}

function validateChecklistItemV0(value: unknown): BootstrapValidationResult<BootstrapChecklistItemV0> {
  const record = asRecord(value);
  if (!record) {
    return { ok: false, errors: ["checklist item must be an object"] };
  }

  const errors: string[] = [];
  validateStringField(record, "stepId", errors);
  validateStringField(record, "stableKey", errors);
  validateStringField(record, "title", errors);
  validateStringField(record, "status", errors);
  validateNullableStringField(record, "blockingReason", errors);
  validateNullableStringField(record, "resolutionHint", errors);
  validateArrayField(record, "dependsOnStepIds", errors);
  validateStringArrayField(record, "dependsOnStepIds", errors);
  validateArrayField(record, "createdObjectRefs", errors);
  validateObjectRefArrayField(record, "createdObjectRefs", errors);

  return errors.length === 0
    ? { ok: true, value: record as unknown as BootstrapChecklistItemV0 }
    : { ok: false, errors };
}

export function normalizeBootstrapStatusV0(value: unknown): BootstrapStatusLikeV0 | null {
  if (typeof value !== "string") return null;
  if (value === "done") return "succeeded";
  if (BOOTSTRAP_STATUS_SET.has(value)) {
    return value as BootstrapStatusV0;
  }

  return value;
}

export function parseBootstrapFailureStatusV0(
  value: unknown,
): BootstrapFailureStatusLikeV0 | null {
  if (typeof value !== "string") return null;
  if (BOOTSTRAP_FAILURE_STATUS_SET.has(value)) {
    return value as BootstrapFailureStatusV0;
  }

  return value;
}

export function validateBootstrapObjectRefV0(
  value: unknown,
): BootstrapValidationResult<BootstrapObjectRefV0> {
  const record = asRecord(value);
  if (!record) {
    return { ok: false, errors: ["record must be an object"] };
  }

  const errors: string[] = [];
  if (record["schema"] !== "pluto.bootstrap.object-ref") {
    errors.push("schema must be pluto.bootstrap.object-ref");
  }
  if (record["schemaVersion"] !== 0) {
    errors.push("schemaVersion must be 0");
  }

  validateStringField(record, "id", errors);
  validateWorkspaceScopedRefV0Value(record["workspaceRef"], "workspaceRef", errors);
  validateWorkspaceScopedRefV0Value(record["objectRef"], "objectRef", errors);
  validateStringField(record, "objectType", errors);
  validateStringField(record, "status", errors);
  validateArrayField(record, "actorRefs", errors);
  validatePrincipalRefArrayField(record, "actorRefs", errors);
  validateStringField(record, "summary", errors);
  validateStringField(record, "createdAt", errors);
  validateStringField(record, "updatedAt", errors);

  return errors.length === 0
    ? { ok: true, value: record as unknown as BootstrapObjectRefV0 }
    : { ok: false, errors };
}

export function validateBootstrapFailureV0(
  value: unknown,
): BootstrapValidationResult<BootstrapFailureV0> {
  const record = asRecord(value);
  if (!record) {
    return { ok: false, errors: ["record must be an object"] };
  }

  const errors: string[] = [];
  if (record["schema"] !== "pluto.bootstrap.failure") {
    errors.push("schema must be pluto.bootstrap.failure");
  }
  if (record["schemaVersion"] !== 0) {
    errors.push("schemaVersion must be 0");
  }

  validateStringField(record, "id", errors);
  validateStringField(record, "sessionId", errors);
  validateNullableStringField(record, "stepId", errors);
  validateWorkspaceScopedRefV0Value(record["workspaceRef"], "workspaceRef", errors);
  validateArrayField(record, "actorRefs", errors);
  validatePrincipalRefArrayField(record, "actorRefs", errors);
  validateStringField(record, "status", errors);
  validateStringField(record, "blockingReason", errors);
  validateNullableStringField(record, "resolutionHint", errors);
  validateArrayField(record, "createdObjectRefs", errors);
  validateObjectRefArrayField(record, "createdObjectRefs", errors);
  validateStringField(record, "createdAt", errors);
  validateStringField(record, "updatedAt", errors);
  validateNullableStringField(record, "resolvedAt", errors);

  if (record["status"] !== undefined && parseBootstrapFailureStatusV0(record["status"]) === null) {
    errors.push("status must be a string");
  }

  return errors.length === 0
    ? { ok: true, value: record as unknown as BootstrapFailureV0 }
    : { ok: false, errors };
}

export function validateBootstrapSessionV0(
  value: unknown,
): BootstrapValidationResult<BootstrapSessionV0> {
  const record = asRecord(value);
  if (!record) {
    return { ok: false, errors: ["record must be an object"] };
  }

  const errors: string[] = [];
  if (record["schema"] !== "pluto.bootstrap.session") {
    errors.push("schema must be pluto.bootstrap.session");
  }
  if (record["schemaVersion"] !== 0) {
    errors.push("schemaVersion must be 0");
  }

  validateStringField(record, "id", errors);
  validateWorkspaceScopedRefV0Value(record["workspaceRef"], "workspaceRef", errors);
  validateArrayField(record, "actorRefs", errors);
  validatePrincipalRefArrayField(record, "actorRefs", errors);
  validateStringField(record, "status", errors);
  validateStringField(record, "createdAt", errors);
  validateStringField(record, "updatedAt", errors);
  validateNullableStringField(record, "startedAt", errors);
  validateNullableStringField(record, "finishedAt", errors);
  validateNullableStringField(record, "blockingReason", errors);
  validateNullableStringField(record, "resolutionHint", errors);
  validateArrayField(record, "stepIds", errors);
  validateStringArrayField(record, "stepIds", errors);
  validateArrayField(record, "createdObjectRefs", errors);
  validateObjectRefArrayField(record, "createdObjectRefs", errors);

  if (record["status"] !== undefined && normalizeBootstrapStatusV0(record["status"]) === null) {
    errors.push("status must be a string");
  }

  return errors.length === 0
    ? { ok: true, value: record as unknown as BootstrapSessionV0 }
    : { ok: false, errors };
}

export function validateBootstrapStepV0(
  value: unknown,
): BootstrapValidationResult<BootstrapStepV0> {
  const record = asRecord(value);
  if (!record) {
    return { ok: false, errors: ["record must be an object"] };
  }

  const errors: string[] = [];
  if (record["schema"] !== "pluto.bootstrap.step") {
    errors.push("schema must be pluto.bootstrap.step");
  }
  if (record["schemaVersion"] !== 0) {
    errors.push("schemaVersion must be 0");
  }

  validateStringField(record, "id", errors);
  validateStringField(record, "sessionId", errors);
  validateStringField(record, "stableKey", errors);
  validateStringField(record, "title", errors);
  validateWorkspaceScopedRefV0Value(record["workspaceRef"], "workspaceRef", errors);
  validateArrayField(record, "actorRefs", errors);
  validatePrincipalRefArrayField(record, "actorRefs", errors);
  validateStringField(record, "status", errors);
  validateStringField(record, "createdAt", errors);
  validateStringField(record, "updatedAt", errors);
  validateNullableStringField(record, "startedAt", errors);
  validateNullableStringField(record, "finishedAt", errors);
  validateNullableStringField(record, "blockingReason", errors);
  validateNullableStringField(record, "resolutionHint", errors);
  validateArrayField(record, "dependsOnStepIds", errors);
  validateStringArrayField(record, "dependsOnStepIds", errors);
  validateArrayField(record, "createdObjectRefs", errors);
  validateObjectRefArrayField(record, "createdObjectRefs", errors);

  if (record["status"] !== undefined && normalizeBootstrapStatusV0(record["status"]) === null) {
    errors.push("status must be a string");
  }

  return errors.length === 0
    ? { ok: true, value: record as unknown as BootstrapStepV0 }
    : { ok: false, errors };
}

export function validateBootstrapChecklistV0(
  value: unknown,
): BootstrapValidationResult<BootstrapChecklistV0> {
  const record = asRecord(value);
  if (!record) {
    return { ok: false, errors: ["record must be an object"] };
  }

  const errors: string[] = [];
  if (record["schema"] !== "pluto.bootstrap.checklist") {
    errors.push("schema must be pluto.bootstrap.checklist");
  }
  if (record["schemaVersion"] !== 0) {
    errors.push("schemaVersion must be 0");
  }

  validateStringField(record, "id", errors);
  validateStringField(record, "sessionId", errors);
  validateWorkspaceScopedRefV0Value(record["workspaceRef"], "workspaceRef", errors);
  validateArrayField(record, "actorRefs", errors);
  validatePrincipalRefArrayField(record, "actorRefs", errors);
  validateStringField(record, "status", errors);
  validateStringField(record, "createdAt", errors);
  validateStringField(record, "updatedAt", errors);
  validateNullableStringField(record, "blockingReason", errors);
  validateNullableStringField(record, "resolutionHint", errors);
  validateArrayField(record, "createdObjectRefs", errors);
  validateObjectRefArrayField(record, "createdObjectRefs", errors);
  validateArrayField(record, "items", errors);

  if (typeof record["totalStepCount"] !== "number") {
    errors.push("totalStepCount must be a number");
  }
  if (typeof record["completedStepCount"] !== "number") {
    errors.push("completedStepCount must be a number");
  }

  if (record["status"] !== undefined && normalizeBootstrapStatusV0(record["status"]) === null) {
    errors.push("status must be a string");
  }

  if (Array.isArray(record["items"])) {
    for (const entry of record["items"] as unknown[]) {
      const result = validateChecklistItemV0(entry);
      if (!result.ok) {
        for (const error of result.errors) {
          errors.push(`items: ${error}`);
        }
      }
    }
  }

  return errors.length === 0
    ? { ok: true, value: record as unknown as BootstrapChecklistV0 }
    : { ok: false, errors };
}
