import { describe, expect, it } from "vitest";

import {
  normalizeComplianceStatusV0,
  validateAuditExportManifestV0,
  validateDeletionAttemptV0,
  toGovernedPublishPackageRefV0,
} from "@/contracts/compliance.js";

const publishPackageRef = toGovernedPublishPackageRefV0({
  id: "pkg-1",
  workspaceId: "workspace-1",
  documentId: "doc-1",
  versionId: "ver-1",
});

describe("compliance status compatibility", () => {
  it("normalizes legacy done to the succeeded-style reader summary", () => {
    expect(normalizeComplianceStatusV0("done")).toBe("succeeded");
    expect(normalizeComplianceStatusV0("succeeded")).toBe("succeeded");
  });

  it("preserves existing and future additive statuses", () => {
    expect(normalizeComplianceStatusV0("generated")).toBe("generated");
    expect(normalizeComplianceStatusV0("future_regulatory_state")).toBe("future_regulatory_state");
    expect(normalizeComplianceStatusV0(false)).toBeNull();
  });

  it("keeps legacy done records readable without rewriting stored data", () => {
    expect(validateAuditExportManifestV0({
      schema: "pluto.compliance.audit-export-manifest",
      schemaVersion: 0,
      id: "manifest-legacy",
      workspaceId: "workspace-1",
      status: "done",
      governedChain: [publishPackageRef],
      evidenceRefs: ["evidence-1"],
      complianceEventRefs: ["event-1"],
      createdById: "exporter-1",
      createdAt: "2026-04-30T00:04:00.000Z",
      retentionSummary: { policyIds: ["policy-1"], summary: "Legacy manifest remains readable." },
      holdSummary: { holdIds: [], summary: "No active holds." },
      checksumSummary: { algorithm: "sha256", digest: "manifest-checksum-1" },
      recipient: { name: "Internal audit", deliveryMethod: "download", destination: null },
      localSignature: { status: "done", signedAt: "2026-04-30T00:04:30.000Z", sealId: "seal-1" },
    }).ok).toBe(true);

    expect(validateDeletionAttemptV0({
      schema: "pluto.compliance.deletion-attempt",
      schemaVersion: 0,
      id: "delete-legacy",
      workspaceId: "workspace-1",
      targetRef: publishPackageRef,
      requestedById: "user-1",
      requestedAt: "2026-04-30T00:02:00.000Z",
      mode: "hard_delete",
      outcome: "done",
      blockReason: null,
      evidenceRefs: [],
      summary: "Legacy outcome remains readable.",
      recordedAt: "2026-04-30T00:02:01.000Z",
    }).ok).toBe(true);
  });
});
