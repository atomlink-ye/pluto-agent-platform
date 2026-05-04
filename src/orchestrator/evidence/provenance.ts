import type {
  ProvenancePinRef,
  WorkerContribution,
  WorkerContributionProvenancePins,
} from "../../contracts/types.js";

export function extractContributionProvenance(
  contribution: WorkerContribution | undefined,
): WorkerContributionProvenancePins {
  if (!contribution) {
    return {};
  }

  return {
    ...(contribution.workerRoleRef ? { workerRoleRef: cloneRef(contribution.workerRoleRef) } : {}),
    ...(contribution.skillRef ? { skillRef: cloneRef(contribution.skillRef) } : {}),
    ...(contribution.templateRef ? { templateRef: cloneRef(contribution.templateRef) } : {}),
    ...(contribution.policyPackRefs ? { policyPackRefs: contribution.policyPackRefs.map(cloneRef) } : {}),
    ...(contribution.catalogEntryRef ? { catalogEntryRef: cloneRef(contribution.catalogEntryRef) } : {}),
    ...(contribution.extensionInstallRef !== undefined
      ? { extensionInstallRef: contribution.extensionInstallRef }
      : {}),
  };
}

export function extractCatalogSelectionProvenance(selection: unknown): WorkerContributionProvenancePins {
  if (typeof selection !== "object" || selection === null) {
    return {};
  }

  const candidate = selection as Record<string, unknown>;
  const workerRoleRef = readProvenanceRef(candidate["workerRole"]);
  const skillRef = readProvenanceRef(candidate["skill"]);
  const templateRef = readProvenanceRef(candidate["template"]);
  const policyPackRef = readProvenanceRef(candidate["policyPack"]);
  const catalogEntryRef = readProvenanceRef(candidate["entry"]);

  return {
    ...(workerRoleRef ? { workerRoleRef } : {}),
    ...(skillRef ? { skillRef } : {}),
    ...(templateRef ? { templateRef } : {}),
    ...(policyPackRef ? { policyPackRefs: [policyPackRef] } : {}),
    ...(catalogEntryRef ? { catalogEntryRef } : {}),
  };
}

export function readProvenanceRef(value: unknown): ProvenancePinRef | undefined {
  if (typeof value !== "object" || value === null) {
    return undefined;
  }

  const ref = value as Record<string, unknown>;
  if (typeof ref["id"] !== "string" || typeof ref["version"] !== "string") {
    return undefined;
  }

  return { id: ref["id"], version: ref["version"] };
}

export function mergeProvenancePins(
  primary: WorkerContributionProvenancePins,
  fallback: WorkerContributionProvenancePins,
): WorkerContributionProvenancePins {
  return {
    ...(fallback.workerRoleRef ? { workerRoleRef: cloneRef(fallback.workerRoleRef) } : {}),
    ...(fallback.skillRef ? { skillRef: cloneRef(fallback.skillRef) } : {}),
    ...(fallback.templateRef ? { templateRef: cloneRef(fallback.templateRef) } : {}),
    ...(fallback.policyPackRefs ? { policyPackRefs: fallback.policyPackRefs.map(cloneRef) } : {}),
    ...(fallback.catalogEntryRef ? { catalogEntryRef: cloneRef(fallback.catalogEntryRef) } : {}),
    ...(fallback.extensionInstallRef !== undefined ? { extensionInstallRef: fallback.extensionInstallRef } : {}),
    ...(primary.workerRoleRef ? { workerRoleRef: cloneRef(primary.workerRoleRef) } : {}),
    ...(primary.skillRef ? { skillRef: cloneRef(primary.skillRef) } : {}),
    ...(primary.templateRef ? { templateRef: cloneRef(primary.templateRef) } : {}),
    ...(primary.policyPackRefs ? { policyPackRefs: primary.policyPackRefs.map(cloneRef) } : {}),
    ...(primary.catalogEntryRef ? { catalogEntryRef: cloneRef(primary.catalogEntryRef) } : {}),
    ...(primary.extensionInstallRef !== undefined ? { extensionInstallRef: primary.extensionInstallRef } : {}),
  };
}

export function cloneRef(ref: ProvenancePinRef): ProvenancePinRef {
  return { id: ref.id, version: ref.version };
}
