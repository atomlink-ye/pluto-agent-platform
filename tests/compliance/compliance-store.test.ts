import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type {
  AuditExportManifestV0,
  ComplianceActionEventV0,
  ComplianceEvidenceV0,
  DeletionAttemptV0,
  LegalHoldV0,
  RetentionPolicyV0,
} from "@/compliance/compliance-store.js";
import { ComplianceStore } from "@/compliance/compliance-store.js";
import {
  toGovernedDocumentRefV0,
  toGovernedPublishPackageRefV0,
  toGovernedVersionRefV0,
} from "@/contracts/compliance.js";

let workDir = "";

beforeEach(async () => {
  workDir = await mkdtemp(join(tmpdir(), "pluto-compliance-store-test-"));
});

afterEach(async () => {
  await rm(workDir, { recursive: true, force: true });
});

function makeRetentionPolicy(): RetentionPolicyV0 {
  return {
    schema: "pluto.compliance.retention-policy",
    schemaVersion: 0,
    id: "retention-1",
    workspaceId: "workspace-1",
    status: "active",
    retentionClass: "regulated",
    governedRefs: [toGovernedDocumentRefV0({ documentId: "doc-1", workspaceId: "workspace-1", summary: "Governed launch plan" })],
    assignedById: "compliance-officer-1",
    effectiveAt: "2026-04-30T00:00:00.000Z",
    retainUntil: null,
    summary: "Seven year retention for release artifacts",
  };
}

function makeLegalHold(): LegalHoldV0 {
  return {
    schema: "pluto.compliance.legal-hold",
    schemaVersion: 0,
    id: "hold-1",
    workspaceId: "workspace-1",
    status: "placed",
    governedRefs: [toGovernedVersionRefV0({
      documentId: "doc-1",
      versionId: "ver-1",
      workspaceId: "workspace-1",
      summary: "Release candidate version",
    })],
    placedById: "custodian-1",
    placedAt: "2026-04-30T00:01:00.000Z",
    releasedAt: null,
    releaseReviewRef: null,
    releaseApprovalRef: null,
    reason: "Pending regulator inquiry",
    summary: "Hold on release evidence chain",
  };
}

function makeDeletionAttempt(): DeletionAttemptV0 {
  return {
    schema: "pluto.compliance.deletion-attempt",
    schemaVersion: 0,
    id: "delete-1",
    workspaceId: "workspace-1",
    targetRef: toGovernedPublishPackageRefV0({
      id: "pkg-1",
      workspaceId: "workspace-1",
      documentId: "doc-1",
      versionId: "ver-1",
      summary: "Release package",
    }),
    requestedById: "compliance-officer-1",
    requestedAt: "2026-04-30T00:02:00.000Z",
    mode: "hard_delete",
    outcome: "blocked",
    blockReason: "legal_hold_active",
    evidenceRefs: ["sealed:evidence-1"],
    summary: "Deletion blocked by active legal hold",
    recordedAt: "2026-04-30T00:02:00.000Z",
  };
}

function makeEvidence(): ComplianceEvidenceV0 {
  return {
    schema: "pluto.compliance.evidence",
    schemaVersion: 0,
    id: "evidence-1",
    workspaceId: "workspace-1",
    subjectRef: toGovernedPublishPackageRefV0({
      id: "pkg-1",
      workspaceId: "workspace-1",
      documentId: "doc-1",
      versionId: "ver-1",
      summary: "Release package",
    }),
    supportingRefs: [toGovernedVersionRefV0({ documentId: "doc-1", versionId: "ver-1", workspaceId: "workspace-1" })],
    evidenceRefs: ["sealed:evidence-1", "approval-1"],
    summary: "Evidence packet for export readiness",
    validationOutcome: "approved",
    recordedById: "compliance-officer-1",
    recordedAt: "2026-04-30T00:03:00.000Z",
  };
}

function makeManifest(): AuditExportManifestV0 & {
  selectedContentRange: {
    startRef: string;
    endRef: string;
    itemCount: number;
    summary: string;
  };
} {
  return {
    schema: "pluto.compliance.audit-export-manifest",
    schemaVersion: 0,
    id: "manifest-1",
    workspaceId: "workspace-1",
    status: "generated",
    governedChain: [
      toGovernedDocumentRefV0({ documentId: "doc-1", workspaceId: "workspace-1", summary: "Governed launch plan" }),
      toGovernedPublishPackageRefV0({
        id: "pkg-1",
        workspaceId: "workspace-1",
        documentId: "doc-1",
        versionId: "ver-1",
        summary: "Release package",
      }),
    ],
    evidenceRefs: ["sealed:evidence-1"],
    complianceEventRefs: ["event-1"],
    createdById: "exporter-1",
    createdAt: "2026-04-30T00:04:00.000Z",
    retentionSummary: {
      policyIds: ["retention-1"],
      summary: "Seven year retention for release artifacts",
    },
    holdSummary: {
      holdIds: ["hold-1"],
      summary: "Hold on release evidence chain",
    },
    checksumSummary: {
      algorithm: "sha256",
      digest: "manifest-checksum-1",
    },
    recipient: {
      name: "Local compliance export",
      deliveryMethod: "local_download",
      destination: null,
    },
    localSignature: {
      status: "signed",
      signedAt: "2026-04-30T00:04:00.000Z",
      sealId: "local-v0:manifest-1",
    },
    selectedContentRange: {
      startRef: "doc-1",
      endRef: "pkg-1",
      itemCount: 2,
      summary: "Governed chain export",
    },
  };
}

function makeEvent(): ComplianceActionEventV0 {
  return {
    schema: "pluto.compliance.action-event",
    schemaVersion: 0,
    id: "event-1",
    eventType: "compliance.approval",
    action: "approval",
    actor: {
      principalId: "compliance-officer-1",
      roleLabels: ["compliance"],
    },
      target: { kind: "audit_export_manifest", recordId: "manifest-1", workspaceId: "workspace-1" },
    status: {
      before: "under_review",
      after: "approved",
      summary: "approval recorded for manifest-1",
    },
    evidenceRefs: ["sealed:evidence-1"],
    reason: "Evidence chain satisfies release audit requirements.",
    createdAt: "2026-04-30T00:05:00.000Z",
    source: {
      command: "compliance-store.test",
      ref: "manifest-1",
    },
  };
}

describe("ComplianceStore", () => {
  it("round-trips compliance records and append-only events", async () => {
    const store = new ComplianceStore({ dataDir: join(workDir, ".pluto") });

    const retention = makeRetentionPolicy();
    const hold = makeLegalHold();
    const deletionAttempt = makeDeletionAttempt();
    const evidence = makeEvidence();
    const manifest = makeManifest();
    const event = makeEvent();

    await expect(store.put("retention_policy", retention)).resolves.toEqual(retention);
    await expect(store.put("legal_hold", hold)).resolves.toEqual(hold);
    await expect(store.put("deletion_attempt", deletionAttempt)).resolves.toEqual(deletionAttempt);
    await expect(store.put("evidence", evidence)).resolves.toEqual(evidence);
    await expect(store.put("audit_export_manifest", manifest)).resolves.toEqual(manifest);
    await expect(store.recordEvent(event)).resolves.toEqual(event);

    await expect(store.get("retention_policy", retention.id)).resolves.toEqual(retention);
    await expect(store.get("legal_hold", hold.id)).resolves.toEqual(hold);
    await expect(store.get("deletion_attempt", deletionAttempt.id)).resolves.toEqual(deletionAttempt);
    await expect(store.get("evidence", evidence.id)).resolves.toEqual(evidence);
    await expect(store.get("audit_export_manifest", manifest.id)).resolves.toEqual(manifest);
    await expect(store.getEvent(event.id)).resolves.toEqual(event);

    await expect(store.list("retention_policy")).resolves.toEqual([retention]);
    await expect(store.list("legal_hold")).resolves.toEqual([hold]);
    await expect(store.list("deletion_attempt")).resolves.toEqual([deletionAttempt]);
    await expect(store.list("evidence")).resolves.toEqual([evidence]);
    await expect(store.list("audit_export_manifest")).resolves.toEqual([manifest]);
    await expect(store.listEvents()).resolves.toEqual([event]);

    const manifestPath = join(workDir, ".pluto", "compliance", "audit_export_manifest", "manifest-1.json");
    await expect(readFile(manifestPath, "utf8")).resolves.toBe(`${JSON.stringify(manifest, null, 2)}\n`);
  });

  it("returns empty reads for missing records and reports supported kinds", async () => {
    const store = new ComplianceStore({ dataDir: join(workDir, ".pluto") });

    await expect(store.get("retention_policy", "missing")).resolves.toBeNull();
    await expect(store.getEvent("missing")).resolves.toBeNull();
    await expect(store.list("audit_export_manifest")).resolves.toEqual([]);
    await expect(store.listEvents({ actorId: "missing" })).resolves.toEqual([]);
    await expect(store.listKinds()).resolves.toEqual([
      "retention_policy",
      "legal_hold",
      "deletion_attempt",
      "evidence",
      "audit_export_manifest",
    ]);
  });
});
