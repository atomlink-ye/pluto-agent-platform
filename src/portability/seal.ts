import { createHash } from "node:crypto";

import type {
  CompatibilityDependencyRefV0,
  CompatibilitySupportMatrixV0,
  SchemaVersionRefV0,
} from "../versioning/contracts.js";
import type {
  PortableAssetBundleV0,
  PortableAssetManifestV0,
  PortableChecksumV0,
} from "../contracts/portability.js";
import { validatePortableAssetBundleV0 } from "../contracts/portability.js";

const DEFAULT_BUNDLE_TARGET: CompatibilitySupportMatrixV0 = {
  schemaFamilies: ["pluto.portability.bundle"],
  schemaVersions: [0],
};

export interface PortableExportAuthorizationV0 {
  allowed: boolean;
  reason?: string;
}

export interface PortableExportPolicyV0 {
  allowed: boolean;
  reason?: string;
}

export interface PortableExportSensitivityV0 {
  assetLogicalId: string;
  sensitivityClass: string;
}

export interface PortableExportRetentionCheckV0 {
  assetLogicalId: string;
  blockingReasons: string[];
}

export interface PortableExportValidationInputV0 {
  authorization?: PortableExportAuthorizationV0;
  exportPolicy?: PortableExportPolicyV0;
  target?: CompatibilitySupportMatrixV0;
  sensitivity?: {
    allowedClasses?: string[];
    assetClasses?: PortableExportSensitivityV0[];
  };
  retention?: PortableExportRetentionCheckV0[];
  legalHoldActiveLogicalIds?: string[];
  dependencies?: CompatibilityDependencyRefV0[];
  prohibitedContentFindings?: string[];
}

export interface PortableExportValidationFailureV0 {
  ok: false;
  errors: string[];
}

export interface PortableExportValidationSuccessV0 {
  ok: true;
  value: PortableAssetBundleV0;
}

export type PortableExportValidationResultV0 =
  | PortableExportValidationFailureV0
  | PortableExportValidationSuccessV0;

export interface LocalPortableSealV0 {
  schema: "pluto.portability.bundle-seal";
  schemaVersion: 0;
  sealVersion: "local-v0";
  sealedAt: string;
  manifestChecksum: PortableChecksumV0;
  payloadChecksum: PortableChecksumV0;
}

export interface SealedPortableBundleV0 {
  bundle: PortableAssetBundleV0;
  seal: LocalPortableSealV0;
}

export function validatePortableBundleExportV0(
  bundle: PortableAssetBundleV0,
  input: PortableExportValidationInputV0,
): PortableExportValidationResultV0 {
  const parsed = validatePortableAssetBundleV0(bundle);
  if (!parsed.ok) {
    return parsed;
  }

  const errors: string[] = [];
  const authorization = input.authorization;
  if (!authorization?.allowed) {
    errors.push(`authorization_blocked: ${authorization?.reason ?? "explicit export authorization is required"}`);
  }

  const exportPolicy = input.exportPolicy;
  if (!exportPolicy?.allowed) {
    errors.push(`export_policy_blocked: ${exportPolicy?.reason ?? "export policy approval is required"}`);
  }

  const target = input.target;
  const bundleSchema = parsed.value.manifest.compatibility.bundle;
  if (!target) {
    errors.push("compatibility_gap: supported target schema matrix is required before sealing");
  } else if (!supportsBundleSchema(target, bundleSchema)) {
    errors.push(
      `compatibility_gap: target does not support ${bundleSchema.family} v${String(bundleSchema.version)}`,
    );
  }

  const unresolvedDependencies = [
    ...parsed.value.manifest.compatibility.dependencies,
    ...(input.dependencies ?? []),
  ].filter((dependency) => !dependency.resolved);
  for (const dependency of unresolvedDependencies) {
    errors.push(`dependency_gap: ${dependency.id}`);
  }

  const sensitivity = input.sensitivity;
  const allowedClasses = new Set(sensitivity?.allowedClasses ?? []);
  const assetClasses = new Map((sensitivity?.assetClasses ?? []).map((entry) => [entry.assetLogicalId, entry.sensitivityClass]));
  if (!sensitivity?.allowedClasses?.length) {
    errors.push("sensitivity_blocked: allowed sensitivity classes are required before sealing");
  }
  for (const asset of parsed.value.assets) {
    const assetLogicalId = asset.logicalRef.logicalId;
    const sensitivityClass = assetClasses.get(assetLogicalId);
    if (!sensitivityClass) {
      errors.push(`sensitivity_blocked: missing sensitivity classification for '${assetLogicalId}'`);
      continue;
    }
    if (!allowedClasses.has(sensitivityClass)) {
      errors.push(`sensitivity_blocked: '${assetLogicalId}' has prohibited sensitivity '${sensitivityClass}'`);
    }
  }

  const retentionChecks = new Map((input.retention ?? []).map((entry) => [entry.assetLogicalId, entry.blockingReasons]));
  if (!input.retention) {
    errors.push("retention_blocked: retention evaluations are required before sealing");
  }
  for (const asset of parsed.value.assets) {
    const reasons = retentionChecks.get(asset.logicalRef.logicalId);
    if (!reasons) {
      errors.push(`retention_blocked: missing retention evaluation for '${asset.logicalRef.logicalId}'`);
      continue;
    }
    for (const reason of reasons) {
      errors.push(`retention_blocked: '${asset.logicalRef.logicalId}' is blocked by ${reason}`);
    }
  }

  const legalHoldIds = new Set(input.legalHoldActiveLogicalIds ?? []);
  if (input.legalHoldActiveLogicalIds === undefined) {
    errors.push("legal_hold_blocked: legal-hold evaluation is required before sealing");
  }
  for (const asset of parsed.value.assets) {
    if (legalHoldIds.has(asset.logicalRef.logicalId)) {
      errors.push(`legal_hold_blocked: '${asset.logicalRef.logicalId}' is under legal hold`);
    }
  }

  for (const finding of input.prohibitedContentFindings ?? []) {
    errors.push(`prohibited_content: ${finding}`);
  }

  return errors.length > 0 ? { ok: false, errors } : { ok: true, value: parsed.value };
}

export function sealPortableBundleV0(
  bundle: PortableAssetBundleV0,
  input: PortableExportValidationInputV0,
  options: { sealedAt?: string } = {},
): PortableExportValidationFailureV0 | { ok: true; value: SealedPortableBundleV0 } {
  const validation = validatePortableBundleExportV0(bundle, input);
  if (!validation.ok) {
    return validation;
  }

  const canonicalBundle = canonicalizeBundle(validation.value);
  return {
    ok: true,
    value: {
      bundle: canonicalBundle,
      seal: {
        schema: "pluto.portability.bundle-seal",
        schemaVersion: 0,
        sealVersion: "local-v0",
        sealedAt: options.sealedAt ?? new Date().toISOString(),
        manifestChecksum: sha256Checksum(canonicalizeManifest(canonicalBundle.manifest)),
        payloadChecksum: sha256Checksum(canonicalBundle),
      },
    },
  };
}

function supportsBundleSchema(target: CompatibilitySupportMatrixV0, bundle: SchemaVersionRefV0): boolean {
  const supportsFamily = !target.schemaFamilies?.length || target.schemaFamilies.includes(bundle.family);
  const supportsVersion = !target.schemaVersions?.length || target.schemaVersions.includes(bundle.version);
  return supportsFamily && supportsVersion;
}

function canonicalizeBundle(bundle: PortableAssetBundleV0): PortableAssetBundleV0 {
  const assets = [...bundle.assets]
    .map((asset) => ({
      ...asset,
      workflowRefs: [...asset.workflowRefs].sort((left, right) => compareStrings(`${left.workflowId}:${left.bundleRef}`, `${right.workflowId}:${right.bundleRef}`)),
    }))
    .sort((left, right) => compareStrings(`${left.kind}:${left.logicalRef.logicalId}:${left.id}`, `${right.kind}:${right.logicalRef.logicalId}:${right.id}`));

  return {
    ...bundle,
    manifest: canonicalizeManifest(bundle.manifest),
    assets,
  };
}

function canonicalizeManifest(manifest: PortableAssetManifestV0): PortableAssetManifestV0 {
  return {
    ...manifest,
    assetKinds: [...manifest.assetKinds].sort(compareStrings),
    logicalRefs: [...manifest.logicalRefs].sort((left, right) => compareStrings(`${left.kind}:${left.logicalId}`, `${right.kind}:${right.logicalId}`)),
    workflowRefs: [...manifest.workflowRefs].sort((left, right) => compareStrings(`${left.workflowId}:${left.bundleRef}`, `${right.workflowId}:${right.bundleRef}`)),
    checksums: [...manifest.checksums].sort((left, right) => compareStrings(`${left.algorithm}:${left.digest}`, `${right.algorithm}:${right.digest}`)),
    importRequirements: [...manifest.importRequirements].sort((left, right) => compareStrings(left.code, right.code)),
    redactionSummary: {
      ...manifest.redactionSummary,
      redactedFields: [...manifest.redactionSummary.redactedFields].sort(compareStrings),
      redactedRefKinds: [...manifest.redactionSummary.redactedRefKinds].sort(compareStrings),
      excludedContent: [...manifest.redactionSummary.excludedContent].sort(compareStrings),
    },
  };
}

function sha256Checksum(value: unknown): PortableChecksumV0 {
  return {
    algorithm: "sha256",
    digest: createHash("sha256").update(stableStringify(value)).digest("hex"),
  };
}

function stableStringify(value: unknown): string {
  return JSON.stringify(sortValue(value));
}

function sortValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((entry) => sortValue(entry));
  }
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value)
        .sort(([left], [right]) => compareStrings(left, right))
        .map(([key, entry]) => [key, sortValue(entry)]),
    );
  }
  return value;
}

function compareStrings(left: string, right: string): number {
  return left.localeCompare(right, "en");
}

export { DEFAULT_BUNDLE_TARGET };
