import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { ComplianceStore } from "@/compliance/compliance-store.js";
import { decideDeletionAttemptV0 } from "@/compliance/deletion-decision.js";
import { placeLegalHoldV0, releaseLegalHoldV0 } from "@/compliance/legal-hold.js";
import { toGovernedPublishPackageRefV0 } from "@/contracts/compliance.js";

let workDir = "";

beforeEach(async () => {
  workDir = await mkdtemp(join(tmpdir(), "pluto-compliance-r3-hold-test-"));
});

afterEach(async () => {
  await rm(workDir, { recursive: true, force: true });
});

describe("compliance legal holds", () => {
  it("blocks hard delete while a hold remains placed", async () => {
    const store = new ComplianceStore({ dataDir: join(workDir, ".pluto") });
    const targetRef = toGovernedPublishPackageRefV0({
      id: "pkg-1",
      workspaceId: "workspace-1",
      documentId: "doc-1",
      versionId: "ver-1",
      summary: "Governed release package",
    });

    await placeLegalHoldV0({
      store,
      id: "hold-1",
      workspaceId: "workspace-1",
      governedRefs: [targetRef],
      placedById: "custodian-1",
      placedAt: "2026-04-30T00:00:00.000Z",
      reason: "Preserve pending regulator inquiry.",
      summary: "Hold on release package.",
      sourceCommand: "tests.legal-hold",
    });

    const decision = await decideDeletionAttemptV0({
      store,
      id: "delete-1",
      workspaceId: "workspace-1",
      targetRef,
      requestedById: "operator-1",
      requestedAt: "2026-05-01T00:00:00.000Z",
      mode: "hard_delete",
      sourceCommand: "tests.legal-hold",
    });

    expect(decision).toMatchObject({
      outcome: "blocked",
      blockReason: "legal_hold_active",
    });
    expect((await store.listEvents()).map((event) => event.action)).toEqual([
      "legal_hold_placed",
      "deletion_blocked",
    ]);
  });

  it("requires review and approval refs before a hold can be released", async () => {
    const store = new ComplianceStore({ dataDir: join(workDir, ".pluto") });
    const targetRef = toGovernedPublishPackageRefV0({
      id: "pkg-1",
      workspaceId: "workspace-1",
      documentId: "doc-1",
      versionId: "ver-1",
    });

    const hold = await placeLegalHoldV0({
      store,
      id: "hold-2",
      workspaceId: "workspace-1",
      governedRefs: [targetRef],
      placedById: "custodian-1",
      placedAt: "2026-04-30T00:00:00.000Z",
      reason: "Preserve pending regulator inquiry.",
      summary: "Hold on release package.",
      sourceCommand: "tests.legal-hold",
    });

    const blocked = await releaseLegalHoldV0({
      store,
      hold,
      releasedById: "approver-1",
      releasedAt: "2026-05-02T00:00:00.000Z",
      releaseReview: null,
      releaseApproval: null,
      sourceCommand: "tests.legal-hold",
    });

    expect(blocked).toMatchObject({
      allowed: false,
      blockReason: "release_requires_review_and_approval",
    });

    const released = await releaseLegalHoldV0({
      store,
      hold,
      releasedById: "approver-1",
      releasedAt: "2026-05-02T00:00:00.000Z",
      releaseReview: {
        id: "review-1",
        status: "succeeded",
      },
      releaseApproval: {
        id: "approval-1",
        status: "succeeded",
      },
      sourceCommand: "tests.legal-hold",
    });

    expect(released).toMatchObject({
      allowed: true,
      blockReason: null,
      hold: {
        status: "released",
        releaseReviewRef: "review-1",
        releaseApprovalRef: "approval-1",
      },
    });
    expect((await store.listEvents()).map((event) => event.action)).toEqual([
      "legal_hold_placed",
      "legal_hold_released",
    ]);
  });
});
