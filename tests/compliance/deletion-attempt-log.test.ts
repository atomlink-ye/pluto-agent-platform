import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { ComplianceStore } from "@/compliance/compliance-store.js";
import { decideDeletionAttemptV0 } from "@/compliance/deletion-decision.js";
import { toGovernedPublishPackageRefV0 } from "@/contracts/compliance.js";

let workDir = "";

beforeEach(async () => {
  workDir = await mkdtemp(join(tmpdir(), "pluto-compliance-r3-delete-test-"));
});

afterEach(async () => {
  await rm(workDir, { recursive: true, force: true });
});

describe("deletion attempt logging", () => {
  it("fails closed for active fixed-term retention when store-backed policy timing is incomplete", async () => {
    const store = new ComplianceStore({ dataDir: join(workDir, ".pluto") });
    const targetRef = toGovernedPublishPackageRefV0({
      id: "pkg-1",
      workspaceId: "workspace-1",
      documentId: "doc-1",
      versionId: "ver-1",
      summary: "Governed release package",
    });

    await store.put("retention_policy", {
      schema: "pluto.compliance.retention-policy",
      schemaVersion: 0,
      id: "policy-1",
      workspaceId: "workspace-1",
      status: "active",
      retentionClass: "fixed_term",
      governedRefs: [targetRef],
      assignedById: "custodian-1",
      effectiveAt: "2026-04-30T00:00:00.000Z",
      retainUntil: null,
      summary: "Fixed term retention remains active.",
    });

    const result = await decideDeletionAttemptV0({
      store,
      id: "delete-1",
      workspaceId: "workspace-1",
      targetRef,
      requestedById: "operator-1",
      requestedAt: "2026-05-01T00:00:00.000Z",
      mode: "hard_delete",
      sourceCommand: "tests.deletion-attempt-log",
      evidenceRefs: ["evidence-1", "evidence-1"],
    });

    expect(result).toMatchObject({
      outcome: "blocked",
      blockReason: "retain_until_active",
      attempt: {
        id: "delete-1",
        requestedById: "operator-1",
        mode: "hard_delete",
      },
    });

    const attempts = await store.list("deletion_attempt");
    expect(attempts).toEqual([
      expect.objectContaining({
        id: "delete-1",
        requestedById: "operator-1",
        outcome: "blocked",
        blockReason: "retain_until_active",
        targetRef: expect.objectContaining({ stableId: "pkg-1", kind: "publish_package" }),
      }),
    ]);
    expect(await store.listEvents()).toEqual([
      expect.objectContaining({
        action: "deletion_blocked",
        actor: { principalId: "operator-1" },
        source: { command: "tests.deletion-attempt-log", ref: "delete-1" },
      }),
    ]);
  });

  it("records blocked outcomes and reasons when a placed hold prevents hard delete", async () => {
    const store = new ComplianceStore({ dataDir: join(workDir, ".pluto") });
    const targetRef = toGovernedPublishPackageRefV0({
      id: "pkg-2",
      workspaceId: "workspace-1",
      documentId: "doc-2",
      versionId: "ver-2",
    });

    await store.put("legal_hold", {
      schema: "pluto.compliance.legal-hold",
      schemaVersion: 0,
      id: "hold-1",
      workspaceId: "workspace-1",
      status: "placed",
      governedRefs: [targetRef],
      placedById: "custodian-1",
      placedAt: "2026-04-30T00:00:00.000Z",
      releasedAt: null,
      releaseReviewRef: null,
      releaseApprovalRef: null,
      reason: "Preserve release evidence",
      summary: "Active legal hold",
    });

    const result = await decideDeletionAttemptV0({
      store,
      id: "delete-2",
      workspaceId: "workspace-1",
      targetRef,
      requestedById: "operator-2",
      requestedAt: "2026-05-01T00:00:00.000Z",
      mode: "hard_delete",
      sourceCommand: "tests.deletion-attempt-log",
    });

    expect(result).toMatchObject({
      outcome: "blocked",
      blockReason: "legal_hold_active",
      attempt: {
        outcome: "blocked",
        blockReason: "legal_hold_active",
      },
    });
    expect((await store.listEvents())[0]).toMatchObject({
      action: "deletion_blocked",
      reason: "legal_hold_active",
    });
  });
});
