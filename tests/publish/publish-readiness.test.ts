import { describe, expect, it } from "vitest";

import { toImmutableEvidencePacketMetadataV0 } from "@/contracts/evidence-graph.js";
import type { SealedEvidenceRefV0 } from "@/contracts/evidence-graph.js";
import type { PublishAttemptRecordV0, PublishPackageRecordV0 } from "@/contracts/publish.js";
import { buildPublishReadiness } from "@/publish/readiness.js";

function makePackage(overrides: Partial<PublishPackageRecordV0> = {}): PublishPackageRecordV0 {
  return {
    schema: "pluto.publish.package",
    schemaVersion: 0,
    kind: "publish_package",
    id: "pkg-1",
    workspaceId: "workspace-1",
    documentId: "doc-1",
    versionId: "ver-1",
    ownerId: "owner-1",
    targetId: "web-primary",
    createdAt: "2026-04-30T00:00:00.000Z",
    updatedAt: "2026-04-30T00:00:01.000Z",
    status: "ready",
    sourceVersionRefs: [{ documentId: "doc-1", versionId: "ver-1" }],
    approvalRefs: ["approval-1"],
    sealedEvidenceRefs: ["sealed-1"],
    releaseReadinessRefs: [{ id: "rr-1", status: "ready", summary: "All gates passed" }],
    channelTargets: [{
      schemaVersion: 0,
      channelId: "web-primary",
      targetId: "site-homepage",
      targetKind: "cms_entry",
      destinationSummary: "Contentful homepage entry [REDACTED:destination]",
      readinessRef: "rr-1",
      approvalRef: "approval-1",
      blockedNotes: [],
      degradedNotes: [],
      status: "ready",
    }],
    publishReadyBlockedReasons: [],
    ...overrides,
  };
}

function makeSealedEvidence(): SealedEvidenceRefV0 {
  return {
    schemaVersion: 0,
    kind: "sealed_evidence",
    id: "sealed-1",
    packetId: "packet-1",
    runId: "run-1",
    evidencePath: ".pluto/runs/run-1/evidence.json",
    sealChecksum: "sha256:sealed-1",
    sealedAt: "2026-04-30T00:02:00.000Z",
    sourceRun: {
      runId: "run-1",
      status: "succeeded",
      blockerReason: null,
      finishedAt: "2026-04-30T00:01:00.000Z",
    },
    validationSummary: { outcome: "pass", reason: null },
    redactionSummary: {
      redactedAt: "2026-04-30T00:01:30.000Z",
      fieldsRedacted: 1,
      summary: "Redacted session metadata before sealing.",
    },
    immutablePacket: toImmutableEvidencePacketMetadataV0({
      schemaVersion: 0,
      status: "done",
      blockerReason: null,
      startedAt: "2026-04-30T00:00:00.000Z",
      finishedAt: "2026-04-30T00:01:00.000Z",
      workers: [],
      validation: { outcome: "pass", reason: null },
      classifierVersion: 0,
      generatedAt: "2026-04-30T00:01:05.000Z",
    }),
  };
}

function makeAttempt(idempotencyKey: string, summary = "Redacted connector request."): PublishAttemptRecordV0 {
  return {
    schema: "pluto.publish.attempt",
    schemaVersion: 0,
    id: `attempt-${idempotencyKey}`,
    publishPackageId: "pkg-1",
    exportAssetId: null,
    channelTarget: makePackage().channelTargets[0]!,
    idempotencyKey,
    publisher: {
      principalId: "publisher-1",
      roleLabels: ["release-manager"],
    },
    providerResultRefs: {
      externalRef: null,
      receiptPath: null,
      summary: "Dry-run summary only",
    },
    payloadSummary: {
      summary,
      redactedFields: ["authorization"],
      detailKeys: ["channelId"],
    },
    status: "queued",
    blockedReasons: [],
    createdAt: "2026-04-30T00:03:00.000Z",
  };
}

describe("publish readiness", () => {
  it("blocks missing approval", () => {
    const readiness = buildPublishReadiness({
      publishPackage: makePackage(),
      approvals: [],
      sealedEvidence: { "sealed-1": makeSealedEvidence() },
      publishAttempts: [],
    });

    expect(readiness.status).toBe("blocked");
    expect(readiness.blockedReasons).toContain("missing_approval");
  });

  it("blocks missing sealed evidence", () => {
    const readiness = buildPublishReadiness({
      publishPackage: makePackage(),
      approvals: ["approval-1"],
      sealedEvidence: {},
      publishAttempts: [],
    });

    expect(readiness.status).toBe("blocked");
    expect(readiness.blockedReasons).toContain("missing_sealed_evidence");
  });

  it("blocks failed readiness gates", () => {
    const readiness = buildPublishReadiness({
      publishPackage: makePackage({
        releaseReadinessRefs: [{ id: "rr-1", status: "blocked", summary: "A mandatory gate failed" }],
      }),
      approvals: ["approval-1"],
      sealedEvidence: { "sealed-1": makeSealedEvidence() },
      publishAttempts: [],
    });

    expect(readiness.status).toBe("blocked");
    expect(readiness.blockedReasons).toContain("failed_readiness_gate");
  });

  it("blocks duplicate idempotency keys across append-only attempts", () => {
    const readiness = buildPublishReadiness({
      publishPackage: makePackage(),
      approvals: ["approval-1"],
      sealedEvidence: { "sealed-1": makeSealedEvidence() },
      publishAttempts: [makeAttempt("idem-1"), makeAttempt("idem-1")],
    });

    expect(readiness.status).toBe("blocked");
    expect(readiness.blockedReasons).toContain("duplicate_idempotency_key");
    expect(readiness.duplicateIdempotencyKeys).toEqual(["idem-1"]);
  });

  it("blocks credential leakage even when an attempt record appears otherwise valid", () => {
    const readiness = buildPublishReadiness({
      publishPackage: makePackage(),
      approvals: ["approval-1"],
      sealedEvidence: { "sealed-1": makeSealedEvidence() },
      publishAttempts: [makeAttempt("idem-2", "authorization=Bearer super-secret-token")],
    });

    expect(readiness.status).toBe("blocked");
    expect(readiness.blockedReasons).toContain("credential_leakage");
  });

  it("returns ready when approvals, sealed evidence, readiness gates, and idempotency all pass", () => {
    const readiness = buildPublishReadiness({
      publishPackage: makePackage(),
      approvals: ["approval-1"],
      sealedEvidence: { "sealed-1": makeSealedEvidence() },
      publishAttempts: [makeAttempt("idem-3")],
    });

    expect(readiness).toEqual({
      schema: "pluto.publish.readiness",
      schemaVersion: 0,
      publishPackageId: "pkg-1",
      status: "ready",
      blockedReasons: [],
      duplicateIdempotencyKeys: [],
    });
  });
});
