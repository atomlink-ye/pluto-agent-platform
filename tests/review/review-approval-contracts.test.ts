import { describe, expect, it } from "vitest";

import {
  parseDecisionEventV0,
  parseReviewTargetKindV0,
  normalizeApprovalStatusV0,
  normalizeReviewStatusV0,
  validateApprovalRequestV0,
  validateDecisionRecordV0,
  validateGovernedTargetRefV0,
  validateReviewRequestV0,
} from "@/contracts/review.js";

const timestamps = {
  createdAt: "2026-04-30T00:00:00.000Z",
  updatedAt: "2026-04-30T00:05:00.000Z",
  requestedAt: "2026-04-30T00:01:00.000Z",
};

describe("review and approval contracts", () => {
  it("validates schema markers and governed target refs", () => {
    expect(validateGovernedTargetRefV0({
      kind: "document",
      documentId: "doc-1",
    }).ok).toBe(true);

    expect(validateGovernedTargetRefV0({
      kind: "section",
      documentId: "doc-1",
      versionId: "ver-1",
      sectionId: "sec-1",
    }).ok).toBe(true);

    expect(validateGovernedTargetRefV0({
      kind: "publish_package",
      documentId: "doc-1",
      versionId: "ver-1",
      packageId: "pkg-1",
    }).ok).toBe(true);

    expect(validateReviewRequestV0({
      schema: "pluto.review.request",
      schemaVersion: 0,
      id: "review-request-1",
      workspaceId: "workspace-1",
      target: {
        kind: "version",
        documentId: "doc-1",
        versionId: "ver-1",
      },
      requestedById: "requester-1",
      assigneeIds: ["reviewer-1"],
      status: "requested",
      evidenceRequirements: [
        { ref: "evidence:packet-1", required: true, note: "sealed evidence" },
      ],
      diffSnapshot: {
        diffId: "diff-1",
        path: ".pluto/governance/diffs/diff-1.json",
        checksum: "sha256:abc123",
      },
      ...timestamps,
      metadata: { lane: "r1", priority: 1 },
    }).ok).toBe(true);

    expect(validateApprovalRequestV0({
      schema: "pluto.review.approval-request",
      schemaVersion: 0,
      id: "approval-request-1",
      workspaceId: "workspace-1",
      target: {
        kind: "publish_package",
        documentId: "doc-1",
        versionId: "ver-1",
        packageId: "pkg-1",
      },
      requestedById: "requester-1",
      assigneeIds: ["approver-1", "approver-2"],
      status: "blocked",
      evidenceRequirements: [{ ref: "evidence:packet-2", required: true }],
      diffSnapshot: null,
      approvalPolicy: {
        policyId: "policy-legal-and-editorial",
        summary: "Requires editorial and legal signoff before publish readiness.",
        mode: "all_of",
      },
      requiredApproverRoles: [
        { roleLabel: "editorial", minApprovers: 1 },
        { roleLabel: "legal", minApprovers: 1 },
      ],
      decisionSummary: {
        latestDecisionId: null,
        latestEvent: null,
        decidedAt: null,
        summary: "Awaiting both required approver roles.",
      },
      blockedReasons: ["missing_legal_signoff"],
      ...timestamps,
    }).ok).toBe(true);
  });

  it("validates append-only decision records with governed targets", () => {
    const result = validateDecisionRecordV0({
      schema: "pluto.review.decision",
      schemaVersion: 0,
      id: "decision-1",
      requestId: "approval-request-1",
      requestKind: "approval",
      target: {
        kind: "publish_package",
        documentId: "doc-1",
        versionId: "ver-1",
        packageId: "pkg-1",
      },
      event: "approved",
      actorId: "approver-1",
      comment: "Ready to release.",
      delegatedToId: null,
      recordedAt: "2026-04-30T00:09:00.000Z",
    });

    expect(result.ok).toBe(true);
    expect(result.ok ? result.value.event : null).toBe("approved");
    expect(result.ok ? "updatedAt" in result.value : true).toBe(false);
  });

  it("preserves unknown enum values for tolerant readers", () => {
    expect(parseDecisionEventV0("delegated")).toBe("delegated");
    expect(parseDecisionEventV0("escalated")).toBe("escalated");
    expect(parseDecisionEventV0(42)).toBeNull();

    expect(parseReviewTargetKindV0("version")).toBe("version");
    expect(parseReviewTargetKindV0("bundle")).toBe("bundle");
    expect(parseReviewTargetKindV0({ kind: "version" })).toBeNull();

    expect(normalizeReviewStatusV0("awaiting_translation_review")).toBe("awaiting_translation_review");
    expect(normalizeApprovalStatusV0("awaiting_security_signoff")).toBe("awaiting_security_signoff");
  });

  it("keeps governance records ref-only without raw runtime payload requirements", () => {
    const decision = {
      schema: "pluto.review.decision" as const,
      schemaVersion: 0 as const,
      id: "decision-2",
      requestId: "review-request-1",
      requestKind: "review" as const,
      target: {
        kind: "section" as const,
        documentId: "doc-1",
        versionId: "ver-1",
        sectionId: "sec-1",
      },
      event: "commented",
      actorId: "reviewer-1",
      comment: "Please clarify the rollout caveat.",
      delegatedToId: null,
      recordedAt: "2026-04-30T00:07:00.000Z",
    };

    expect(validateDecisionRecordV0(decision).ok).toBe(true);
    expect(decision).not.toHaveProperty("providerSession");
    expect(decision).not.toHaveProperty("callbackPayload");
    expect(decision).not.toHaveProperty("runtimeResult");
  });
});
