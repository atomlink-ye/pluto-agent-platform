import type { CitationKindLikeV0 } from "./evidence-graph.js";
import type { EvidenceValidationOutcomeV0 } from "./governance.js";
import type { ChannelTargetStatusLikeV0 } from "./publish.js";
import type {
  CompatibilityDependencyRefV0,
  CompatibilitySupportMatrixV0,
  SchemaVersionRefV0,
} from "../versioning/contracts.js";

import type {
  PortableAssetKindV0,
  PortableAssetKindLikeV0,
  PortableAssetLogicalRefV0,
  PortableWorkflowBundleRefV0,
  PortableChecksumV0,
  PortableCompatibilityMetadataV0,
  RedactionSummaryV0,
  ImportRequirementV0,
  DocumentExportV0,
  TemplateExportV0,
  PublishPackageExportV0,
  EvidenceSummaryExportV0,
  PortableAssetExportV0,
  PortableAssetManifestV0,
  PortableAssetBundleV0,
  PortabilityConflictV0,
  PortabilityValidationResult,
} from "./portability-schema.js";

const PORTABLE_ASSET_KIND_SET = new Set<string>([
  "document",
  "template",
  "publish_package",
  "evidence_summary",
]);
const PORTABILITY_CONFLICT_RESOLUTION_SET = new Set<string>(["duplicate", "fork", "map", "reject"]);
const PORTABILITY_CONFLICT_OUTCOME_SET = new Set<string>(["created_as_draft", "created_as_fork", "rejected"]);
const PROHIBITED_FIELD_NAMES = new Set<string>([
  "workspaceId",
  "ownerId",
  "createdById",
  "requestedById",
  "reviewerId",
  "approverId",
  "actorId",
  "principalId",
  "sessionId",
  "runtimeTranscript",
  "rawAuditHistory",
  "auditHistory",
  "providerStdout",
  "providerStderr",
  "rawCallbackPayload",
  "callbackPayload",
  "credentialValue",
  "secretValue",
  "privateStoragePath",
  "storagePath",
  "workspacePath",
  "providerPayload",
  "providerResponse",
  "rawRuntimePayload",
  "runtimePrivateState",
  "tenantPrivateState",
]);
const PROHIBITED_PATH_RE = /(^|\/)(?:\.pluto|workspace)(?:\/|$)/;

export function toPortableAssetLogicalRefV0(value: PortableAssetLogicalRefV0): PortableAssetLogicalRefV0 {
  return {
    kind: value.kind,
    logicalId: value.logicalId,
    sourceDocumentId: value.sourceDocumentId,
    sourceVersionId: value.sourceVersionId,
    sourceTemplateId: value.sourceTemplateId,
    sourcePublishPackageId: value.sourcePublishPackageId,
  };
}

export function toPortableWorkflowBundleRefV0(value: PortableWorkflowBundleRefV0): PortableWorkflowBundleRefV0 {
  return {
    kind: "portable_workflow_bundle",
    workflowId: value.workflowId,
    bundleRef: value.bundleRef,
  };
}

export function toEvidenceSummaryExportV0(
  value: Omit<EvidenceSummaryExportV0, "schema" | "schemaVersion" | "kind">,
): EvidenceSummaryExportV0 {
  return {
    schema: "pluto.portability.evidence-summary-export",
    schemaVersion: 0,
    kind: "evidence_summary",
    id: value.id,
    logicalRef: toPortableAssetLogicalRefV0({
      ...value.logicalRef,
      kind: "evidence_summary",
    }),
    title: value.title,
    createdAt: value.createdAt,
    exportedAt: value.exportedAt,
    workflowRefs: value.workflowRefs.map((ref) => toPortableWorkflowBundleRefV0(ref)),
    compatibility: toPortableCompatibilityMetadataV0(value.compatibility),
    checksum: toPortableChecksumV0(value.checksum),
    redactionSummary: toRedactionSummaryV0(value.redactionSummary),
    evidence: {
      sealedEvidenceId: value.evidence.sealedEvidenceId,
      citationRefs: value.evidence.citationRefs.map((citation) => ({
        citationId: citation.citationId,
        citationKind: citation.citationKind,
        locator: citation.locator,
        summary: citation.summary,
      })),
      validation: {
        outcome: value.evidence.validation.outcome,
        reason: value.evidence.validation.reason ?? null,
      },
      readiness: {
        status: value.evidence.readiness.status,
        blockedReasons: sanitizeStringArray(value.evidence.readiness.blockedReasons),
        summary: value.evidence.readiness.summary,
      },
    },
  };
}

export function validatePortableAssetBundleV0(value: unknown): PortabilityValidationResult<PortableAssetBundleV0> {
  const record = asRecord(value);
  if (!record) {
    return { ok: false, errors: ["portable asset bundle must be an object"] };
  }

  const errors: string[] = [];
  validateSchema(record, "pluto.portability.bundle", errors);
  validateSchemaVersion(record, errors);
  validateStringField(record, "bundleId", errors);
  validateManifest(record["manifest"], errors);
  validateAssets(record["assets"], errors);
  validatePortableSanitization(value, errors);

  return errors.length === 0
    ? { ok: true, value: record as unknown as PortableAssetBundleV0 }
    : { ok: false, errors };
}

export function validatePortableAssetManifestV0(value: unknown): PortabilityValidationResult<PortableAssetManifestV0> {
  const record = asRecord(value);
  if (!record) {
    return { ok: false, errors: ["portable asset manifest must be an object"] };
  }

  const errors: string[] = [];
  validateManifest(record, errors);
  return errors.length === 0
    ? { ok: true, value: record as unknown as PortableAssetManifestV0 }
    : { ok: false, errors };
}

export function validateDocumentExportV0(value: unknown): PortabilityValidationResult<DocumentExportV0> {
  return validateAssetExportV0(value, "document", "pluto.portability.document-export");
}

export function validateTemplateExportV0(value: unknown): PortabilityValidationResult<TemplateExportV0> {
  return validateAssetExportV0(value, "template", "pluto.portability.template-export");
}

export function validatePublishPackageExportV0(value: unknown): PortabilityValidationResult<PublishPackageExportV0> {
  return validateAssetExportV0(value, "publish_package", "pluto.portability.publish-package-export");
}

export function validateEvidenceSummaryExportV0(value: unknown): PortabilityValidationResult<EvidenceSummaryExportV0> {
  return validateAssetExportV0(value, "evidence_summary", "pluto.portability.evidence-summary-export");
}

export function validateRedactionSummaryV0(value: unknown): PortabilityValidationResult<RedactionSummaryV0> {
  const errors: string[] = [];
  validateRedactionSummary(value, errors);
  return errors.length === 0
    ? { ok: true, value: value as RedactionSummaryV0 }
    : { ok: false, errors };
}

export function validateImportRequirementV0(value: unknown): PortabilityValidationResult<ImportRequirementV0> {
  const errors: string[] = [];
  validateImportRequirement(value, errors);
  return errors.length === 0
    ? { ok: true, value: value as ImportRequirementV0 }
    : { ok: false, errors };
}

export function validatePortabilityConflictV0(value: unknown): PortabilityValidationResult<PortabilityConflictV0> {
  const record = asRecord(value);
  if (!record) {
    return { ok: false, errors: ["portability conflict must be an object"] };
  }

  const errors: string[] = [];
  validateSchema(record, "pluto.portability.conflict", errors);
  validateSchemaVersion(record, errors);
  validateStringField(record, "code", errors);
  validateStringField(record, "message", errors);
  validatePortableAssetKind(record["assetKind"], "assetKind", errors);
  validateStringField(record, "incomingLogicalId", errors);
  validateStringField(record, "existingLogicalId", errors);
  validateEnumLikeField(record["resolution"], "resolution", PORTABILITY_CONFLICT_RESOLUTION_SET, errors);
  validateEnumLikeField(record["outcome"], "outcome", PORTABILITY_CONFLICT_OUTCOME_SET, errors);

  return errors.length === 0
    ? { ok: true, value: record as unknown as PortabilityConflictV0 }
    : { ok: false, errors };
}

export function assertPortableAssetBundleSafe(value: unknown): asserts value is PortableAssetBundleV0 {
  const errors: string[] = [];
  validatePortableSanitization(value, errors);
  if (errors.length > 0) {
    throw new Error(errors.join("; "));
  }
}

function validateAssetExportV0<T extends PortableAssetExportV0>(
  value: unknown,
  kind: PortableAssetKindV0,
  schema: T["schema"],
): PortabilityValidationResult<T> {
  const record = asRecord(value);
  if (!record) {
    return { ok: false, errors: [`${kind} export must be an object`] };
  }

  const errors: string[] = [];
  validateAssetBase(record, kind, schema, errors);

  if (kind === "document") {
    validateDocumentPayload(record["content"], errors);
    validateMetadataPayload(record["metadata"], "metadata", errors);
  }

  if (kind === "template") {
    validateTemplatePayload(record["template"], errors);
    validateMetadataPayload(record["metadata"], "metadata", errors);
  }

  if (kind === "publish_package") {
    validatePublishPackagePayload(record["publishPackage"], errors);
  }

  if (kind === "evidence_summary") {
    validateEvidenceSummaryPayload(record["evidence"], errors);
  }

  validatePortableSanitization(value, errors);

  return errors.length === 0
    ? { ok: true, value: record as unknown as T }
    : { ok: false, errors };
}

function validateAssetBase(
  record: Record<string, unknown>,
  kind: PortableAssetKindV0,
  schema: string,
  errors: string[],
): void {
  validateSchema(record, schema, errors);
  validateSchemaVersion(record, errors);
  validateStringField(record, "id", errors);
  validateStringField(record, "title", errors);
  validateStringField(record, "createdAt", errors);
  validateStringField(record, "exportedAt", errors);
  if (record["kind"] !== kind) {
    errors.push(`kind must be ${kind}`);
  }
  validateLogicalRef(record["logicalRef"], errors);
  validateWorkflowRefs(record["workflowRefs"], errors);
  validateCompatibility(record["compatibility"], errors);
  validateChecksum(record["checksum"], "checksum", errors);
  validateRedactionSummary(record["redactionSummary"], errors);
}

function validateManifest(value: unknown, errors: string[]): void {
  const record = asRecord(value);
  if (!record) {
    errors.push("manifest must be an object");
    return;
  }

  validateSchema(record, "pluto.portability.manifest", errors, "manifest");
  validateSchemaVersion(record, errors, "manifest");
  validateStringField(record, "bundleId", errors, "manifest");
  validateStringField(record, "bundleVersion", errors, "manifest");
  validateStringField(record, "exportedAt", errors, "manifest");
  validatePortableAssetKinds(record["assetKinds"], "manifest.assetKinds", errors);
  validateLogicalRefs(record["logicalRefs"], "manifest.logicalRefs", errors);
  validateWorkflowRefs(record["workflowRefs"], errors, "manifest.workflowRefs");
  validateCompatibility(record["compatibility"], errors, "manifest.compatibility");
  validateChecksums(record["checksums"], "manifest.checksums", errors);
  validateImportRequirements(record["importRequirements"], errors, "manifest.importRequirements");
  validateRedactionSummary(record["redactionSummary"], errors, "manifest.redactionSummary");
}

function validateAssets(value: unknown, errors: string[]): void {
  if (!Array.isArray(value) || value.length === 0) {
    errors.push("assets must be a non-empty array");
    return;
  }

  value.forEach((entry, index) => {
    const record = asRecord(entry);
    if (!record) {
      errors.push(`assets[${index}] must be an object`);
      return;
    }

    const kind = record["kind"];
    if (kind === "document") {
      collectValidationErrors(validateDocumentExportV0(entry), `assets[${index}]`, errors);
      return;
    }

    if (kind === "template") {
      collectValidationErrors(validateTemplateExportV0(entry), `assets[${index}]`, errors);
      return;
    }

    if (kind === "publish_package") {
      collectValidationErrors(validatePublishPackageExportV0(entry), `assets[${index}]`, errors);
      return;
    }

    if (kind === "evidence_summary") {
      collectValidationErrors(validateEvidenceSummaryExportV0(entry), `assets[${index}]`, errors);
      return;
    }

    errors.push(`assets[${index}].kind must be one of document, template, publish_package, evidence_summary`);
  });
}

function validatePortableSanitization(value: unknown, errors: string[]): void {
  inspectPortableValue(value, [], errors);
}

function inspectPortableValue(value: unknown, path: string[], errors: string[]): void {
  if (typeof value === "string") {
    const fieldName = path[path.length - 1];
    if (
      (fieldName === "storagePath" || fieldName === "workspacePath" || fieldName === "privateStoragePath")
      && PROHIBITED_PATH_RE.test(value)
    ) {
      errors.push(`${path.join(".")} must not contain private storage paths`);
    }
    return;
  }

  if (Array.isArray(value)) {
    value.forEach((entry, index) => inspectPortableValue(entry, [...path, String(index)], errors));
    return;
  }

  if (typeof value !== "object" || value === null) {
    return;
  }

  for (const [key, entry] of Object.entries(value)) {
    const nextPath = [...path, key];
    if (PROHIBITED_FIELD_NAMES.has(key)) {
      errors.push(`${nextPath.join(".")} must be excluded from portable bundles`);
      continue;
    }
    inspectPortableValue(entry, nextPath, errors);
  }
}

function validateLogicalRefs(value: unknown, path: string, errors: string[]): void {
  if (!Array.isArray(value) || value.length === 0) {
    errors.push(`${path} must be a non-empty array`);
    return;
  }

  value.forEach((entry, index) => validateLogicalRef(entry, errors, `${path}[${index}]`));
}

function validateLogicalRef(value: unknown, errors: string[], path = "logicalRef"): void {
  const record = asRecord(value);
  if (!record) {
    errors.push(`${path} must be an object`);
    return;
  }

  validatePortableAssetKind(record["kind"], `${path}.kind`, errors);
  validateStringField(record, "logicalId", errors, path);
  validateOptionalStringField(record, "sourceDocumentId", errors, path);
  validateOptionalStringField(record, "sourceVersionId", errors, path);
  validateOptionalStringField(record, "sourceTemplateId", errors, path);
  validateOptionalStringField(record, "sourcePublishPackageId", errors, path);
}

function validateWorkflowRefs(value: unknown, errors: string[], path = "workflowRefs"): void {
  if (!Array.isArray(value)) {
    errors.push(`${path} must be an array`);
    return;
  }

  value.forEach((entry, index) => {
    const record = asRecord(entry);
    if (!record) {
      errors.push(`${path}[${index}] must be an object`);
      return;
    }
    if (record["kind"] !== "portable_workflow_bundle") {
      errors.push(`${path}[${index}].kind must be portable_workflow_bundle`);
    }
    validateStringField(record, "workflowId", errors, `${path}[${index}]`);
    validateStringField(record, "bundleRef", errors, `${path}[${index}]`);
  });
}

function validateCompatibility(value: unknown, errors: string[], path = "compatibility"): void {
  const record = asRecord(value);
  if (!record) {
    errors.push(`${path} must be an object`);
    return;
  }

  if (record["schemaVersion"] !== 0) {
    errors.push(`${path}.schemaVersion must be 0`);
  }
  validateSchemaVersionRef(record["bundle"], `${path}.bundle`, errors);
  validateSupportMatrix(record["target"], `${path}.target`, errors);
  validateDependencyRefs(record["dependencies"], `${path}.dependencies`, errors);
}

function validateChecksum(value: unknown, path: string, errors: string[]): void {
  const record = asRecord(value);
  if (!record) {
    errors.push(`${path} must be an object`);
    return;
  }

  validateStringField(record, "algorithm", errors, path);
  validateStringField(record, "digest", errors, path);
}

function validateChecksums(value: unknown, path: string, errors: string[]): void {
  if (!Array.isArray(value) || value.length === 0) {
    errors.push(`${path} must be a non-empty array`);
    return;
  }

  value.forEach((entry, index) => validateChecksum(entry, `${path}[${index}]`, errors));
}

function validateRedactionSummary(value: unknown, errors: string[], path = "redactionSummary"): void {
  const record = asRecord(value);
  if (!record) {
    errors.push(`${path} must be an object`);
    return;
  }

  validateSchema(record, "pluto.portability.redaction-summary", errors, path);
  validateSchemaVersion(record, errors, path);
  validateStringArray(record["redactedFields"], `${path}.redactedFields`, errors);
  validateStringArray(record["redactedRefKinds"], `${path}.redactedRefKinds`, errors);
  validateStringArray(record["excludedContent"], `${path}.excludedContent`, errors);
  validateStringField(record, "summary", errors, path);
}

function validateImportRequirements(value: unknown, errors: string[], path = "importRequirements"): void {
  if (!Array.isArray(value)) {
    errors.push(`${path} must be an array`);
    return;
  }

  value.forEach((entry, index) => validateImportRequirement(entry, errors, `${path}[${index}]`));
}

function validateImportRequirement(value: unknown, errors: string[], path = "importRequirement"): void {
  const record = asRecord(value);
  if (!record) {
    errors.push(`${path} must be an object`);
    return;
  }

  validateSchema(record, "pluto.portability.import-requirement", errors, path);
  validateSchemaVersion(record, errors, path);
  validateStringField(record, "code", errors, path);
  if (typeof record["required"] !== "boolean") {
    errors.push(`${path}.required must be a boolean`);
  }
  validateStringField(record, "description", errors, path);
  validateOptionalStringArray(record, "secretNames", errors, path);
  validateOptionalStringArray(record, "capabilityRefs", errors, path);
  validateOptionalStringField(record, "minimumBundleVersion", errors, path);
}

function validateDocumentPayload(value: unknown, errors: string[]): void {
  const record = asRecord(value);
  if (!record) {
    errors.push("content must be an object");
    return;
  }
  validateStringField(record, "format", errors, "content");
  validateStringField(record, "body", errors, "content");
}

function validateTemplatePayload(value: unknown, errors: string[]): void {
  const record = asRecord(value);
  if (!record) {
    errors.push("template must be an object");
    return;
  }
  validateStringField(record, "body", errors, "template");
  validateStringArray(record["variables"], "template.variables", errors);
  validateStringField(record, "outputFormat", errors, "template");
}

function validateMetadataPayload(value: unknown, field: string, errors: string[]): void {
  const record = asRecord(value);
  if (!record) {
    errors.push(`${field} must be an object`);
    return;
  }
  validateOptionalStringField(record, "label", errors, field);
  validateOptionalStringField(record, "category", errors, field);
  if (record["tags"] !== undefined) {
    validateStringArray(record["tags"], `${field}.tags`, errors);
  }
  validateStringArray(record["lineageRefs"], `${field}.lineageRefs`, errors);
}

function validatePublishPackagePayload(value: unknown, errors: string[]): void {
  const record = asRecord(value);
  if (!record) {
    errors.push("publishPackage must be an object");
    return;
  }
  if (!Array.isArray(record["channelTargets"])) {
    errors.push("publishPackage.channelTargets must be an array");
  }
  validateStringArray(record["sourceVersionRefs"], "publishPackage.sourceVersionRefs", errors);
  validateStringArray(record["sealedEvidenceRefs"], "publishPackage.sealedEvidenceRefs", errors);
}

function validateEvidenceSummaryPayload(value: unknown, errors: string[]): void {
  const record = asRecord(value);
  if (!record) {
    errors.push("evidence must be an object");
    return;
  }

  validateStringField(record, "sealedEvidenceId", errors, "evidence");
  if (!Array.isArray(record["citationRefs"])) {
    errors.push("evidence.citationRefs must be an array");
  }
  const validation = asRecord(record["validation"]);
  if (!validation) {
    errors.push("evidence.validation must be an object");
  } else {
    validateStringField(validation, "outcome", errors, "evidence.validation");
    validateNullableStringField(validation, "reason", errors, "evidence.validation");
  }
  const readiness = asRecord(record["readiness"]);
  if (!readiness) {
    errors.push("evidence.readiness must be an object");
  } else {
    validateStringField(readiness, "status", errors, "evidence.readiness");
    validateStringArray(readiness["blockedReasons"], "evidence.readiness.blockedReasons", errors);
    validateStringField(readiness, "summary", errors, "evidence.readiness");
  }
}

function validateSchemaVersionRef(value: unknown, path: string, errors: string[]): void {
  const record = asRecord(value);
  if (!record) {
    errors.push(`${path} must be an object`);
    return;
  }
  validateStringField(record, "family", errors, path);
  if (typeof record["version"] !== "number") {
    errors.push(`${path}.version must be a number`);
  }
  validateStringField(record, "writtenAt", errors, path);
}

function validateSupportMatrix(value: unknown, path: string, errors: string[]): void {
  const record = asRecord(value);
  if (!record) {
    errors.push(`${path} must be an object`);
    return;
  }
  validateOptionalStringArray(record, "schemaFamilies", errors, path);
  if (record["schemaVersions"] !== undefined) {
    const versions = record["schemaVersions"];
    if (!Array.isArray(versions) || versions.some((entry) => typeof entry !== "number")) {
      errors.push(`${path}.schemaVersions must be an array of numbers`);
    }
  }
}

function validateDependencyRefs(value: unknown, path: string, errors: string[]): void {
  if (!Array.isArray(value)) {
    errors.push(`${path} must be an array`);
    return;
  }
  value.forEach((entry, index) => {
    const record = asRecord(entry);
    if (!record) {
      errors.push(`${path}[${index}] must be an object`);
      return;
    }
    validateStringField(record, "id", errors, `${path}[${index}]`);
    validateOptionalStringField(record, "packageName", errors, `${path}[${index}]`);
    validateOptionalStringField(record, "version", errors, `${path}[${index}]`);
    if (typeof record["resolved"] !== "boolean") {
      errors.push(`${path}[${index}].resolved must be a boolean`);
    }
  });
}

function validatePortableAssetKinds(value: unknown, path: string, errors: string[]): void {
  if (!Array.isArray(value) || value.length === 0) {
    errors.push(`${path} must be a non-empty array`);
    return;
  }
  value.forEach((entry, index) => validatePortableAssetKind(entry, `${path}[${index}]`, errors));
}

function validatePortableAssetKind(value: unknown, path: string, errors: string[]): void {
  if (typeof value !== "string") {
    errors.push(`${path} must be a string`);
    return;
  }
  if (!PORTABLE_ASSET_KIND_SET.has(value)) {
    errors.push(`${path} must be one of document, template, publish_package, evidence_summary`);
  }
}

function validateEnumLikeField(
  value: unknown,
  path: string,
  allowed: Set<string>,
  errors: string[],
): void {
  if (typeof value !== "string") {
    errors.push(`${path} must be a string`);
    return;
  }
  if (!allowed.has(value)) {
    errors.push(`${path} must be one of ${Array.from(allowed).join(", ")}`);
  }
}

function validateSchema(
  record: Record<string, unknown>,
  expected: string,
  errors: string[],
  path?: string,
): void {
  const label = path ? `${path}.schema` : "schema";
  if (record["schema"] !== expected) {
    errors.push(`${label} must be ${expected}`);
  }
}

function validateSchemaVersion(record: Record<string, unknown>, errors: string[], path?: string): void {
  const label = path ? `${path}.schemaVersion` : "schemaVersion";
  if (record["schemaVersion"] !== 0) {
    errors.push(`${label} must be 0`);
  }
}

function validateStringField(
  record: Record<string, unknown>,
  field: string,
  errors: string[],
  parentPath?: string,
): void {
  const path = parentPath ? `${parentPath}.${field}` : field;
  if (!Object.prototype.hasOwnProperty.call(record, field)) {
    errors.push(`missing required field: ${path}`);
    return;
  }
  if (typeof record[field] !== "string") {
    errors.push(`${path} must be a string`);
  }
}

function validateNullableStringField(
  record: Record<string, unknown>,
  field: string,
  errors: string[],
  parentPath?: string,
): void {
  const path = parentPath ? `${parentPath}.${field}` : field;
  if (!Object.prototype.hasOwnProperty.call(record, field)) {
    errors.push(`missing required field: ${path}`);
    return;
  }
  const value = record[field];
  if (value !== null && typeof value !== "string") {
    errors.push(`${path} must be a string or null`);
  }
}

function validateOptionalStringField(
  record: Record<string, unknown>,
  field: string,
  errors: string[],
  parentPath?: string,
): void {
  if (record[field] === undefined) {
    return;
  }
  const path = parentPath ? `${parentPath}.${field}` : field;
  if (typeof record[field] !== "string") {
    errors.push(`${path} must be a string when present`);
  }
}

function validateStringArray(value: unknown, path: string, errors: string[]): void {
  if (!Array.isArray(value) || value.some((entry) => typeof entry !== "string")) {
    errors.push(`${path} must be an array of strings`);
  }
}

function validateOptionalStringArray(
  record: Record<string, unknown>,
  field: string,
  errors: string[],
  parentPath?: string,
): void {
  if (record[field] === undefined) {
    return;
  }
  validateStringArray(record[field], parentPath ? `${parentPath}.${field}` : field, errors);
}

function sanitizeStringArray(value: string[]): string[] {
  return value.filter((entry) => typeof entry === "string");
}

function toPortableCompatibilityMetadataV0(value: PortableCompatibilityMetadataV0): PortableCompatibilityMetadataV0 {
  return {
    schemaVersion: 0,
    bundle: {
      family: value.bundle.family,
      version: value.bundle.version,
      writtenAt: value.bundle.writtenAt,
    },
    target: {
      schemaFamilies: value.target.schemaFamilies ? [...value.target.schemaFamilies] : undefined,
      schemaVersions: value.target.schemaVersions ? [...value.target.schemaVersions] : undefined,
    },
    dependencies: value.dependencies.map((dependency) => ({
      id: dependency.id,
      packageName: dependency.packageName,
      version: dependency.version,
      resolved: dependency.resolved,
    })),
  };
}

function toPortableChecksumV0(value: PortableChecksumV0): PortableChecksumV0 {
  return {
    algorithm: value.algorithm,
    digest: value.digest,
  };
}

function toRedactionSummaryV0(value: RedactionSummaryV0): RedactionSummaryV0 {
  return {
    schema: "pluto.portability.redaction-summary",
    schemaVersion: 0,
    redactedFields: sanitizeStringArray(value.redactedFields),
    redactedRefKinds: sanitizeStringArray(value.redactedRefKinds),
    excludedContent: sanitizeStringArray(value.excludedContent),
    summary: value.summary,
  };
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (typeof value !== "object" || value === null) {
    return null;
  }
  return value as Record<string, unknown>;
}

function collectValidationErrors<T>(
  result: PortabilityValidationResult<T>,
  prefix: string,
  errors: string[],
): void {
  if (result.ok) {
    return;
  }
  for (const error of result.errors) {
    errors.push(`${prefix}.${error}`);
  }
}