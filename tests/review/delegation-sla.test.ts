import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { ApprovalRequestV0, DelegationRecordV0, SlaOverlayV0 } from "@/contracts/review.js";
import { REVIEW_BLOCKED_REASONS_V0, assertDecisionEligible } from "@/review/guards.js";
import { buildApprovalQueue } from "@/review/queues.js";
import { ReviewStore } from "@/review/review-store.js";

let dataDir: string;

beforeEach(async () => {
  dataDir = await mkdtemp(join(tmpdir(), "pluto-review-store-test-"));
});

afterEach(async () => {
  await rm(dataDir, { recursive: true, force: true });
});

function makeApprovalRequest(): ApprovalRequestV0 {
  return {
    schema: "pluto.review.approval-request",
    schemaVersion: 0,
    id: "approval-delegated-1",
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
    evidenceRequirements: [],
    diffSnapshot: {
      diffId: "diff-1",
      path: ".pluto/review/diffs/diff-1.patch",
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
      summary: "Awaiting delegated approval",
    },
    blockedReasons: [],
    createdAt: "2026-04-30T00:00:00.000Z",
    updatedAt: "2026-04-30T00:00:00.000Z",
    requestedAt: "2026-04-30T00:00:00.000Z",
    metadata: { dueAt: "2026-04-30T01:00:00.000Z" },
  };
}

function makeDelegation(overrides: Partial<DelegationRecordV0> = {}): DelegationRecordV0 {
  return {
    schema: "pluto.review.delegation",
    schemaVersion: 0,
    id: "delegation-1",
    workspaceId: "workspace-1",
    delegatorId: "approver-1",
    delegateeId: "delegate-1",
    roleLabel: "release_manager",
    scope: {
      requestKind: "approval",
      requestId: "approval-delegated-1",
      targetKind: "publish_package",
      targetId: "pkg-1",
    },
    expiresAt: "2026-04-30T02:00:00.000Z",
    revokedAt: null,
    revokedById: null,
    createdAt: "2026-04-30T00:00:00.000Z",
    ...overrides,
  };
}

describe("delegation and SLA overlays", () => {
  it("round-trips delegations and SLA overlays through the review store facade", async () => {
    const store = new ReviewStore({ dataDir });
    const delegation = makeDelegation();
    const overlay: SlaOverlayV0 = {
      schema: "pluto.review.sla-overlay",
      schemaVersion: 0,
      id: "approval-delegated-1:sla",
      requestId: "approval-delegated-1",
      requestKind: "approval",
      dueAt: "2026-04-30T01:00:00.000Z",
      overdue: false,
      blocked: false,
      degraded: false,
      blockedReasons: [],
      computedAt: "2026-04-30T00:30:00.000Z",
    };

    await store.putDelegation(delegation);
    await store.putSlaOverlay(overlay);

    expect(await store.getDelegation(delegation.id)).toEqual(delegation);
    expect(await store.getSlaOverlay(overlay.id)).toEqual(overlay);
    expect((await store.listDelegations()).map((record) => record.id)).toEqual([delegation.id]);
    expect((await store.listSlaOverlays()).map((record) => record.id)).toEqual([overlay.id]);
  });

  it("blocks delegated decisions when the delegation is expired or revoked", () => {
    const request = makeApprovalRequest();

    expect(assertDecisionEligible({
      request,
      actorId: "delegate-1",
      actorRoleLabels: [],
      delegations: [makeDelegation({ expiresAt: "2026-04-30T00:30:00.000Z" })],
      now: "2026-04-30T01:30:00.000Z",
    }).blockedReasons).toEqual([REVIEW_BLOCKED_REASONS_V0.expiredDelegation]);

    expect(assertDecisionEligible({
      request,
      actorId: "delegate-1",
      actorRoleLabels: [],
      delegations: [makeDelegation({ revokedAt: "2026-04-30T00:15:00.000Z", revokedById: "approver-1" })],
      now: "2026-04-30T00:30:00.000Z",
    }).blockedReasons).toEqual([REVIEW_BLOCKED_REASONS_V0.expiredDelegation]);
  });

  it("marks approval queue entries overdue from SLA overlays", () => {
    const request = makeApprovalRequest();
    const queue = buildApprovalQueue({
      requests: [request],
      actor: { actorId: "approver-1", roleLabels: ["release_manager"] },
      slaOverlays: [{
        schema: "pluto.review.sla-overlay",
        schemaVersion: 0,
        id: "approval-delegated-1:sla",
        requestId: request.id,
        requestKind: "approval",
        dueAt: "2026-04-30T01:00:00.000Z",
        overdue: true,
        blocked: false,
        degraded: false,
        blockedReasons: [],
        computedAt: "2026-04-30T02:00:00.000Z",
      }],
      now: "2026-04-30T02:00:00.000Z",
    });

    expect(queue[0]).toMatchObject({
      requestId: request.id,
      overdue: true,
      dueAt: "2026-04-30T01:00:00.000Z",
    });
  });
});
