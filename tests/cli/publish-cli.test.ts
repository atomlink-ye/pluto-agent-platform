import { execFile } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { toImmutableEvidencePacketMetadataV0 } from "@/contracts/evidence-graph.js";
import { EvidenceGraphStore } from "@/evidence/evidence-graph.js";
import { PublishStore } from "@/publish/publish-store.js";
import { ReleaseStore } from "@/release/release-store.js";
import { ReviewStore } from "@/review/review-store.js";

const exec = promisify(execFile);

let workDir: string;
let dataDir: string;

async function runCli(args: string[]): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  try {
    const result = await exec("npx", ["tsx", join(process.cwd(), "src/cli/publish.ts"), ...args], {
      cwd: process.cwd(),
      env: { ...process.env, PLUTO_DATA_DIR: dataDir },
      timeout: 10_000,
    });
    return { stdout: result.stdout, stderr: result.stderr, exitCode: 0 };
  } catch (err: unknown) {
    const e = err as { stdout?: string; stderr?: string; code?: number };
    return { stdout: e.stdout ?? "", stderr: e.stderr ?? "", exitCode: e.code ?? 1 };
  }
}

beforeEach(async () => {
  workDir = await mkdtemp(join(tmpdir(), "pluto-publish-cli-test-"));
  dataDir = join(workDir, ".pluto");

  const publishStore = new PublishStore({ dataDir });
  const evidenceStore = new EvidenceGraphStore({ dataDir });
  const releaseStore = new ReleaseStore({ dataDir });
  const reviewStore = new ReviewStore({ dataDir });

  await publishStore.putPublishPackage({
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
    releaseReadinessRefs: [{ id: "report-1", status: "ready", summary: "All gates passed" }],
    channelTargets: [{
      schemaVersion: 0,
      channelId: "web-primary",
      targetId: "homepage",
      targetKind: "cms_entry",
      destinationSummary: "Contentful homepage [REDACTED:destination]",
      readinessRef: "report-1",
      approvalRef: "approval-1",
      blockedNotes: [],
      degradedNotes: [],
      status: "ready",
    }],
    publishReadyBlockedReasons: [],
  });

  await evidenceStore.putSealedEvidenceRef({
    id: "sealed-1",
    runId: "run-1",
    evidencePath: ".pluto/runs/run-1/evidence.json",
    sealChecksum: "sha256:sealed-1",
    sealedAt: "2026-04-30T00:02:00.000Z",
    sourceRun: { runId: "run-1", status: "done", blockerReason: null, finishedAt: "2026-04-30T00:01:00.000Z" },
    redactionSummary: { redactedAt: "2026-04-30T00:01:30.000Z", fieldsRedacted: 1, summary: "Redacted export metadata" },
    immutablePacket: { ...toImmutableEvidencePacketMetadataV0({
      schemaVersion: 0,
      status: "done",
      blockerReason: null,
      startedAt: "2026-04-30T00:00:00.000Z",
      finishedAt: "2026-04-30T00:01:00.000Z",
      generatedAt: "2026-04-30T00:01:05.000Z",
      classifierVersion: 0,
      workers: [],
      validation: { outcome: "pass", reason: null },
    }) },
  });

  await publishStore.putExportAssetRecord({
    schema: "pluto.publish.export-asset",
    schemaVersion: 0,
    id: "asset-1",
    publishPackageId: "pkg-1",
    workspaceId: "workspace-1",
    channelTarget: {
      schemaVersion: 0,
      channelId: "web-primary",
      targetId: "homepage",
      targetKind: "cms_entry",
      destinationSummary: "Contentful homepage [REDACTED:destination]",
      readinessRef: "report-1",
      approvalRef: "approval-1",
      blockedNotes: [],
      degradedNotes: [],
    },
    checksum: "sha256:asset-1",
    contentType: "application/json",
    sourceVersionRefs: [{ documentId: "doc-1", versionId: "ver-1" }],
    sealedEvidenceRefs: ["sealed-1"],
    redactionSummary: { redactedAt: "2026-04-30T00:03:00.000Z", fieldsRedacted: 2, summary: "Removed credential-bearing fields" },
    assetSummary: "Publish manifest",
    createdAt: "2026-04-30T00:03:00.000Z",
  });

  await publishStore.recordPublishAttempt({
    schema: "pluto.publish.attempt",
    schemaVersion: 0,
    id: "attempt-1",
    publishPackageId: "pkg-1",
    exportAssetId: "asset-1",
    channelTarget: {
      schemaVersion: 0,
      channelId: "web-primary",
      targetId: "homepage",
      targetKind: "cms_entry",
      destinationSummary: "Contentful homepage [REDACTED:destination]",
      readinessRef: "report-1",
      approvalRef: "approval-1",
      blockedNotes: [],
      degradedNotes: [],
      status: "ready",
    },
    idempotencyKey: "idem-1",
    publisher: { principalId: "publisher-1", roleLabels: ["release-manager"] },
    providerResultRefs: { externalRef: null, receiptPath: null, summary: "Dry run only" },
    payloadSummary: { summary: "Request redacted before persistence", redactedFields: ["authorization"], detailKeys: ["channelId"] },
    status: "queued",
    blockedReasons: [],
    createdAt: "2026-04-30T00:04:00.000Z",
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
    status: "ready",
    blockedReasons: [],
    generatedAt: "2026-04-30T00:05:00.000Z",
    gateResults: [],
    waiverIds: [],
    testEvidenceRefs: ["sealed:test"],
    evalEvidenceRefs: ["sealed:eval"],
    manualCheckEvidenceRefs: [],
    artifactCheckEvidenceRefs: [],
    evalRubricRefs: [],
    evalRubricSummaries: [],
  });

  await reviewStore.putDecision({
    schema: "pluto.review.decision",
    schemaVersion: 0,
    id: "decision-1",
    requestId: "approval-1",
    requestKind: "approval",
    target: {
      kind: "version",
      documentId: "doc-1",
      versionId: "ver-1",
    },
    event: "approved",
    actorId: "approver-1",
    comment: null,
    delegatedToId: null,
    recordedAt: "2026-04-30T00:04:30.000Z",
  });
});

afterEach(async () => {
  await rm(workDir, { recursive: true, force: true });
});

describe("publish cli", () => {
  it("lists publish packages", async () => {
    const { stdout, exitCode } = await runCli(["packages"]);
    expect(exitCode).toBe(0);
    expect(stdout).toContain("pkg-1 ready");
  });

  it("shows publish package detail in json mode", async () => {
    const { stdout, exitCode } = await runCli(["packages", "pkg-1", "--json"]);
    expect(exitCode).toBe(0);
    const output = JSON.parse(stdout) as { publishPackage: { id: string }; publishAttempts: Array<{ payloadSummary: string }> };
    expect(output.publishPackage.id).toBe("pkg-1");
    expect(output.publishAttempts[0]?.payloadSummary).toBe("Request redacted before persistence");
  });

  it("renders publish readiness with redacted summaries", async () => {
    const { stdout, exitCode } = await runCli(["readiness", "pkg-1"]);
    expect(exitCode).toBe(0);
    expect(stdout).toContain("Status: ready");
    expect(stdout).toContain("Contentful homepage [REDACTED:destination]");
    expect(stdout).toContain("Removed credential-bearing fields");
    expect(stdout).toContain("Request redacted before persistence");
  });

  it("blocks readiness when an approval is later revoked", async () => {
    const reviewStore = new ReviewStore({ dataDir });
    await reviewStore.putDecision({
      schema: "pluto.review.decision",
      schemaVersion: 0,
      id: "decision-2",
      requestId: "approval-1",
      requestKind: "approval",
      target: {
        kind: "version",
        documentId: "doc-1",
        versionId: "ver-1",
      },
      event: "revoked",
      actorId: "approver-1",
      comment: null,
      delegatedToId: null,
      recordedAt: "2026-04-30T00:06:00.000Z",
    });

    const { stdout, exitCode } = await runCli(["readiness", "pkg-1"]);
    expect(exitCode).toBe(0);
    expect(stdout).toContain("Status: blocked");
    expect(stdout).toContain("missing_approval");
  });
});
