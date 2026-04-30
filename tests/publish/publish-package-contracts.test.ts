import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  toPublishAttemptRecordV0,
  toPublishPackageRecordV0,
  validateExportAssetRecordV0,
  validatePublishAttemptRecordV0,
  validatePublishPackageRecordV0,
  validateRollbackRetractRecordV0,
} from "@/contracts/publish.js";
import { PublishStore, publishDir } from "@/publish/publish-store.js";

const baseGovernancePackage = {
  schemaVersion: 0 as const,
  kind: "publish_package" as const,
  id: "pkg-1",
  workspaceId: "workspace-1",
  documentId: "doc-1",
  versionId: "ver-1",
  ownerId: "owner-1",
  targetId: "web-primary",
  createdAt: "2026-04-30T00:00:00.000Z",
  updatedAt: "2026-04-30T00:00:01.000Z",
  status: "ready",
};

function makeChannelTarget() {
  return {
    schemaVersion: 0 as const,
    channelId: "web-primary",
    targetId: "site-homepage",
    targetKind: "cms_entry",
    destinationSummary: "Contentful homepage entry [REDACTED:destination]",
    readinessRef: "rr-1",
    approvalRef: "approval-1",
    blockedNotes: [],
    degradedNotes: [],
    status: "ready",
  };
}

describe("publish package contracts", () => {
  let dataDir = "";

  afterEach(async () => {
    if (dataDir) {
      await rm(dataDir, { recursive: true, force: true });
    }
  });

  it("preserves baseline publish package vocabulary while extending it for slice 7", () => {
    const result = validatePublishPackageRecordV0(baseGovernancePackage);

    expect(result.ok).toBe(true);
    expect(result.ok ? result.value : null).toMatchObject({
      ...baseGovernancePackage,
      schema: "pluto.publish.package",
      sourceVersionRefs: [{ documentId: "doc-1", versionId: "ver-1" }],
      approvalRefs: [],
      sealedEvidenceRefs: [],
      releaseReadinessRefs: [],
      publishReadyBlockedReasons: [],
    });
  });

  it("validates package, export asset, attempt, and rollback records with checksum fields", () => {
    const publishPackage = toPublishPackageRecordV0({
      ...baseGovernancePackage,
      approvalRefs: ["approval-1"],
      sealedEvidenceRefs: ["sealed-1"],
      releaseReadinessRefs: [{ id: "rr-1", status: "ready", summary: "All gates passed" }],
      channelTargets: [makeChannelTarget()],
    });

    expect(validatePublishPackageRecordV0(publishPackage).ok).toBe(true);

    expect(validateExportAssetRecordV0({
      schema: "pluto.publish.export-asset",
      schemaVersion: 0,
      id: "asset-1",
      publishPackageId: publishPackage.id,
      workspaceId: publishPackage.workspaceId,
      channelTarget: makeChannelTarget(),
      checksum: "sha256:asset-1",
      contentType: "text/markdown",
      sourceVersionRefs: [{ documentId: "doc-1", versionId: "ver-1", label: "v1" }],
      sealedEvidenceRefs: ["sealed-1"],
      redactionSummary: {
        redactedAt: "2026-04-30T00:03:00.000Z",
        fieldsRedacted: 2,
        summary: "Removed connector headers and workspace paths before export.",
      },
      assetSummary: "Homepage release package",
      createdAt: "2026-04-30T00:04:00.000Z",
    }).ok).toBe(true);

    expect(validatePublishAttemptRecordV0({
      schema: "pluto.publish.attempt",
      schemaVersion: 0,
      id: "attempt-1",
      publishPackageId: publishPackage.id,
      exportAssetId: "asset-1",
      channelTarget: makeChannelTarget(),
      idempotencyKey: "idem-1",
      publisher: {
        principalId: "publisher-1",
        roleLabels: ["release-manager"],
      },
      providerResultRefs: {
        externalRef: "job-123",
        receiptPath: ".pluto/publish/receipts/job-123.json",
        summary: "Dry-run connector response summary only",
      },
      payloadSummary: {
        summary: "Credential-redacted connector request for homepage publish.",
        redactedFields: ["authorization", "apiKey"],
        detailKeys: ["channelId", "entryId"],
      },
      status: "succeeded",
      blockedReasons: [],
      createdAt: "2026-04-30T00:05:00.000Z",
    }).ok).toBe(true);

    expect(validateRollbackRetractRecordV0({
      schema: "pluto.publish.rollback",
      schemaVersion: 0,
      id: "rollback-1",
      publishPackageId: publishPackage.id,
      publishAttemptId: "attempt-1",
      action: "rollback",
      actorId: "publisher-1",
      reason: "Manual rollback after QA detected stale screenshot.",
      replacementPackageId: null,
      createdAt: "2026-04-30T00:06:00.000Z",
    }).ok).toBe(true);
  });

  it("rejects credential-bearing payloads instead of persisting them", async () => {
    dataDir = await mkdtemp(join(tmpdir(), "pluto-publish-contracts-"));
    const store = new PublishStore({ dataDir });

    await expect(store.recordPublishAttempt({
      schema: "pluto.publish.attempt",
      schemaVersion: 0,
      id: "attempt-secret",
      publishPackageId: "pkg-1",
      exportAssetId: null,
      channelTarget: makeChannelTarget(),
      idempotencyKey: "idem-secret",
      publisher: {
        principalId: "publisher-1",
        roleLabels: ["release-manager"],
      },
      providerResultRefs: {
        externalRef: null,
        receiptPath: null,
        summary: "Dry-run only",
      },
      payloadSummary: {
        summary: "apiKey=super-secret",
        redactedFields: [],
        detailKeys: ["channelId"],
      },
      status: "blocked",
      blockedReasons: ["credential_leakage"],
      createdAt: "2026-04-30T00:05:00.000Z",
    })).rejects.toThrow("credential leakage detected");

    expect(await store.listPublishAttempts()).toEqual([]);
  });

  it("persists only the redacted payload summary shape for attempts", async () => {
    dataDir = await mkdtemp(join(tmpdir(), "pluto-publish-redaction-"));
    const store = new PublishStore({ dataDir });

    await store.recordPublishAttempt({
      ...toPublishAttemptRecordV0({
        schema: "pluto.publish.attempt",
        schemaVersion: 0,
        id: "attempt-safe",
        publishPackageId: "pkg-1",
        exportAssetId: null,
        channelTarget: makeChannelTarget(),
        idempotencyKey: "idem-safe",
        publisher: {
          principalId: "publisher-1",
          roleLabels: ["release-manager"],
        },
        providerResultRefs: {
          externalRef: null,
          receiptPath: null,
          summary: "Summary only",
        },
        payloadSummary: {
          summary: "Redacted connector request for homepage publish.",
          redactedFields: ["authorization", "apiKey"],
          detailKeys: ["channelId", "entryId"],
        },
        status: "queued",
        blockedReasons: [],
        createdAt: "2026-04-30T00:05:00.000Z",
      }),
    });

    const raw = await readFile(join(publishDir(dataDir, "attempts"), "attempt-safe.json"), "utf8");
    expect(raw).toContain("Redacted connector request for homepage publish.");
    expect(raw).not.toContain("super-secret");
    expect(raw).not.toContain('"credentials"');
  });
});
