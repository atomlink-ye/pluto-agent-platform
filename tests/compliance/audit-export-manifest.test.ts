import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createAuditExportV0 } from "@/compliance/audit-export.js";
import { ComplianceStore } from "@/compliance/compliance-store.js";
import {
  toGovernedDocumentRefV0,
  toGovernedPublishPackageRefV0,
  toGovernedVersionRefV0,
  validateAuditExportManifestV0,
} from "@/contracts/compliance.js";

let workDir = "";

beforeEach(async () => {
  workDir = await mkdtemp(join(tmpdir(), "pluto-audit-export-manifest-test-"));
});

afterEach(async () => {
  await rm(workDir, { recursive: true, force: true });
});

describe("audit export manifest", () => {
  it("builds and persists a contract-shaped manifest with deterministic local metadata", async () => {
    const store = new ComplianceStore({ dataDir: join(workDir, ".pluto") });
    const governedChain = [
      toGovernedDocumentRefV0({ documentId: "doc-1", workspaceId: "workspace-1", summary: "Quarterly filing" }),
      toGovernedVersionRefV0({
        documentId: "doc-1",
        versionId: "ver-1",
        workspaceId: "workspace-1",
        summary: "Approved version",
      }),
      toGovernedPublishPackageRefV0({
        id: "pkg-1",
        workspaceId: "workspace-1",
        documentId: "doc-1",
        versionId: "ver-1",
        summary: "Release package",
      }),
    ] as const;

    const first = await createAuditExportV0({
      store,
      manifestId: "manifest-1",
      workspaceId: "workspace-1",
      createdById: "exporter-1",
      createdAt: "2026-04-30T00:04:00.000Z",
      governedChain,
      selectedContentRange: {
        startRef: "doc-1",
        endRef: "pkg-1",
        itemCount: 3,
        summary: "Full governed chain for regulator-ready audit review.",
      },
      evidenceRefs: ["compliance-evidence-1", "sealed-evidence-1", "sealed-evidence-1"],
      complianceEvents: [{ id: "event-prior-1" }],
      retentionPolicies: [{ id: "policy-1", summary: "Seven year retention remains active." }],
      legalHolds: [{ id: "hold-1", summary: "One legal hold preserves the package." }],
      recipient: { name: "Internal audit" },
    });

    const second = await createAuditExportV0({
      store,
      manifestId: "manifest-2",
      workspaceId: "workspace-1",
      createdById: "exporter-1",
      createdAt: "2026-04-30T00:04:00.000Z",
      governedChain,
      selectedContentRange: {
        startRef: "doc-1",
        endRef: "pkg-1",
        itemCount: 3,
        summary: "Full governed chain for regulator-ready audit review.",
      },
      evidenceRefs: ["compliance-evidence-1", "sealed-evidence-1"],
      complianceEvents: [{ id: "event-prior-1" }],
      retentionPolicies: [{ id: "policy-1", summary: "Seven year retention remains active." }],
      legalHolds: [{ id: "hold-1", summary: "One legal hold preserves the package." }],
      recipient: { name: "Internal audit" },
      generatedEventId: "manifest-1:generated",
    });

    expect(first.ok).toBe(true);
    expect(second.ok).toBe(true);

    if (!first.ok || !second.ok) {
      throw new Error("expected audit export to succeed");
    }

    expect(validateAuditExportManifestV0(first.manifest).ok).toBe(true);
    expect(first.manifest).toMatchObject({
      id: "manifest-1",
      status: "generated",
      evidenceRefs: ["compliance-evidence-1", "sealed-evidence-1"],
      complianceEventRefs: ["event-prior-1", "manifest-1:generated"],
      retentionSummary: {
        policyIds: ["policy-1"],
      },
      holdSummary: {
        holdIds: ["hold-1"],
      },
      localSignature: {
        status: "signed",
        signedAt: "2026-04-30T00:04:00.000Z",
        sealId: "local-v0:manifest-1",
      },
      selectedContentRange: {
        startRef: "doc-1",
        endRef: "pkg-1",
        itemCount: 3,
      },
    });
    expect(first.manifest.checksumSummary.digest).toBe(second.ok ? second.manifest.checksumSummary.digest : "");

    await expect(store.get("audit_export_manifest", "manifest-1")).resolves.toMatchObject({
      id: "manifest-1",
      checksumSummary: first.manifest.checksumSummary,
      selectedContentRange: first.manifest.selectedContentRange,
      governedChain: [
        { kind: "document", stableId: "doc-1" },
        { kind: "version", stableId: "ver-1", versionId: "ver-1" },
        { kind: "publish_package", stableId: "pkg-1", packageId: "pkg-1" },
      ],
      localSignature: first.manifest.localSignature,
      recipient: first.manifest.recipient,
    });
  });
});
