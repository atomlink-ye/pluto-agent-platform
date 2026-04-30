export type ExtensionLifecycleStatusV0 = "draft" | "active" | "deprecated" | "revoked";

export type ExtensionInspectionStateV0 = "draft" | "active" | "blocked" | "revoked";

export type ExtensionArtifactKindV0 = "skill" | "template" | "policy";

export type ExtensionAssetKindV0 =
  | "archive"
  | "manifest"
  | "skill"
  | "template"
  | "policy"
  | "icon"
  | "docs";

export type ExtensionInstallStatusV0 = "pending" | "installed" | "blocked" | "removed";

export type ExtensionSignatureStatusV0 = "unsigned" | "recorded" | "verified" | "rejected";

export type TrustVerdictV0 = "pending" | "approved" | "rejected" | "needs_changes";

export interface ExtensionChecksumV0 {
  algorithm: string;
  value: string;
}

export interface ExtensionLifecycleV0 {
  status: ExtensionLifecycleStatusV0;
  channel?: "draft" | "preview" | "stable" | "deprecated";
  createdAt: string;
  updatedAt: string;
  publishedAt?: string | null;
  deprecatedAt?: string | null;
  revokedAt?: string | null;
  replacedBy?: string | null;
}

export interface ExtensionCompatibilityRangeV0 {
  min: string;
  max?: string | null;
}

export interface ExtensionRuntimeCompatibilityV0 {
  pluto: ExtensionCompatibilityRangeV0;
  paseo?: ExtensionCompatibilityRangeV0;
  opencode?: ExtensionCompatibilityRangeV0;
}

export interface ExtensionSourceRefV0 {
  kind: "file" | "url" | "marketplace" | "git";
  location: string;
  digest?: ExtensionChecksumV0;
  ref?: string;
  marketplaceListingId?: string;
}

export interface ExtensionAssetRefV0 {
  assetId: string;
  kind: ExtensionAssetKindV0;
  path: string;
  mediaType: string;
  checksum: ExtensionChecksumV0;
  sizeBytes?: number;
  role?: string;
}

export interface ExtensionPointDeclarationV0 {
  point: string;
  target: string;
  scope: "workspace" | "session" | "runtime" | "policy";
  description: string;
}

export interface ExtensionCapabilityClaimV0 {
  name: string;
  level: "read" | "write" | "exec" | "admin";
  reason: string;
}

export interface ExtensionSecretRefV0 {
  name: string;
  required: boolean;
  reason: string;
}

export interface ExtensionToolSurfaceV0 {
  tool: string;
  access: "read" | "write" | "exec";
  reason: string;
}

export interface ExtensionSensitivityClaimV0 {
  domain: string;
  level: "low" | "moderate" | "high";
  reason: string;
}

export interface ExtensionOutboundWriteClaimV0 {
  target: string;
  access: "create" | "update" | "delete";
  reason: string;
}

export interface ExtensionPostureConstraintV0 {
  name: string;
  mode: "require" | "forbid" | "prefer";
  value: string;
  reason: string;
}

export interface ExtensionManifestContributionBaseV0 {
  kind: ExtensionArtifactKindV0;
  id: string;
  name: string;
  version: string;
  description: string;
  entrypoint: string;
  assetRef: string;
  extensionPoints: string[];
}

export interface ExtensionSkillDeclarationV0 extends ExtensionManifestContributionBaseV0 {
  kind: "skill";
  toolSurface: string[];
  capabilityNames: string[];
  secretNames: string[];
}

export interface ExtensionTemplateDeclarationV0 extends ExtensionManifestContributionBaseV0 {
  kind: "template";
  language: string;
  inputSchema: Record<string, unknown>;
  outputSchema?: Record<string, unknown>;
}

export interface ExtensionPolicyDeclarationV0 extends ExtensionManifestContributionBaseV0 {
  kind: "policy";
  appliesTo: string[];
  ruleIds: string[];
}

export interface ExtensionManifestV0 {
  schemaVersion: 0;
  extensionId: string;
  name: string;
  version: string;
  description: string;
  publisher: {
    name: string;
    url?: string;
  };
  homepage?: string;
  repository?: string;
  license: string;
  keywords: string[];
  assets: ExtensionAssetRefV0[];
  extensionPoints: ExtensionPointDeclarationV0[];
  compatibility: ExtensionRuntimeCompatibilityV0;
  capabilities: ExtensionCapabilityClaimV0[];
  secretNames: ExtensionSecretRefV0[];
  toolSurfaces: ExtensionToolSurfaceV0[];
  sensitivityClaims: ExtensionSensitivityClaimV0[];
  outboundWriteClaims: ExtensionOutboundWriteClaimV0[];
  postureConstraints: ExtensionPostureConstraintV0[];
  contributions: {
    skills: ExtensionSkillDeclarationV0[];
    templates: ExtensionTemplateDeclarationV0[];
    policies: ExtensionPolicyDeclarationV0[];
  };
  lifecycle: ExtensionLifecycleV0;
}

export interface ExtensionPackageV0 {
  schemaVersion: 0;
  packageId: string;
  extensionId: string;
  version: string;
  source: ExtensionSourceRefV0;
  checksum: ExtensionChecksumV0;
  assetRefs: string[];
  manifest: ExtensionManifestV0;
  lifecycle: ExtensionLifecycleV0;
  signature: ExtensionSignatureV0;
}

export interface ExtensionInstallV0 {
  schemaVersion: 0;
  installId: string;
  extensionId: string;
  version: string;
  status: ExtensionInstallStatusV0;
  requestedAt: string;
  installedAt: string | null;
  removedAt?: string | null;
  installedPath: string;
  requestedBy: string;
  source: ExtensionSourceRefV0;
  packageId: string;
  checksum: ExtensionChecksumV0;
  manifest: ExtensionManifestV0;
  lifecycle: ExtensionLifecycleV0;
  signature: ExtensionSignatureV0;
  trustReview: TrustReviewV0 | null;
}

export interface ExtensionSignatureV0 {
  schemaVersion: 0;
  status: ExtensionSignatureStatusV0;
  signatureAlgorithm: string | null;
  digest: ExtensionChecksumV0;
  signer: {
    id: string;
    displayName: string;
  } | null;
  provenance: {
    source: "publisher" | "marketplace" | "operator" | "unknown";
    origin: string;
    verifiedAt: string | null;
    transparencyLogUrl?: string;
  };
  recordedAt: string;
}

export interface TrustReviewV0 {
  schemaVersion: 0;
  reviewId: string;
  extensionId: string;
  version: string;
  packageId: string;
  verdict: TrustVerdictV0;
  privilegedCapabilities: string[];
  reviewer: {
    id: string;
    displayName: string;
  };
  reason: string | null;
  reviewedAt: string;
  provenance: {
    source: ExtensionSourceRefV0["kind"];
    location: string;
    digest: ExtensionChecksumV0;
  };
  lifecycle: Pick<ExtensionLifecycleV0, "status" | "publishedAt" | "deprecatedAt" | "revokedAt">;
  evidence: {
    signatureStatus: ExtensionSignatureStatusV0;
    capabilityNames: string[];
    toolNames: string[];
    secretNames: string[];
    postureConstraintNames: string[];
    outboundTargets: string[];
  };
}

export interface MarketplaceListingV0 {
  schemaVersion: 0;
  listingId: string;
  extensionId: string;
  packageId: string;
  name: string;
  summary: string;
  publisherName: string;
  latestVersion: string;
  latestManifestVersion: string;
  categories: string[];
  keywords: string[];
  source: ExtensionSourceRefV0;
  compatibility: ExtensionRuntimeCompatibilityV0;
  assetRefs: string[];
  lifecycle: ExtensionLifecycleV0;
  provenance: {
    publishedBy: string;
    publishedAt: string;
    sourceDigest: ExtensionChecksumV0;
  };
  trust: {
    signatureStatus: ExtensionSignatureStatusV0;
    reviewVerdict: TrustVerdictV0 | null;
    reviewedAt: string | null;
  };
}

export const EXTENSION_KINDS = ["packages", "installs", "trust-reviews", "signatures", "marketplace-listings"] as const;

export type ExtensionRecordByKind = {
  packages: ExtensionPackageV0;
  installs: ExtensionInstallV0;
  "trust-reviews": TrustReviewV0;
  signatures: ExtensionSignatureV0;
  "marketplace-listings": MarketplaceListingV0;
};

export type ExtensionKind = keyof ExtensionRecordByKind;

export type ExtensionRecord = ExtensionRecordByKind[ExtensionKind];

export interface ExtensionListItemV0 {
  installId: string;
  extensionId: string;
  version: string;
  state: ExtensionInspectionStateV0;
  status: ExtensionInstallStatusV0;
  lifecycleStatus: ExtensionLifecycleStatusV0;
  packageId: string;
  installedPath: string;
  requestedBy: string;
  trustVerdict: TrustVerdictV0 | null;
  signatureStatus: ExtensionSignatureStatusV0;
  provenanceSource: ExtensionSignatureV0["provenance"]["source"];
  provenanceOrigin: string;
}

export interface ExtensionListOutputV0 {
  schema: "pluto.extensions.list-output";
  schemaVersion: 0;
  items: ExtensionListItemV0[];
}
