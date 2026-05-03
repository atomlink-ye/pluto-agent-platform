import type { CitationKindLikeV0 } from "./evidence-graph.js";
import type { EvidenceValidationOutcomeV0 } from "./governance.js";
import type { ChannelTargetStatusLikeV0 } from "./publish.js";
import type {
  CompatibilityDependencyRefV0,
  CompatibilitySupportMatrixV0,
  SchemaVersionRefV0,
} from "../versioning/contracts.js";

export const PORTABLE_ASSET_KINDS_V0 = [
  "document",
  "template",
  "publish_package",
  "evidence_summary",
] as const;

export const PORTABILITY_CONFLICT_RESOLUTIONS_V0 = ["duplicate", "fork", "map", "reject"] as const;

export const PORTABILITY_CONFLICT_OUTCOMES_V0 = [
  "created_as_draft",
  "created_as_fork",
  "rejected",
] as const;

export type PortableAssetKindV0 = typeof PORTABLE_ASSET_KINDS_V0[number];
export type PortableAssetKindLikeV0 = PortableAssetKindV0 | (string & {});
export type PortabilityConflictResolutionV0 = typeof PORTABILITY_CONFLICT_RESOLUTIONS_V0[number];
export type PortabilityConflictResolutionLikeV0 = PortabilityConflictResolutionV0 | (string & {});
export type PortabilityConflictOutcomeV0 = typeof PORTABILITY_CONFLICT_OUTCOMES_V0[number];
export type PortabilityConflictOutcomeLikeV0 = PortabilityConflictOutcomeV0 | (string & {});

export interface PortableChecksumV0 {
  algorithm: "sha256" | (string & {});
  digest: string;
}

export interface PortableAssetLogicalRefV0 {
  kind: PortableAssetKindLikeV0;
  logicalId: string;
  sourceDocumentId?: string;
  sourceVersionId?: string;
  sourceTemplateId?: string;
  sourcePublishPackageId?: string;
}

export interface PortableWorkflowBundleRefV0 {
  kind: "portable_workflow_bundle";
  workflowId: string;
  bundleRef: string;
}

export interface RedactionSummaryV0 {
  schema: "pluto.portability.redaction-summary";
  schemaVersion: 0;
  redactedFields: string[];
  redactedRefKinds: string[];
  excludedContent: string[];
  summary: string;
}

export type PortabilityRedactionSummaryV0 = RedactionSummaryV0;

export interface ImportRequirementV0 {
  schema: "pluto.portability.import-requirement";
  schemaVersion: 0;
  code: string;
  required: boolean;
  description: string;
  secretNames?: string[];
  capabilityRefs?: string[];
  minimumBundleVersion?: string;
}

export interface PortableCompatibilityMetadataV0 {
  schemaVersion: 0;
  bundle: SchemaVersionRefV0;
  target: CompatibilitySupportMatrixV0;
  dependencies: CompatibilityDependencyRefV0[];
}

interface PortableAssetExportBaseV0<K extends PortableAssetKindV0, S extends string> {
  schema: S;
  schemaVersion: 0;
  kind: K;
  id: string;
  logicalRef: PortableAssetLogicalRefV0;
  title: string;
  createdAt: string;
  exportedAt: string;
  workflowRefs: PortableWorkflowBundleRefV0[];
  compatibility: PortableCompatibilityMetadataV0;
  checksum: PortableChecksumV0;
  redactionSummary: RedactionSummaryV0;
}

export interface DocumentExportV0 extends PortableAssetExportBaseV0<"document", "pluto.portability.document-export"> {
  content: {
    format: "markdown" | "json" | (string & {});
    body: string;
  };
  metadata: {
    label?: string;
    tags: string[];
    lineageRefs: string[];
  };
}

export interface TemplateExportV0 extends PortableAssetExportBaseV0<"template", "pluto.portability.template-export"> {
  template: {
    body: string;
    variables: string[];
    outputFormat: string;
  };
  metadata: {
    category: string;
    lineageRefs: string[];
  };
}

export interface PublishPackageExportV0 extends PortableAssetExportBaseV0<"publish_package", "pluto.portability.publish-package-export"> {
  publishPackage: {
    channelTargets: Array<{
      channelId: string;
      targetId: string;
      status: ChannelTargetStatusLikeV0;
      destinationSummary: string;
    }>;
    sourceVersionRefs: string[];
    sealedEvidenceRefs: string[];
  };
}

export interface EvidenceSummaryExportV0 extends PortableAssetExportBaseV0<"evidence_summary", "pluto.portability.evidence-summary-export"> {
  evidence: {
    sealedEvidenceId: string;
    citationRefs: Array<{
      citationId: string;
      citationKind: CitationKindLikeV0;
      locator: string;
      summary: string;
    }>;
    validation: {
      outcome: EvidenceValidationOutcomeV0;
      reason: string | null;
    };
    readiness: {
      status: "ready" | "blocked" | "degraded" | (string & {});
      blockedReasons: string[];
      summary: string;
    };
  };
}

export type PortableAssetExportV0 =
  | DocumentExportV0
  | TemplateExportV0
  | PublishPackageExportV0
  | EvidenceSummaryExportV0;

export interface PortableAssetManifestV0 {
  schema: "pluto.portability.manifest";
  schemaVersion: 0;
  bundleId: string;
  bundleVersion: string;
  exportedAt: string;
  assetKinds: PortableAssetKindLikeV0[];
  logicalRefs: PortableAssetLogicalRefV0[];
  workflowRefs: PortableWorkflowBundleRefV0[];
  compatibility: PortableCompatibilityMetadataV0;
  checksums: PortableChecksumV0[];
  importRequirements: ImportRequirementV0[];
  redactionSummary: RedactionSummaryV0;
}

export interface PortableAssetBundleV0 {
  schema: "pluto.portability.bundle";
  schemaVersion: 0;
  bundleId: string;
  manifest: PortableAssetManifestV0;
  assets: PortableAssetExportV0[];
}

export interface PortabilityConflictV0 {
  schema: "pluto.portability.conflict";
  schemaVersion: 0;
  code: string;
  message: string;
  assetKind: PortableAssetKindLikeV0;
  incomingLogicalId: string;
  existingLogicalId: string;
  resolution: PortabilityConflictResolutionLikeV0;
  outcome: PortabilityConflictOutcomeLikeV0;
}

export interface PortabilityValidationError {
  ok: false;
  errors: string[];
}

export interface PortabilityValidationSuccess<T> {
  ok: true;
  value: T;
}

export type PortabilityValidationResult<T> =
  | PortabilityValidationSuccess<T>
  | PortabilityValidationError;