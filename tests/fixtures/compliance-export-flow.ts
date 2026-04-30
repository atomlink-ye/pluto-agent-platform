import { ComplianceStore } from "@/compliance/compliance-store.js";
import { toGovernedPublishPackageRefV0 } from "@/contracts/compliance.js";
import { CatalogStore } from "@/catalog/catalog-store.js";
import { REVIEW_PUBLISH_RELEASE_FIXTURE_IDS, REVIEW_PUBLISH_RELEASE_FIXTURE_TIMESTAMPS } from "@/governance/seed.js";

import { seedReviewPublishReleaseScenario } from "./review-publish-release.js";

export const COMPLIANCE_EXPORT_FLOW_IDS = {
  manifestId: "manifest-review-publish-release",
  bundleId: "bundle-review-publish-release",
  retentionPolicyId: "policy-review-publish-release",
  legalHoldId: "hold-review-publish-release",
  complianceEvidenceId: "evidence-review-publish-release",
  templateId: "template-review-publish-release",
} as const;

export interface ComplianceExportFlowOptions {
  retentionStatus?: "completed" | "active" | "none";
  legalHoldStatus?: "released" | "placed" | "none";
}

export async function seedComplianceExportFlow(
  dataDir: string,
  options: ComplianceExportFlowOptions = {},
): Promise<typeof COMPLIANCE_EXPORT_FLOW_IDS> {
  await seedReviewPublishReleaseScenario(dataDir, "successful");
  const complianceStore = new ComplianceStore({ dataDir });
  const catalogStore = new CatalogStore({ dataDir });
  const retentionStatus = options.retentionStatus ?? "completed";
  const legalHoldStatus = options.legalHoldStatus ?? "released";

  await catalogStore.upsert("templates", COMPLIANCE_EXPORT_FLOW_IDS.templateId, {
    schema: "pluto.catalog.template",
    schemaVersion: 0,
    id: COMPLIANCE_EXPORT_FLOW_IDS.templateId,
    version: "0.1.0",
    status: "active",
    name: "Compliance export template",
    description: "Template fixture for portability export coverage.",
    body: "# Compliance Export\n\n{{summary}}",
    format: "markdown",
    targetKind: "artifact",
    variables: [{ name: "summary", required: true, description: "Portable export summary." }],
    versionMetadata: {
      channel: "stable",
      revision: 1,
      updatedAt: REVIEW_PUBLISH_RELEASE_FIXTURE_TIMESTAMPS.documentCreatedAt,
    },
    labels: ["compliance", "portability"],
    metadata: { fixture: "compliance-export-flow" },
  });

  const targetRef = toGovernedPublishPackageRefV0({
    id: REVIEW_PUBLISH_RELEASE_FIXTURE_IDS.publishPackageId,
    workspaceId: "workspace-default-governance",
    documentId: REVIEW_PUBLISH_RELEASE_FIXTURE_IDS.documentId,
    versionId: REVIEW_PUBLISH_RELEASE_FIXTURE_IDS.versionId,
    summary: "Governed publish package fixture",
  });

  if (retentionStatus !== "none") {
    await complianceStore.put("retention_policy", {
      schema: "pluto.compliance.retention-policy",
      schemaVersion: 0,
      id: COMPLIANCE_EXPORT_FLOW_IDS.retentionPolicyId,
      workspaceId: "workspace-default-governance",
      status: retentionStatus,
      retentionClass: "fixed_term",
      governedRefs: [targetRef],
      assignedById: "seed-default-governance",
      effectiveAt: REVIEW_PUBLISH_RELEASE_FIXTURE_TIMESTAMPS.documentCreatedAt,
      retainUntil: retentionStatus === "active" ? "2026-04-30T01:00:00.000Z" : null,
      summary: retentionStatus === "active"
        ? "Retention remains active for the governed publish package."
        : "Retention requirements were satisfied before export.",
    });
  }

  if (legalHoldStatus !== "none") {
    await complianceStore.put("legal_hold", {
      schema: "pluto.compliance.legal-hold",
      schemaVersion: 0,
      id: COMPLIANCE_EXPORT_FLOW_IDS.legalHoldId,
      workspaceId: "workspace-default-governance",
      status: legalHoldStatus,
      governedRefs: [targetRef],
      placedById: "custodian-default-governance",
      placedAt: REVIEW_PUBLISH_RELEASE_FIXTURE_TIMESTAMPS.requestCreatedAt,
      releasedAt: legalHoldStatus === "placed" ? null : REVIEW_PUBLISH_RELEASE_FIXTURE_TIMESTAMPS.approvalDecisionAt,
      releaseReviewRef: legalHoldStatus === "placed" ? null : REVIEW_PUBLISH_RELEASE_FIXTURE_IDS.governanceReviewId,
      releaseApprovalRef: legalHoldStatus === "placed" ? null : REVIEW_PUBLISH_RELEASE_FIXTURE_IDS.governanceApprovalId,
      reason: "Preserve release evidence for audit review.",
      summary: legalHoldStatus === "placed"
        ? "An active legal hold preserves the governed release package."
        : "A prior legal hold was released before export.",
    });
  }

  await complianceStore.put("evidence", {
    schema: "pluto.compliance.evidence",
    schemaVersion: 0,
    id: COMPLIANCE_EXPORT_FLOW_IDS.complianceEvidenceId,
    workspaceId: "workspace-default-governance",
    subjectRef: targetRef,
    supportingRefs: [targetRef],
    evidenceRefs: [
      REVIEW_PUBLISH_RELEASE_FIXTURE_IDS.mainSealedEvidenceId,
      REVIEW_PUBLISH_RELEASE_FIXTURE_IDS.artifactSealedEvidenceId,
    ],
    summary: "Compliance evidence for the governed publish package export path.",
    validationOutcome: "approved",
    recordedById: "compliance-officer-default-governance",
    recordedAt: REVIEW_PUBLISH_RELEASE_FIXTURE_TIMESTAMPS.evidenceSealedAt,
  });

  return COMPLIANCE_EXPORT_FLOW_IDS;
}
