import type {
  PortableAssetBundleV0,
  PortableAssetKindV0,
  PortableAssetLogicalRefV0,
} from "../contracts/portability.js";
import { validatePortableAssetBundleV0 } from "../contracts/portability.js";

export interface PortableImportSupportMatrixV0 {
  schemaFamilies: string[];
  schemaVersions: number[];
  capabilityRefs: string[];
  secretNames: string[];
  allowedSensitivityClasses: string[];
  resolvedRefs: string[];
  policy: {
    allowed: boolean;
    reason?: string;
  };
}

export interface PortableImportSensitivityV0 {
  assetLogicalId: string;
  sensitivityClass: string;
}

export interface PortableImportValidationInputV0 {
  support?: PortableImportSupportMatrixV0;
  assetSensitivities?: PortableImportSensitivityV0[];
  requiredRefs?: string[];
}

export interface PortableImportValidationFailureV0 {
  ok: false;
  errors: string[];
}

export interface PortableImportValidationSuccessV0 {
  ok: true;
  value: PortableAssetBundleV0;
}

export type PortableImportValidationResultV0 =
  | PortableImportValidationFailureV0
  | PortableImportValidationSuccessV0;

export function validatePortableBundleImportV0(
  bundle: PortableAssetBundleV0,
  input: PortableImportValidationInputV0,
): PortableImportValidationResultV0 {
  const parsed = validatePortableAssetBundleV0(bundle);
  if (!parsed.ok) {
    return parsed;
  }

  const errors: string[] = [];
  const support = input.support;
  if (!support) {
    return {
      ok: false,
      errors: ["unsupported_schema: import support matrix is required"],
    };
  }

  const bundleSchema = parsed.value.manifest.compatibility.bundle;
  if (!support.schemaFamilies.includes(bundleSchema.family) || !support.schemaVersions.includes(bundleSchema.version)) {
    errors.push(`unsupported_schema: ${bundleSchema.family} v${String(bundleSchema.version)}`);
  }

  const requiredCapabilities = collectRequirementSet(parsed.value, (requirement) => requirement.capabilityRefs ?? []);
  const availableCapabilities = new Set(support.capabilityRefs);
  for (const capability of requiredCapabilities) {
    if (!availableCapabilities.has(capability)) {
      errors.push(`capability_unavailable: ${capability}`);
    }
  }

  const requiredSecrets = collectRequirementSet(parsed.value, (requirement) => requirement.required ? requirement.secretNames ?? [] : []);
  const availableSecrets = new Set(support.secretNames);
  for (const secretName of requiredSecrets) {
    if (!availableSecrets.has(secretName)) {
      errors.push(`missing_secret_name: ${secretName}`);
    }
  }

  const allowedSensitivityClasses = new Set(support.allowedSensitivityClasses);
  const assetSensitivities = new Map((input.assetSensitivities ?? []).map((entry) => [entry.assetLogicalId, entry.sensitivityClass]));
  for (const asset of parsed.value.assets) {
    const logicalId = asset.logicalRef.logicalId;
    const sensitivityClass = assetSensitivities.get(logicalId);
    if (!sensitivityClass) {
      errors.push(`prohibited_sensitivity: missing sensitivity classification for '${logicalId}'`);
      continue;
    }
    if (!allowedSensitivityClasses.has(sensitivityClass)) {
      errors.push(`prohibited_sensitivity: '${logicalId}' has prohibited sensitivity '${sensitivityClass}'`);
    }
  }

  const resolvedRefs = new Set(support.resolvedRefs);
  for (const ref of input.requiredRefs ?? collectBundleRefs(parsed.value)) {
    if (!resolvedRefs.has(ref)) {
      errors.push(`unresolved_ref: ${ref}`);
    }
  }

  if (!support.policy.allowed) {
    errors.push(`policy_conflict: ${support.policy.reason ?? "import policy denied"}`);
  }

  return errors.length > 0 ? { ok: false, errors } : { ok: true, value: parsed.value };
}

function collectRequirementSet(
  bundle: PortableAssetBundleV0,
  select: (requirement: PortableAssetBundleV0["manifest"]["importRequirements"][number]) => string[],
): Set<string> {
  const values = new Set<string>();
  for (const requirement of bundle.manifest.importRequirements) {
    for (const value of select(requirement)) {
      values.add(value);
    }
  }
  return values;
}

function collectBundleRefs(bundle: PortableAssetBundleV0): string[] {
  const refs = new Set<string>();
  for (const workflowRef of bundle.manifest.workflowRefs) {
    refs.add(workflowRef.bundleRef);
  }
  for (const logicalRef of bundle.manifest.logicalRefs) {
    for (const ref of logicalRefSourceRefs(logicalRef)) {
      refs.add(ref);
    }
  }
  return [...refs];
}

function logicalRefSourceRefs(logicalRef: PortableAssetLogicalRefV0): string[] {
  const refs: string[] = [];
  if (logicalRef.sourceDocumentId) {
    refs.push(`document:${logicalRef.sourceDocumentId}`);
  }
  if (logicalRef.sourceVersionId) {
    refs.push(`version:${logicalRef.sourceVersionId}`);
  }
  if (logicalRef.sourceTemplateId) {
    refs.push(`template:${logicalRef.sourceTemplateId}`);
  }
  if (logicalRef.sourcePublishPackageId) {
    refs.push(`publish_package:${logicalRef.sourcePublishPackageId}`);
  }
  return refs;
}

export function toPortableImportAssetSensitivityV0(
  logicalRef: PortableAssetLogicalRefV0,
  sensitivityClass: string,
): PortableImportSensitivityV0 {
  return {
    assetLogicalId: logicalRef.logicalId,
    sensitivityClass,
  };
}

export function toPortableRequiredRefV0(kind: PortableAssetKindV0, id: string): string {
  return `${kind}:${id}`;
}
