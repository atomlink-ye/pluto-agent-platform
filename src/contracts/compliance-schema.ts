import type { SealedEvidenceRefV0 } from "./evidence-graph.js";
import type { PublishPackageRecordV0 } from "./publish.js";
import type { ApprovalRequestV0, ReviewRequestV0 } from "./review.js";

import type { GovernanceRecordValidationResult } from "./governance.js";

export const COMPLIANCE_STATUSES_V0 = [
  "draft",
  "active",
  "suspended",
  "superseded",
  "placed",
  "under_review",
  "released",
  "expired",
  "blocked",
  "allowed",
  "completed",
  "failed",
  "generated",
  "signed",
  "delivered",
  "acknowledged",
  "succeeded",
] as const;

export const COMPLIANCE_ACTIONS_V0 = [
  "retention_assigned",
  "retention_changed",
  "legal_hold_placed",
  "legal_hold_released",
  "deletion_allowed",
  "deletion_blocked",
  "audit_export_generated",
  "audit_export_signed",
  "audit_export_delivered",
  "compliance_approved",
  "regulated_publish_allowed",
  "regulated_publish_blocked",
] as const;

export const COMPLIANCE_GOVERNED_OBJECT_KINDS_V0 = [
  "document",
  "version",
  "review",
  "approval",
  "publish_package",
  "sealed_evidence",
] as const;

export const REGULATED_PUBLISH_GATE_BLOCKED_REASONS_V0 = ["missing_compliance_evidence"] as const;

export const COMPLIANCE_RETENTION_CLASSES_V0 = ["fixed_term", "indefinite", "regulated"] as const;
export const DELETION_MODES_V0 = ["soft_delete", "hard_delete"] as const;

export type ComplianceStatusV0 = typeof COMPLIANCE_STATUSES_V0[number];
export type ComplianceStatusLikeV0 = ComplianceStatusV0 | "done" | (string & {});
export type ComplianceActionV0 = typeof COMPLIANCE_ACTIONS_V0[number];
export type ComplianceActionLikeV0 = ComplianceActionV0 | (string & {});
export type ComplianceActionEventLikeV0 = ComplianceActionLikeV0;
export type ComplianceRetentionClassV0 = typeof COMPLIANCE_RETENTION_CLASSES_V0[number];
export type ComplianceRetentionClassLikeV0 = ComplianceRetentionClassV0 | (string & {});
export type DeletionModeV0 = typeof DELETION_MODES_V0[number];
export type DeletionModeLikeV0 = DeletionModeV0 | (string & {});
export type ComplianceGovernedObjectKindV0 = typeof COMPLIANCE_GOVERNED_OBJECT_KINDS_V0[number];
export type ComplianceGovernedObjectKindLikeV0 = ComplianceGovernedObjectKindV0 | (string & {});
export type RegulatedPublishGateBlockedReasonV0 = typeof REGULATED_PUBLISH_GATE_BLOCKED_REASONS_V0[number] | (string & {});

interface GovernedObjectRefBaseV0<K extends string> {
  schemaVersion: 0;
  kind: K;
  stableId: string;
  workspaceId?: string;
  summary?: string;
}

export interface GovernedDocumentRefV0 extends GovernedObjectRefBaseV0<"document"> {
  documentId: string;
}

export interface GovernedVersionRefV0 extends GovernedObjectRefBaseV0<"version"> {
  documentId: string;
  versionId: string;
}

export interface GovernedReviewRefV0 extends GovernedObjectRefBaseV0<"review"> {
  documentId: string;
  versionId: string;
  reviewId: string;
}

export interface GovernedApprovalRefV0 extends GovernedObjectRefBaseV0<"approval"> {
  documentId: string;
  versionId: string;
  approvalId: string;
}

export interface GovernedPublishPackageRefV0 extends GovernedObjectRefBaseV0<"publish_package"> {
  documentId: string;
  versionId: string;
  packageId: string;
}

export interface GovernedSealedEvidenceRefV0 extends GovernedObjectRefBaseV0<"sealed_evidence"> {
  runId: string;
  evidenceId: string;
  packetId: string;
}

export type GovernedObjectRefV0 =
  | GovernedDocumentRefV0
  | GovernedVersionRefV0
  | GovernedReviewRefV0
  | GovernedApprovalRefV0
  | GovernedPublishPackageRefV0
  | GovernedSealedEvidenceRefV0;

export type ComplianceDocumentRefV0 = GovernedDocumentRefV0;
export type ComplianceVersionRefV0 = GovernedVersionRefV0;
export type ComplianceReviewRefV0 = GovernedReviewRefV0;
export type ComplianceApprovalRefV0 = GovernedApprovalRefV0;
export type CompliancePublishPackageRefV0 = GovernedPublishPackageRefV0;
export type ComplianceSealedEvidenceRefV0 = GovernedSealedEvidenceRefV0;
export type ComplianceGovernedObjectRefV0 = GovernedObjectRefV0;

export interface ComplianceEvidenceSummaryV0 {
  evidenceId: string;
  summary: string;
  validationOutcome?: string;
}

export interface RetentionPolicyV0 {
  schema: "pluto.compliance.retention-policy";
  schemaVersion: 0;
  id: string;
  workspaceId: string;
  status: ComplianceStatusLikeV0;
  retentionClass: ComplianceRetentionClassLikeV0;
  governedRefs: GovernedObjectRefV0[];
  assignedById: string;
  effectiveAt: string;
  retainUntil: string | null;
  summary: string;
}

export interface LegalHoldV0 {
  schema: "pluto.compliance.legal-hold";
  schemaVersion: 0;
  id: string;
  workspaceId: string;
  status: ComplianceStatusLikeV0;
  governedRefs: GovernedObjectRefV0[];
  placedById: string;
  placedAt: string;
  releasedAt: string | null;
  releaseReviewRef: string | null;
  releaseApprovalRef: string | null;
  reason: string;
  summary: string;
}

export interface DeletionAttemptV0 {
  schema: "pluto.compliance.deletion-attempt";
  schemaVersion: 0;
  id: string;
  workspaceId: string;
  targetRef: GovernedObjectRefV0;
  requestedById: string;
  requestedAt: string;
  mode: DeletionModeLikeV0;
  outcome: ComplianceStatusLikeV0;
  blockReason: string | null;
  evidenceRefs: string[];
  summary: string;
  recordedAt: string;
}

export interface ComplianceEvidenceV0 {
  schema: "pluto.compliance.evidence";
  schemaVersion: 0;
  id: string;
  workspaceId: string;
  subjectRef: GovernedObjectRefV0;
  supportingRefs: GovernedObjectRefV0[];
  evidenceRefs: string[];
  summary: string;
  validationOutcome: string;
  recordedById: string;
  recordedAt: string;
}

export interface AuditExportManifestV0 {
  schema: "pluto.compliance.audit-export-manifest";
  schemaVersion: 0;
  id: string;
  workspaceId: string;
  status: ComplianceStatusLikeV0;
  governedChain: GovernedObjectRefV0[];
  evidenceRefs: string[];
  complianceEventRefs: string[];
  createdById: string;
  createdAt: string;
  retentionSummary: {
    policyIds: string[];
    summary: string;
  };
  holdSummary: {
    holdIds: string[];
    summary: string;
  };
  checksumSummary: {
    algorithm: string;
    digest: string;
  };
  recipient: {
    name: string;
    deliveryMethod: string;
    destination: string | null;
  };
  localSignature: {
    status: ComplianceStatusLikeV0;
    signedAt: string | null;
    sealId: string;
  };
}

export interface ComplianceActionEventV0 {
  schema: "pluto.compliance.action-event";
  schemaVersion: 0;
  id: string;
  workspaceId: string;
  action: ComplianceActionLikeV0;
  outcome: ComplianceStatusLikeV0;
  actorId: string;
  subjectRef: GovernedObjectRefV0;
  recordId: string | null;
  evidenceRefs: string[];
  occurredAt: string;
  summary: string;
}

export type ComplianceActionEventRecordV0 = ComplianceActionEventV0;

export interface RegulatedPublishDecisionV0 {
  schema: "pluto.compliance.regulated-publish-decision";
  schemaVersion: 0;
  id: string;
  workspaceId: string;
  publishPackageRef: GovernedPublishPackageRefV0;
  status: "allowed" | "blocked";
  blockedReasons: string[];
  evidenceSummaries: ComplianceEvidenceSummaryV0[];
  decidedById: string;
  decidedAt: string;
  event: ComplianceActionEventV0;
}

export type RegulatedPublishGateInputV0 = {
  id: string;
  publishPackage: Pick<PublishPackageRecordV0, "id" | "workspaceId" | "documentId" | "versionId">;
  actorId: string;
  decidedAt: string;
  summary?: string;
  complianceEvidence: readonly ComplianceEvidenceV0[];
};

export type RegulatedPublishGateResultV0 = RegulatedPublishDecisionV0;