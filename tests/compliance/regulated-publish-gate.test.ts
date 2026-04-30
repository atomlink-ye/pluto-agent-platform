import { describe, expect, it } from "vitest";

import {
  evaluateRegulatedPublishDecisionV0,
  toGovernedDocumentRefV0,
  toGovernedPublishPackageRefV0,
  toGovernedVersionRefV0,
  validateComplianceActionEventV0,
  validateComplianceEvidenceV0,
  type ComplianceEvidenceV0,
} from "@/contracts/compliance.js";

const publishPackage = {
  id: "pkg-1",
  workspaceId: "workspace-1",
  documentId: "doc-1",
  versionId: "ver-1",
};

function makeEvidence(): ComplianceEvidenceV0 {
  return {
    schema: "pluto.compliance.evidence",
    schemaVersion: 0,
    id: "compliance-evidence-1",
    workspaceId: "workspace-1",
    subjectRef: toGovernedPublishPackageRefV0(publishPackage),
    supportingRefs: [
      toGovernedDocumentRefV0({ documentId: "doc-1", workspaceId: "workspace-1" }),
      toGovernedVersionRefV0({ documentId: "doc-1", versionId: "ver-1", workspaceId: "workspace-1" }),
    ],
    evidenceRefs: ["sealed-evidence-1"],
    summary: "Release evidence satisfies the regulated gate.",
    validationOutcome: "pass",
    recordedById: "reviewer-1",
    recordedAt: "2026-04-30T00:03:00.000Z",
  };
}

describe("regulated publish gate", () => {
  it("blocks regulated publish decisions that do not include explicit compliance evidence", () => {
    const decision = evaluateRegulatedPublishDecisionV0({
      id: "decision-1",
      publishPackage,
      actorId: "publisher-1",
      decidedAt: "2026-04-30T00:05:00.000Z",
      complianceEvidence: [],
    });

    expect(decision.status).toBe("blocked");
    expect(decision.blockedReasons).toEqual(["missing_compliance_evidence"]);
    expect(decision.evidenceSummaries).toEqual([]);
    expect(decision.event.action).toBe("regulated_publish_blocked");
    expect(decision.event.outcome).toBe("blocked");
    expect(validateComplianceActionEventV0(decision.event).ok).toBe(true);
  });

  it("allows regulated publish decisions only when explicit compliance evidence refs and summaries are present", () => {
    const evidence = makeEvidence();
    expect(validateComplianceEvidenceV0(evidence).ok).toBe(true);

    const decision = evaluateRegulatedPublishDecisionV0({
      id: "decision-2",
      publishPackage,
      actorId: "publisher-1",
      decidedAt: "2026-04-30T00:06:00.000Z",
      complianceEvidence: [evidence],
    });

    expect(decision.status).toBe("allowed");
    expect(decision.blockedReasons).toEqual([]);
    expect(decision.evidenceSummaries).toEqual([
      {
        evidenceId: "compliance-evidence-1",
        summary: "Release evidence satisfies the regulated gate.",
        validationOutcome: "pass",
      },
    ]);
    expect(decision.event.action).toBe("regulated_publish_allowed");
    expect(decision.event.outcome).toBe("allowed");
    expect(validateComplianceActionEventV0(decision.event).ok).toBe(true);
  });
});
