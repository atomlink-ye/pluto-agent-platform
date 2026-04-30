import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createAuditExportV0 } from "@/compliance/audit-export.js";
import { ComplianceStore } from "@/compliance/compliance-store.js";
import {
  toGovernedDocumentRefV0,
  toGovernedPublishPackageRefV0,
} from "@/contracts/compliance.js";

let workDir = "";

beforeEach(async () => {
  workDir = await mkdtemp(join(tmpdir(), "pluto-audit-export-incomplete-chain-test-"));
});

afterEach(async () => {
  await rm(workDir, { recursive: true, force: true });
});

describe("audit export incomplete chain", () => {
  it("fails closed, writes a blocker event, and does not persist a manifest when the governed chain is incomplete", async () => {
    const store = new ComplianceStore({ dataDir: join(workDir, ".pluto") });

    const result = await createAuditExportV0({
      store,
      manifestId: "manifest-1",
      workspaceId: "workspace-1",
      createdById: "exporter-1",
      createdAt: "2026-04-30T00:04:00.000Z",
      governedChain: [
        toGovernedDocumentRefV0({ documentId: "doc-1", workspaceId: "workspace-1" }),
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
        itemCount: 2,
        summary: "Incomplete chain should block export.",
      },
      evidenceRefs: ["evidence-1"],
      blockedEventId: "event-blocked-1",
      sourceCommand: "audit-export-incomplete-chain.test",
    });

    expect(result.ok).toBe(false);
    if (result.ok) {
      throw new Error("expected audit export to fail");
    }

    expect(result.errors).toContain("publish_package:pkg-1 is missing version:ver-1");
    expect(result.blockerEvent).toMatchObject({
      id: "event-blocked-1",
      action: "audit_export_generated",
      outcome: "blocked",
      recordId: "manifest-1",
    });
    expect(result.blockerEvent.summary).toContain("missing version:ver-1");

    await expect(store.list("audit_export_manifest")).resolves.toEqual([]);
    await expect(store.listEvents({ action: "audit_export_generated" })).resolves.toEqual([
      expect.objectContaining({
        id: "event-blocked-1",
        status: expect.objectContaining({ after: "blocked" }),
        reason: expect.stringContaining("missing version:ver-1"),
        source: {
          command: "audit-export-incomplete-chain.test",
          ref: "manifest-1",
        },
      }),
    ]);
  });
});
