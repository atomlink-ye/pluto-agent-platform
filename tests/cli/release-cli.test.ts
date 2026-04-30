import { execFile } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { ReleaseStore } from "@/release/release-store.js";

const exec = promisify(execFile);

let workDir: string;
let dataDir: string;

async function runCli(args: string[]): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  try {
    const result = await exec("npx", ["tsx", join(process.cwd(), "src/cli/release.ts"), ...args], {
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
  workDir = await mkdtemp(join(tmpdir(), "pluto-release-cli-test-"));
  dataDir = join(workDir, ".pluto");

  const releaseStore = new ReleaseStore({ dataDir });
  await releaseStore.putReleaseCandidate({
    schema: "pluto.release.candidate",
    schemaVersion: 0,
    id: "candidate-1",
    workspaceId: "workspace-1",
    documentId: "doc-1",
    versionId: "ver-1",
    packageId: "pkg-1",
    targetScope: { targetKind: "channel", targetId: "web-primary", summary: "Docs site rollout" },
    candidateEvidenceRefs: ["sealed:candidate"],
    createdById: "publisher-1",
    status: "candidate",
    createdAt: "2026-04-30T00:00:00.000Z",
    updatedAt: "2026-04-30T00:01:00.000Z",
  });
  await releaseStore.putWaiver({
    schema: "pluto.release.waiver",
    schemaVersion: 0,
    id: "waiver-1",
    candidateId: "candidate-1",
    approverId: "approver-1",
    justification: "Approved exception",
    scope: { candidateId: "candidate-1", gateIds: ["gate-tests"] },
    approvalEvidenceRefs: ["sealed:approval"],
    decisionEvidenceRefs: ["sealed:decision"],
    status: "approved",
    expiresAt: null,
    createdAt: "2026-04-30T00:02:00.000Z",
    updatedAt: "2026-04-30T00:03:00.000Z",
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
    blockedReasons: ["gate:gate-security:failed"],
    generatedAt: "2026-04-30T00:04:00.000Z",
    gateResults: [{
      gateId: "gate-tests",
      gateKind: "test",
      label: "Unit tests",
      mandatory: true,
      observedOutcome: "fail",
      effectiveOutcome: "waived",
      waivedBy: "waiver-1",
      expectedEvidenceRefs: ["sealed:test"],
      observedEvidenceRefs: ["sealed:test"],
      evalRubricRefId: null,
      blockedReasons: [],
    }],
    waiverIds: ["waiver-1"],
    testEvidenceRefs: ["sealed:test"],
    evalEvidenceRefs: ["sealed:eval-summary"],
    manualCheckEvidenceRefs: ["sealed:manual"],
    artifactCheckEvidenceRefs: ["sealed:artifact"],
    evalRubricRefs: [],
    evalRubricSummaries: [],
  });
});

afterEach(async () => {
  await rm(workDir, { recursive: true, force: true });
});

describe("release cli", () => {
  it("renders release readiness with tests-vs-evals separation and waiver state", async () => {
    const { stdout, exitCode } = await runCli(["readiness", "candidate-1"]);
    expect(exitCode).toBe(0);
    expect(stdout).toContain("Status: blocked");
    expect(stdout).toContain("Waivers: waiver-1:approved");
    expect(stdout).toContain("Tests: sealed:test");
    expect(stdout).toContain("Evals: sealed:eval-summary");
    expect(stdout).toContain("Manual checks: sealed:manual");
    expect(stdout).toContain("Artifact checks: sealed:artifact");
  });

  it("renders readiness json payload", async () => {
    const { stdout, exitCode } = await runCli(["readiness", "candidate-1", "--json"]);
    expect(exitCode).toBe(0);
    const output = JSON.parse(stdout) as { testsVsEvals: { tests: string[]; evals: string[] }; waivers: Array<{ status: string }> };
    expect(output.testsVsEvals.tests).toEqual(["sealed:test"]);
    expect(output.testsVsEvals.evals).toEqual(["sealed:eval-summary"]);
    expect(output.waivers[0]?.status).toBe("approved");
  });
});
