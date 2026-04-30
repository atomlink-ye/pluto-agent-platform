import { describe, expect, it } from "vitest";

import {
  toGovernedDocumentRefV0,
  toGovernedPublishPackageRefV0,
  toGovernedVersionRefV0,
  validateAuditExportManifestV0,
  validateComplianceActionEventV0,
  validateComplianceEvidenceV0,
  validateDeletionAttemptV0,
  validateLegalHoldV0,
  validateRetentionPolicyV0,
} from "@/contracts/compliance.js";

const documentRef = toGovernedDocumentRefV0({ documentId: "doc-1", workspaceId: "workspace-1" });
const versionRef = toGovernedVersionRefV0({ documentId: "doc-1", versionId: "ver-1", workspaceId: "workspace-1" });
const publishPackageRef = toGovernedPublishPackageRefV0({
  id: "pkg-1",
  workspaceId: "workspace-1",
  documentId: "doc-1",
  versionId: "ver-1",
});

describe("compliance contracts", () => {
  it("requires schema markers, stable ids, governed refs, and timestamps across v0 records", () => {
    expect(validateRetentionPolicyV0({
      schema: "pluto.compliance.retention-policy",
      schemaVersion: 0,
      id: "policy-1",
      workspaceId: "workspace-1",
      status: "active",
      retentionClass: "regulated",
      governedRefs: [documentRef, versionRef],
      assignedById: "user-1",
      effectiveAt: "2026-04-30T00:00:00.000Z",
      retainUntil: null,
      summary: "Regulated records remain retained until explicitly superseded.",
    }).ok).toBe(true);

    expect(validateLegalHoldV0({
      schema: "pluto.compliance.legal-hold",
      schemaVersion: 0,
      id: "hold-1",
      workspaceId: "workspace-1",
      status: "placed",
      governedRefs: [publishPackageRef],
      placedById: "custodian-1",
      placedAt: "2026-04-30T00:01:00.000Z",
      releasedAt: null,
      releaseReviewRef: null,
      releaseApprovalRef: null,
      reason: "Preserve the release package during review.",
      summary: "Local legal hold is active.",
    }).ok).toBe(true);

    expect(validateDeletionAttemptV0({
      schema: "pluto.compliance.deletion-attempt",
      schemaVersion: 0,
      id: "delete-1",
      workspaceId: "workspace-1",
      targetRef: publishPackageRef,
      requestedById: "user-2",
      requestedAt: "2026-04-30T00:02:00.000Z",
      mode: "hard_delete",
      outcome: "blocked",
      blockReason: "active_legal_hold",
      evidenceRefs: ["compliance-evidence-1"],
      summary: "Blocked while the regulated package remains on hold.",
      recordedAt: "2026-04-30T00:02:01.000Z",
    }).ok).toBe(true);

    expect(validateComplianceEvidenceV0({
      schema: "pluto.compliance.evidence",
      schemaVersion: 0,
      id: "compliance-evidence-1",
      workspaceId: "workspace-1",
      subjectRef: publishPackageRef,
      supportingRefs: [documentRef, versionRef],
      evidenceRefs: ["sealed-evidence-1"],
      summary: "Readiness and approval evidence satisfy the regulated publish gate.",
      validationOutcome: "pass",
      recordedById: "reviewer-1",
      recordedAt: "2026-04-30T00:03:00.000Z",
    }).ok).toBe(true);

    expect(validateAuditExportManifestV0({
      schema: "pluto.compliance.audit-export-manifest",
      schemaVersion: 0,
      id: "manifest-1",
      workspaceId: "workspace-1",
      status: "generated",
      governedChain: [documentRef, versionRef, publishPackageRef],
      evidenceRefs: ["compliance-evidence-1", "sealed-evidence-1"],
      complianceEventRefs: ["compliance-event-1"],
      createdById: "exporter-1",
      createdAt: "2026-04-30T00:04:00.000Z",
      retentionSummary: { policyIds: ["policy-1"], summary: "Regulated retention remains active." },
      holdSummary: { holdIds: ["hold-1"], summary: "One active legal hold is present." },
      checksumSummary: { algorithm: "sha256", digest: "manifest-checksum-1" },
      recipient: { name: "Internal audit", deliveryMethod: "download", destination: null },
      localSignature: { status: "signed", signedAt: "2026-04-30T00:04:30.000Z", sealId: "seal-1" },
    }).ok).toBe(true);

    expect(validateComplianceActionEventV0({
      schema: "pluto.compliance.action-event",
      schemaVersion: 0,
      id: "compliance-event-1",
      workspaceId: "workspace-1",
      action: "audit_export_generated",
      outcome: "generated",
      actorId: "exporter-1",
      subjectRef: publishPackageRef,
      recordId: "manifest-1",
      evidenceRefs: ["compliance-evidence-1"],
      occurredAt: "2026-04-30T00:04:00.000Z",
      summary: "Generated a local-only audit export manifest.",
    }).ok).toBe(true);
  });

  it("rejects missing stable ids inside governed refs", () => {
    const result = validateComplianceEvidenceV0({
      schema: "pluto.compliance.evidence",
      schemaVersion: 0,
      id: "compliance-evidence-2",
      workspaceId: "workspace-1",
      subjectRef: {
        schemaVersion: 0,
        kind: "publish_package",
        documentId: "doc-1",
        versionId: "ver-1",
        packageId: "pkg-1",
      },
      supportingRefs: [],
      evidenceRefs: ["sealed-evidence-1"],
      summary: "Missing stable id should fail validation.",
      validationOutcome: "pass",
      recordedById: "reviewer-1",
      recordedAt: "2026-04-30T00:03:00.000Z",
    });

    expect(result.ok).toBe(false);
    expect(result.ok ? [] : result.errors).toContain("subjectRef.stableId must be a string");
  });

  it("tolerates additive future fields", () => {
    const result = validateRetentionPolicyV0({
      schema: "pluto.compliance.retention-policy",
      schemaVersion: 0,
      id: "policy-2",
      workspaceId: "workspace-1",
      status: "active",
      retentionClass: "fixed_term",
      governedRefs: [documentRef],
      assignedById: "user-1",
      effectiveAt: "2026-04-30T00:00:00.000Z",
      retainUntil: "2026-12-31T00:00:00.000Z",
      summary: "Fixed-term policy.",
      futureField: { additive: true },
    });

    expect(result.ok).toBe(true);
  });
});
