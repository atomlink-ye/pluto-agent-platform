// Portability contract barrel - re-exports all public API
export * from "./portability-schema.js";

export {
  toPortableAssetLogicalRefV0,
  toPortableWorkflowBundleRefV0,
  toEvidenceSummaryExportV0,
  validatePortableAssetBundleV0,
  validatePortableAssetManifestV0,
  validateDocumentExportV0,
  validateTemplateExportV0,
  validatePublishPackageExportV0,
  validateEvidenceSummaryExportV0,
  validateRedactionSummaryV0,
  validateImportRequirementV0,
  validatePortabilityConflictV0,
  assertPortableAssetBundleSafe,
} from "./portability-validate.js";

// Re-export validation result types from schema for convenience
export type {
  PortabilityValidationError,
  PortabilityValidationSuccess,
  PortabilityValidationResult,
} from "./portability-schema.js";