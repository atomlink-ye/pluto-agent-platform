import { execFile } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { toImmutableEvidencePacketMetadataV0 } from "@/contracts/evidence-graph.js";
import type { DecisionRecordV0, ReviewRequestV0, ApprovalRequestV0 } from "@/contracts/review.js";
import type { VersionRecordV0 } from "@/contracts/governance.js";
import { EvidenceGraphStore } from "@/evidence/evidence-graph.js";
import { GovernanceStore } from "@/governance/governance-store.js";
import { ReviewStore } from "@/review/review-store.js";

const exec = promisify(execFile);

let workDir: string;
let dataDir: string;

async function runCli(args: string[]): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  try {
    const result = await exec("npx", ["tsx", join(process.cwd(), "src/cli/review.ts"), ...args], {
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

function makeVersion(): VersionRecordV0 {
  return {
    schemaVersion: 0,
    kind: "version",
    id: "ver-1",
    workspaceId: "workspace-1",
    documentId: "doc-1",
    createdById: "author-1",
    label: "v1",
    createdAt: "2026-04-30T00:00:00.000Z",
    updatedAt: "2026-04-30T00:01:00.000Z",
    status: "active",
  };
}

function makeReviewRequest(): ReviewRequestV0 {
  return {
    schema: "pluto.review.request",
    schemaVersion: 0,
    id: "review-1",
    workspaceId: "workspace-1",
    target: { kind: "version", documentId: "doc-1", versionId: "ver-1" },
    requestedById: "requester-1",
    assigneeIds: ["reviewer-1"],
    status: "requested",
    evidenceRequirements: [{ ref: "sealed-1", required: true }],
    diffSnapshot: { diffId: "diff-1", path: ".pluto/review/diffs/diff-1.patch" },
    createdAt: "2026-04-30T00:00:00.000Z",
    updatedAt: "2026-04-30T00:00:00.000Z",
    requestedAt: "2026-04-30T00:00:00.000Z",
  };
}

function makeApprovalRequest(): ApprovalRequestV0 {
  return {
    schema: "pluto.review.approval-request",
    schemaVersion: 0,
    id: "approval-1",
    workspaceId: "workspace-1",
    target: { kind: "publish_package", documentId: "doc-1", versionId: "ver-1", packageId: "pkg-1" },
    requestedById: "requester-1",
    assigneeIds: ["approver-1"],
    status: "requested",
    evidenceRequirements: [{ ref: "sealed-2", required: true }],
    diffSnapshot: { diffId: "diff-2", path: ".pluto/review/diffs/diff-2.patch" },
    approvalPolicy: { policyId: "policy-1", summary: "Needs release approval" },
    requiredApproverRoles: [{ roleLabel: "release_manager", minApprovers: 1 }],
    decisionSummary: { latestDecisionId: null, latestEvent: null, decidedAt: null, summary: "Waiting" },
    blockedReasons: ["missing_sealed_evidence"],
    createdAt: "2026-04-30T00:00:00.000Z",
    updatedAt: "2026-04-30T00:00:00.000Z",
    requestedAt: "2026-04-30T00:00:00.000Z",
  };
}

function makeDecision(): DecisionRecordV0 {
  return {
    schema: "pluto.review.decision",
    schemaVersion: 0,
    id: "decision-1",
    requestId: "review-1",
    requestKind: "review",
    target: { kind: "version", documentId: "doc-1", versionId: "ver-1" },
    event: "commented",
    actorId: "reviewer-1",
    comment: "Redacted summary only",
    delegatedToId: null,
    recordedAt: "2026-04-30T00:03:00.000Z",
  };
}

beforeEach(async () => {
  workDir = await mkdtemp(join(tmpdir(), "pluto-review-cli-test-"));
  dataDir = join(workDir, ".pluto");

  const governanceStore = new GovernanceStore({ dataDir });
  const reviewStore = new ReviewStore({ dataDir });
  const evidenceStore = new EvidenceGraphStore({ dataDir });
  await governanceStore.put("version", makeVersion());
  await reviewStore.putReviewRequest(makeReviewRequest());
  await reviewStore.putApprovalRequest(makeApprovalRequest());
  await reviewStore.putDecision(makeDecision());
  await evidenceStore.putSealedEvidenceRef({
    id: "sealed-1",
    runId: "run-1",
    evidencePath: ".pluto/runs/run-1/evidence.json",
    sealChecksum: "sha256:sealed-1",
    sealedAt: "2026-04-30T00:02:00.000Z",
    sourceRun: { runId: "run-1", status: "done", blockerReason: null, finishedAt: "2026-04-30T00:01:00.000Z" },
    redactionSummary: { redactedAt: "2026-04-30T00:01:30.000Z", fieldsRedacted: 1, summary: "Redacted before seal" },
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
});

afterEach(async () => {
  await rm(workDir, { recursive: true, force: true });
});

describe("review cli", () => {
  it("renders review queue output", async () => {
    const { stdout, exitCode } = await runCli(["queue", "--actor", "reviewer-1", "--roles", "reviewer"]);
    expect(exitCode).toBe(0);
    expect(stdout).toContain("review-1 requested");
    expect(stdout).toContain("blockedReasons: none");
  });

  it("renders approval queue blocked reasons in json mode", async () => {
    const { stdout, exitCode } = await runCli(["approval-queue", "--actor", "approver-1", "--roles", "release_manager", "--json"]);
    expect(exitCode).toBe(0);
    const output = JSON.parse(stdout) as { items: Array<{ requestId: string; blockedReasons: string[] }> };
    expect(output.items[0]).toMatchObject({ requestId: "approval-1" });
    expect(output.items[0]?.blockedReasons).toContain("missing_sealed_evidence");
  });

  it("renders decision history with projection blocked reasons", async () => {
    const { stdout, exitCode } = await runCli(["decision-history", "review-1"]);
    expect(exitCode).toBe(0);
    expect(stdout).toContain("Request: review-1");
    expect(stdout).toContain("Blocked reasons: none");
    expect(stdout).toContain("commented actor=reviewer-1");
  });

  it("renders empty state when no review queue items match actor", async () => {
    const { stdout, exitCode } = await runCli(["queue", "--actor", "nobody", "--roles", "observer"]);
    expect(exitCode).toBe(0);
    expect(stdout).toContain("No review queue items found.");
  });
});
