import { describe, expect, it } from "vitest";

import {
  normalizeApprovalStatusV0,
  normalizeReviewStatusV0,
  validateApprovalRequestV0,
  validateReviewRequestV0,
} from "@/contracts/review.js";

const baseRequest = {
  schemaVersion: 0 as const,
  workspaceId: "workspace-1",
  requestedById: "requester-1",
  assigneeIds: ["reviewer-1"],
  target: {
    kind: "version" as const,
    documentId: "doc-1",
    versionId: "ver-1",
  },
  evidenceRequirements: [{ ref: "evidence:packet-1", required: true }],
  diffSnapshot: null,
  createdAt: "2026-04-30T00:00:00.000Z",
  updatedAt: "2026-04-30T00:05:00.000Z",
  requestedAt: "2026-04-30T00:01:00.000Z",
};

describe("review and approval status compatibility", () => {
  it("normalizes legacy done to succeeded for review and approval readers", () => {
    expect(normalizeReviewStatusV0("done")).toBe("succeeded");
    expect(normalizeApprovalStatusV0("done")).toBe("succeeded");
  });

  it("keeps legacy done records readable without renaming stored data", () => {
    expect(validateReviewRequestV0({
      schema: "pluto.review.request",
      id: "review-request-legacy",
      status: "done",
      ...baseRequest,
    }).ok).toBe(true);

    expect(validateApprovalRequestV0({
      schema: "pluto.review.approval-request",
      id: "approval-request-legacy",
      status: "done",
      ...baseRequest,
      approvalPolicy: {
        policyId: "policy-1",
        summary: "Legacy records still map through succeeded readers.",
      },
      requiredApproverRoles: [{ roleLabel: "editorial", minApprovers: 1 }],
      decisionSummary: {
        latestDecisionId: "decision-legacy",
        latestEvent: "approved",
        decidedAt: "2026-04-30T00:02:00.000Z",
        summary: "Completed before succeeded became the reader-facing summary.",
      },
      blockedReasons: [],
    }).ok).toBe(true);
  });
});
