import { describe, expect, it } from "vitest";

import { toImmutableEvidencePacketMetadataV0 } from "@/contracts/evidence-graph.js";
import type { ApprovalRequestV0, ReviewRequestV0, SlaOverlayV0 } from "@/contracts/review.js";
import type { EvidencePacketV0 } from "@/contracts/types.js";
import { REVIEW_BLOCKED_REASONS_V0 } from "@/review/guards.js";
import { buildApprovalQueue, buildReviewQueue } from "@/review/queues.js";
import type { AssignmentRecordV0 } from "@/review/review-store.js";

function makePacket(runId: string): EvidencePacketV0 {
  return {
    schemaVersion: 0,
    runId,
    taskTitle: `Evidence for ${runId}`,
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

function makeSealedEvidence(ref: string, runId: string) {
  const packet = makePacket(runId);
  return {
    schemaVersion: 0 as const,
    kind: "sealed_evidence" as const,
    id: `sealed-${runId}`,
    packetId: `packet-${runId}`,
    runId,
    evidencePath: `.pluto/runs/${runId}/evidence.json`,
    sealChecksum: `sha256:${runId}`,
    sealedAt: "2026-04-30T00:01:02.000Z",
    sourceRun: {
      runId,
      status: "done",
      blockerReason: null,
      finishedAt: packet.finishedAt,
    },
    validationSummary: { outcome: "pass" as const, reason: null },
    redactionSummary: {
      redactedAt: "2026-04-30T00:01:01.500Z",
      fieldsRedacted: 1,
      summary: `Redacted fields for ${ref}`,
    },
    immutablePacket: toImmutableEvidencePacketMetadataV0(packet),
  };
}

function makeReviewRequest(): ReviewRequestV0 {
  return {
    schema: "pluto.review.request",
    schemaVersion: 0,
    id: "review-version-1",
    workspaceId: "workspace-1",
    target: {
      kind: "version",
      documentId: "doc-1",
      versionId: "ver-1",
    },
    requestedById: "requester-1",
    assigneeIds: ["reviewer-1"],
    status: "requested",
    evidenceRequirements: [{ ref: "evidence:version", required: true }],
    diffSnapshot: {
      diffId: "diff-1",
      path: ".pluto/review/diffs/diff-1.patch",
    },
    createdAt: "2026-04-30T00:00:00.000Z",
    updatedAt: "2026-04-30T00:00:00.000Z",
    requestedAt: "2026-04-30T00:00:00.000Z",
    metadata: { dueAt: "2026-04-30T02:00:00.000Z" },
  };
}

function makeApprovalRequest(): ApprovalRequestV0 {
  return {
    schema: "pluto.review.approval-request",
    schemaVersion: 0,
    id: "approval-package-1",
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
    evidenceRequirements: [{ ref: "evidence:package", required: true }],
    diffSnapshot: {
      diffId: "diff-2",
      path: ".pluto/review/diffs/diff-2.patch",
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
    metadata: { dueAt: "2026-04-30T01:00:00.000Z" },
  };
}

describe("review queues", () => {
  it("builds a reviewer queue for version targets with sealed evidence and SLA state", () => {
    const reviewRequest = makeReviewRequest();
    const assignment: AssignmentRecordV0 = {
      schema: "pluto.review.assignment",
      schemaVersion: 0,
      id: "assignment-review-1",
      requestId: reviewRequest.id,
      requestKind: "review",
      actorId: "reviewer-1",
      roleLabel: "reviewer",
      assignedAt: "2026-04-30T00:00:00.000Z",
      revokedAt: null,
      revokedById: null,
    };

    const queue = buildReviewQueue({
      requests: [reviewRequest],
      actor: { actorId: "reviewer-1", roleLabels: ["reviewer"] },
      assignments: [assignment],
      sealedEvidenceByRef: {
        "evidence:version": makeSealedEvidence("evidence:version", "run-version-1"),
      },
      now: "2026-04-30T00:30:00.000Z",
    });

    expect(queue).toEqual([
      {
        schemaVersion: 0,
        requestId: reviewRequest.id,
        requestKind: "review",
        target: reviewRequest.target,
        status: "requested",
        roleLabel: "reviewer",
        dueAt: "2026-04-30T02:00:00.000Z",
        overdue: false,
        blocked: false,
        degraded: false,
        blockedReasons: [],
        viaDelegation: false,
      },
    ]);
  });

  it("builds an approval queue for publish-package targets and preserves degraded blockers", () => {
    const approvalRequest = makeApprovalRequest();
    const overlay: SlaOverlayV0 = {
      schema: "pluto.review.sla-overlay",
      schemaVersion: 0,
      id: "approval-package-1:sla",
      requestId: approvalRequest.id,
      requestKind: "approval",
      dueAt: "2026-04-30T01:00:00.000Z",
      overdue: true,
      blocked: true,
      degraded: true,
      blockedReasons: [REVIEW_BLOCKED_REASONS_V0.degradedDependency],
      computedAt: "2026-04-30T03:00:00.000Z",
    };

    const queue = buildApprovalQueue({
      requests: [approvalRequest],
      actor: { actorId: "approver-1", roleLabels: ["release_manager"] },
      sealedEvidenceByRef: {
        "evidence:package": makeSealedEvidence("evidence:package", "run-package-1"),
      },
      degradedRequestIds: [approvalRequest.id],
      slaOverlays: [overlay],
      now: "2026-04-30T03:00:00.000Z",
    });

    expect(queue).toEqual([
      {
        schemaVersion: 0,
        requestId: approvalRequest.id,
        requestKind: "approval",
        target: approvalRequest.target,
        status: "requested",
        roleLabel: "release_manager",
        dueAt: "2026-04-30T01:00:00.000Z",
        overdue: true,
        blocked: true,
        degraded: true,
        blockedReasons: [REVIEW_BLOCKED_REASONS_V0.degradedDependency],
        viaDelegation: false,
      },
    ]);
  });
});
