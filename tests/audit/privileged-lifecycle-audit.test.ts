import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { GovernanceEventStore } from "@/audit/governance-event-store.js";
import { PublishStore } from "@/publish/publish-store.js";
import { ReleaseStore } from "@/release/release-store.js";
import { ReviewStore } from "@/review/review-store.js";

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

describe("privileged lifecycle audit", () => {
  let dataDir = "";

  afterEach(async () => {
    if (dataDir) {
      await rm(dataDir, { recursive: true, force: true });
    }
  });

  it("emits audit events across review, publish, and release lifecycle actions", async () => {
    dataDir = await mkdtemp(join(tmpdir(), "pluto-lifecycle-audit-"));
    const reviewStore = new ReviewStore({ dataDir });
    const publishStore = new PublishStore({ dataDir });
    const releaseStore = new ReleaseStore({ dataDir });
    const auditStore = new GovernanceEventStore({ dataDir });

    await reviewStore.putDecision({
      schema: "pluto.review.decision",
      schemaVersion: 0,
      id: "decision-approve-1",
      requestId: "approval-1",
      requestKind: "approval",
      target: {
        kind: "publish_package",
        documentId: "doc-1",
        versionId: "ver-1",
        packageId: "pkg-1",
      },
      event: "approved",
      actorId: "approver-1",
      comment: "Approved for release.",
      delegatedToId: null,
      recordedAt: "2026-04-30T00:01:00.000Z",
    });
    await reviewStore.putDecision({
      schema: "pluto.review.decision",
      schemaVersion: 0,
      id: "decision-revoke-1",
      requestId: "approval-1",
      requestKind: "approval",
      target: {
        kind: "publish_package",
        documentId: "doc-1",
        versionId: "ver-1",
        packageId: "pkg-1",
      },
      event: "revoked",
      actorId: "approver-1",
      comment: "Revoked after new evidence.",
      delegatedToId: null,
      recordedAt: "2026-04-30T00:02:00.000Z",
    });
    await reviewStore.putDecision({
      schema: "pluto.review.decision",
      schemaVersion: 0,
      id: "decision-delegate-1",
      requestId: "approval-2",
      requestKind: "approval",
      target: {
        kind: "publish_package",
        documentId: "doc-1",
        versionId: "ver-1",
        packageId: "pkg-1",
      },
      event: "delegated",
      actorId: "approver-1",
      comment: "Delegated for backup coverage.",
      delegatedToId: "approver-2",
      recordedAt: "2026-04-30T00:03:00.000Z",
    });
    await reviewStore.putDelegation({
      schema: "pluto.review.delegation",
      schemaVersion: 0,
      id: "delegation-1",
      workspaceId: "workspace-1",
      delegatorId: "approver-1",
      delegateeId: "approver-2",
      roleLabel: "release-approver",
      scope: {
        requestKind: "approval",
        requestId: "approval-2",
      },
      expiresAt: null,
      revokedAt: null,
      revokedById: null,
      createdAt: "2026-04-30T00:04:00.000Z",
    });

    await publishStore.putPublishPackage({
      schemaVersion: 0,
      kind: "publish_package",
      id: "pkg-1",
      workspaceId: "workspace-1",
      documentId: "doc-1",
      versionId: "ver-1",
      ownerId: "publisher-1",
      targetId: "site-homepage",
      createdAt: "2026-04-30T00:05:00.000Z",
      updatedAt: "2026-04-30T00:05:00.000Z",
      status: "ready",
      sourceVersionRefs: [{ documentId: "doc-1", versionId: "ver-1" }],
      approvalRefs: ["approval-1"],
      sealedEvidenceRefs: ["sealed:package-1"],
      releaseReadinessRefs: [{ id: "report-1", status: "ready", summary: "Ready" }],
      channelTargets: [makeChannelTarget()],
      publishReadyBlockedReasons: [],
    });
    await publishStore.putExportAssetRecord({
      schema: "pluto.publish.export-asset",
      schemaVersion: 0,
      id: "asset-1",
      publishPackageId: "pkg-1",
      workspaceId: "workspace-1",
      channelTarget: makeChannelTarget(),
      checksum: "sha256:asset-1",
      contentType: "application/json",
      sourceVersionRefs: [{ documentId: "doc-1", versionId: "ver-1" }],
      sealedEvidenceRefs: ["sealed:asset-1"],
      redactionSummary: {
        redactedAt: "2026-04-30T00:05:30.000Z",
        fieldsRedacted: 1,
        summary: "Credentials removed before seal.",
      },
      assetSummary: "homepage payload",
      createdAt: "2026-04-30T00:05:30.000Z",
    });
    await publishStore.recordPublishAttempt({
      schema: "pluto.publish.attempt",
      schemaVersion: 0,
      id: "attempt-1",
      publishPackageId: "pkg-1",
      exportAssetId: "asset-1",
      channelTarget: makeChannelTarget(),
      idempotencyKey: "idem-1",
      publisher: {
        principalId: "publisher-1",
        roleLabels: ["release-manager"],
      },
      providerResultRefs: {
        externalRef: "job-1",
        receiptPath: ".pluto/publish/receipts/job-1.json",
        summary: "Summary only",
      },
      payloadSummary: {
        summary: "Redacted connector request.",
        redactedFields: ["authorization"],
        detailKeys: ["channelId"],
      },
      status: "succeeded",
      blockedReasons: [],
      createdAt: "2026-04-30T00:06:00.000Z",
    });
    await publishStore.recordRollbackRetract({
      schema: "pluto.publish.rollback",
      schemaVersion: 0,
      id: "rollback-1",
      publishPackageId: "pkg-1",
      publishAttemptId: "attempt-1",
      action: "rollback",
      actorId: "publisher-1",
      reason: "Rollback after QA regression.",
      replacementPackageId: null,
      createdAt: "2026-04-30T00:07:00.000Z",
    });
    await publishStore.recordRollbackRetract({
      schema: "pluto.publish.rollback",
      schemaVersion: 0,
      id: "retract-1",
      publishPackageId: "pkg-1",
      publishAttemptId: "attempt-1",
      action: "retract",
      actorId: "publisher-1",
      reason: "Retracted for policy fix.",
      replacementPackageId: null,
      createdAt: "2026-04-30T00:08:00.000Z",
    });
    await publishStore.recordRollbackRetract({
      schema: "pluto.publish.rollback",
      schemaVersion: 0,
      id: "supersede-1",
      publishPackageId: "pkg-1",
      publishAttemptId: "attempt-1",
      action: "supersede",
      actorId: "publisher-1",
      reason: "Superseded by pkg-2.",
      replacementPackageId: "pkg-2",
      createdAt: "2026-04-30T00:09:00.000Z",
    });

    await releaseStore.putReleaseCandidate({
      schema: "pluto.release.candidate",
      schemaVersion: 0,
      id: "candidate-1",
      workspaceId: "workspace-1",
      documentId: "doc-1",
      versionId: "ver-1",
      packageId: "pkg-1",
      targetScope: {
        targetKind: "channel",
        targetId: "site-homepage",
        summary: "Homepage release",
      },
      candidateEvidenceRefs: ["sealed:candidate-1"],
      createdById: "publisher-1",
      status: "candidate",
      createdAt: "2026-04-30T00:10:00.000Z",
      updatedAt: "2026-04-30T00:10:00.000Z",
    });
    await releaseStore.putWaiver({
      schema: "pluto.release.waiver",
      schemaVersion: 0,
      id: "waiver-1",
      candidateId: "candidate-1",
      approverId: "approver-1",
      justification: "Approved exception.",
      scope: {
        candidateId: "candidate-1",
        gateIds: ["gate-1"],
      },
      approvalEvidenceRefs: ["sealed:approval"],
      decisionEvidenceRefs: ["sealed:decision"],
      status: "approved",
      expiresAt: null,
      createdAt: "2026-04-30T00:11:00.000Z",
      updatedAt: "2026-04-30T00:11:00.000Z",
    });
    await releaseStore.putWaiver({
      schema: "pluto.release.waiver",
      schemaVersion: 0,
      id: "waiver-1",
      candidateId: "candidate-1",
      approverId: "approver-1",
      justification: "Revoked exception.",
      scope: {
        candidateId: "candidate-1",
        gateIds: ["gate-1"],
      },
      approvalEvidenceRefs: ["sealed:approval"],
      decisionEvidenceRefs: ["sealed:decision"],
      status: "revoked",
      expiresAt: null,
      createdAt: "2026-04-30T00:11:00.000Z",
      updatedAt: "2026-04-30T00:12:00.000Z",
    });
    await releaseStore.putReadinessReport({
      schema: "pluto.release.readiness-report",
      schemaVersion: 0,
      id: "report-1",
      candidateId: "candidate-1",
      workspaceId: "workspace-1",
      documentId: "doc-1",
      versionId: "ver-1",
      packageId: "pkg-1",
      status: "blocked",
      blockedReasons: ["gate:gate-1:failed"],
      generatedAt: "2026-04-30T00:13:00.000Z",
      gateResults: [],
      waiverIds: ["waiver-1"],
      testEvidenceRefs: ["sealed:test-1"],
      evalEvidenceRefs: [],
      manualCheckEvidenceRefs: [],
      artifactCheckEvidenceRefs: ["sealed:artifact-1"],
      evalRubricRefs: [],
      evalRubricSummaries: [],
    });

    const governanceEvents = await auditStore.list();
    expect(governanceEvents.map((event) => event.eventType)).toEqual([
      "decision_recorded",
      "approval_granted",
      "decision_recorded",
      "approval_revoked",
      "decision_recorded",
      "delegation_changed",
      "delegation_changed",
      "package_assembled",
      "export_sealed",
      "publish_attempted",
      "rollback_recorded",
      "retract_recorded",
      "supersede_recorded",
      "waiver_approved",
      "waiver_revoked",
      "readiness_evaluated",
    ]);

    expect(governanceEvents.find((event) => event.eventType === "package_assembled")).toMatchObject({
      target: { kind: "publish_package", recordId: "pkg-1" },
      evidenceRefs: ["sealed:package-1"],
    });
    expect(governanceEvents.find((event) => event.eventType === "waiver_revoked")).toMatchObject({
      status: { before: "approved", after: "revoked" },
    });
    expect(governanceEvents.find((event) => event.eventType === "readiness_evaluated")).toMatchObject({
      evidenceRefs: ["sealed:candidate-1", "sealed:test-1", "sealed:artifact-1"],
    });
  });
});
