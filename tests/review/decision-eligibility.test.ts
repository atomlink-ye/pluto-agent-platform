import { describe, expect, it } from "vitest";

import { toImmutableEvidencePacketMetadataV0 } from "@/contracts/evidence-graph.js";
import type { ApprovalRequestV0 } from "@/contracts/review.js";
import type { EvidencePacketV0 } from "@/contracts/types.js";
import { REVIEW_BLOCKED_REASONS_V0, assertDecisionEligible } from "@/review/guards.js";
import type { AssignmentRecordV0 } from "@/review/review-store.js";

function makePacket(): EvidencePacketV0 {
  return {
    schemaVersion: 0,
    runId: "run-approval-1",
    taskTitle: "Approval evidence",
    status: "done",
    blockerReason: null,
    startedAt: "2026-04-30T00:00:00.000Z",
    finishedAt: "2026-04-30T00:01:00.000Z",
    workspace: null,
    workers: [],
    validation: { outcome: "pass", reason: null },
    citedInputs: { taskPrompt: "prompt", workspaceMarkers: [] },
    risks: [],
    openQuestions: [],
    classifierVersion: 0,
    generatedAt: "2026-04-30T00:01:01.000Z",
  };
}

function makeSealedEvidence() {
  const packet = makePacket();
  return {
    schemaVersion: 0 as const,
    kind: "sealed_evidence" as const,
    id: "sealed-approval-1",
    packetId: "packet-approval-1",
    runId: packet.runId,
    evidencePath: ".pluto/runs/run-approval-1/evidence.json",
    sealChecksum: "sha256:approval",
    sealedAt: "2026-04-30T00:01:02.000Z",
    sourceRun: {
      runId: packet.runId,
      status: "done",
      blockerReason: null,
      finishedAt: packet.finishedAt,
    },
    validationSummary: { outcome: "pass" as const, reason: null },
    redactionSummary: {
      redactedAt: "2026-04-30T00:01:01.500Z",
      fieldsRedacted: 1,
      summary: "Redacted session identifiers",
    },
    immutablePacket: toImmutableEvidencePacketMetadataV0(packet),
  };
}

function makeRequest(): ApprovalRequestV0 {
  return {
    schema: "pluto.review.approval-request",
    schemaVersion: 0,
    id: "approval-eligibility-1",
    workspaceId: "workspace-1",
    target: {
      kind: "publish_package",
      documentId: "doc-1",
      versionId: "ver-1",
      packageId: "pkg-1",
    },
    requestedById: "requester-1",
    assigneeIds: ["approver-1"],
    status: "requested",
    evidenceRequirements: [{ ref: "evidence:approval", required: true }],
    diffSnapshot: {
      diffId: "diff-approval-1",
      path: ".pluto/review/diffs/diff-approval-1.patch",
    },
    approvalPolicy: {
      policyId: "policy-1",
      summary: "Need release approval",
    },
    requiredApproverRoles: [{ roleLabel: "release_manager", minApprovers: 1 }],
    decisionSummary: {
      latestDecisionId: null,
      latestEvent: null,
      decidedAt: null,
      summary: "Awaiting approval",
    },
    blockedReasons: [],
    createdAt: "2026-04-30T00:00:00.000Z",
    updatedAt: "2026-04-30T00:00:00.000Z",
    requestedAt: "2026-04-30T00:00:00.000Z",
  };
}

function makeAssignment(overrides: Partial<AssignmentRecordV0> = {}): AssignmentRecordV0 {
  return {
    schema: "pluto.review.assignment",
    schemaVersion: 0,
    id: "assignment-1",
    requestId: "approval-eligibility-1",
    requestKind: "approval",
    actorId: "approver-1",
    roleLabel: "release_manager",
    assignedAt: "2026-04-30T00:00:00.000Z",
    revokedAt: null,
    revokedById: null,
    ...overrides,
  };
}

describe("decision eligibility", () => {
  it("rejects the wrong role label with a stable blocked reason", () => {
    const result = assertDecisionEligible({
      request: makeRequest(),
      actorId: "approver-1",
      actorRoleLabels: ["editorial"],
      assignments: [makeAssignment()],
      sealedEvidenceByRef: { "evidence:approval": makeSealedEvidence() },
    });

    expect(result.blockedReasons).toEqual([REVIEW_BLOCKED_REASONS_V0.wrongRole]);
  });

  it("rejects revoked assignments with a stable blocked reason", () => {
    const result = assertDecisionEligible({
      request: makeRequest(),
      actorId: "approver-1",
      actorRoleLabels: ["release_manager"],
      assignments: [makeAssignment({ revokedAt: "2026-04-30T00:10:00.000Z", revokedById: "owner-1" })],
      sealedEvidenceByRef: { "evidence:approval": makeSealedEvidence() },
    });

    expect(result.blockedReasons).toEqual([REVIEW_BLOCKED_REASONS_V0.revokedAssignment]);
  });

  it("rejects missing sealed evidence and missing diff with stable blocked reasons", () => {
    const request = makeRequest();
    request.diffSnapshot = null;

    const result = assertDecisionEligible({
      request,
      actorId: "approver-1",
      actorRoleLabels: ["release_manager"],
      assignments: [makeAssignment()],
      sealedEvidenceByRef: {},
    });

    expect(result.blockedReasons).toEqual([
      REVIEW_BLOCKED_REASONS_V0.missingDiff,
      REVIEW_BLOCKED_REASONS_V0.missingSealedEvidence,
    ]);
  });

  it("rejects degraded dependencies with a stable blocked reason", () => {
    const result = assertDecisionEligible({
      request: makeRequest(),
      actorId: "approver-1",
      actorRoleLabels: ["release_manager"],
      assignments: [makeAssignment()],
      sealedEvidenceByRef: { "evidence:approval": makeSealedEvidence() },
      dependencyDegraded: true,
    });

    expect(result.blockedReasons).toEqual([REVIEW_BLOCKED_REASONS_V0.degradedDependency]);
  });
});
