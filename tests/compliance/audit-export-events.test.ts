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
  workDir = await mkdtemp(join(tmpdir(), "pluto-audit-export-events-test-"));
});

afterEach(async () => {
  await rm(workDir, { recursive: true, force: true });
});

describe("audit export events", () => {
  it("records a durable generated event and links it back into the manifest refs", async () => {
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
        startRef: "ver-1",
        endRef: "pkg-1",
        itemCount: 2,
        summary: "Package-focused export slice.",
      },
      evidenceRefs: ["evidence-1"],
      complianceEvents: [{ id: "event-upstream-1" }, { id: "event-upstream-1" }],
      generatedEventId: "event-generated-1",
      sourceCommand: "audit-export-events.test",
    });

    expect(result.ok).toBe(true);
    if (!result.ok) {
      throw new Error("expected audit export to succeed");
    }

    expect(result.generatedEvent).toMatchObject({
      id: "event-generated-1",
      action: "audit_export_generated",
      outcome: "generated",
      actorId: "exporter-1",
      recordId: "manifest-1",
      evidenceRefs: ["evidence-1"],
    });
    expect(result.manifest.complianceEventRefs).toEqual(["event-upstream-1", "event-generated-1"]);

    await expect(store.listEvents({ action: "audit_export_generated" })).resolves.toEqual([
      expect.objectContaining({
        id: "event-generated-1",
        eventType: "compliance.audit_export_generated",
        action: "audit_export_generated",
        target: expect.objectContaining({
          kind: "publish_package",
          recordId: "manifest-1",
          packageId: "pkg-1",
        }),
        status: expect.objectContaining({
          after: "generated",
        }),
        source: {
          command: "audit-export-events.test",
          ref: "manifest-1",
        },
      }),
    ]);
  });
});
