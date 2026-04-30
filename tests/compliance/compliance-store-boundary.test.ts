import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { ComplianceStore } from "@/compliance/compliance-store.js";
import { toGovernedDocumentRefV0 } from "@/contracts/compliance.js";

let workDir = "";

beforeEach(async () => {
  workDir = await mkdtemp(join(tmpdir(), "pluto-compliance-boundary-test-"));
});

afterEach(async () => {
  await rm(workDir, { recursive: true, force: true });
});

describe("ComplianceStore boundary", () => {
  it("keeps .pluto/compliance paths private to the store facade", async () => {
    const dataDir = join(workDir, ".pluto");
    const store = new ComplianceStore({ dataDir });

    const record = await store.put("retention_policy", {
      schema: "pluto.compliance.retention-policy",
      schemaVersion: 0,
      id: "retention-1",
      workspaceId: "workspace-1",
      status: "active",
      retentionClass: "fixed_term",
      governedRefs: [toGovernedDocumentRefV0({ documentId: "doc-1", workspaceId: "workspace-1", summary: "Policy target" })],
      assignedById: "compliance-officer-1",
      effectiveAt: "2026-04-30T00:00:00.000Z",
      retainUntil: null,
      summary: "Retention remains a local store detail",
    });

    expect(JSON.stringify(record)).not.toContain(dataDir);
    expect(JSON.stringify(await store.list("retention_policy"))).not.toContain(".pluto/compliance");

    const persisted = join(dataDir, "compliance", "retention_policy", "retention-1.json");
    expect(await readdir(join(dataDir, "compliance", "retention_policy"))).toEqual(["retention-1.json"]);
    expect(JSON.parse(await readFile(persisted, "utf8"))).toEqual(record);
  });

  it("uses a dedicated append-only event log without leaking file topology through reads", async () => {
    const dataDir = join(workDir, ".pluto");
    const store = new ComplianceStore({ dataDir });

    await store.recordEvent({
      schema: "pluto.compliance.action-event",
      schemaVersion: 0,
      id: "event-1",
      eventType: "compliance.decision",
      action: "decision",
      actor: {
        principalId: "reviewer-1",
        roleLabels: ["approver"],
      },
      target: {
        kind: "audit_export_manifest",
        recordId: "manifest-1",
        workspaceId: "workspace-1",
        summary: "Manifest decision target",
      },
      status: {
        before: "under_review",
        after: "approved",
        summary: "decision recorded for manifest-1",
      },
      evidenceRefs: ["sealed:evidence-1"],
      reason: null,
      createdAt: "2026-04-30T00:05:00.000Z",
      source: {
        command: "compliance-store-boundary.test",
        ref: "manifest-1",
      },
    });

    const events = await store.listEvents();
    expect(events).toHaveLength(1);
    expect(JSON.stringify(events[0])).not.toContain(dataDir);
    expect(JSON.stringify(events[0])).not.toContain("events.jsonl");
  });
});
