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
} from "@/contracts/compliance.js";

let workDir = "";

beforeEach(async () => {
  workDir = await mkdtemp(join(tmpdir(), "pluto-audit-export-local-only-test-"));
});

afterEach(async () => {
  await rm(workDir, { recursive: true, force: true });
});

describe("audit export local-only behavior", () => {
  it("keeps delivery metadata local and uses placeholder signature metadata only", async () => {
    const store = new ComplianceStore({ dataDir: join(workDir, ".pluto") });

    const result = await createAuditExportV0({
      store,
      manifestId: "manifest-1",
      workspaceId: "workspace-1",
      createdById: "exporter-1",
      createdAt: "2026-04-30T00:04:00.000Z",
      governedChain: [
        toGovernedDocumentRefV0({ documentId: "doc-1", workspaceId: "workspace-1" }),
        toGovernedVersionRefV0({ documentId: "doc-1", versionId: "ver-1", workspaceId: "workspace-1" }),
        toGovernedPublishPackageRefV0({
          id: "pkg-1",
          workspaceId: "workspace-1",
          documentId: "doc-1",
          versionId: "ver-1",
        }),
      ],
      selectedContentRange: {
        startRef: "doc-1",
        endRef: "pkg-1",
        itemCount: 3,
        summary: "Full local review slice.",
      },
      recipient: {
        name: "Internal audit",
        deliveryMethod: "download",
        destination: "https://regulator.example/export/manifest-1",
      },
    });

    expect(result.ok).toBe(true);
    if (!result.ok) {
      throw new Error("expected audit export to succeed");
    }

    expect(result.manifest.recipient).toEqual({
      name: "Internal audit",
      deliveryMethod: "download",
      destination: null,
    });
    expect(result.manifest.localSignature).toEqual({
      status: "signed",
      signedAt: "2026-04-30T00:04:00.000Z",
      sealId: "local-v0:manifest-1",
    });
    expect(result.generatedEvent.summary).toContain("local-only audit export manifest");
  });
});
