import { execFile } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { EvidenceGraphStore } from "@/evidence/evidence-graph.js";
import { ensureLocalWorkspaceBootstrap } from "@/bootstrap/workspace-bootstrap.js";
import { GovernanceStore } from "@/governance/governance-store.js";
import { toImmutableEvidencePacketMetadataV0 } from "@/contracts/evidence-graph.js";
import type { EvidencePacketV0 } from "@/contracts/types.js";

const exec = promisify(execFile);

let workDir = "";
let dataDir = "";

beforeEach(async () => {
  workDir = await mkdtemp(join(tmpdir(), "pluto-bootstrap-cli-status-"));
  dataDir = join(workDir, ".pluto");
  await ensureLocalWorkspaceBootstrap({
    dataDir,
    now: "2026-04-30T00:00:00.000Z",
    workspaceId: "workspace-local-v0",
    principalId: "user-admin-1",
  });
  await seedCanonicalArtifacts(dataDir, "workspace-local-v0", "user-admin-1");
});

afterEach(async () => {
  await rm(workDir, { recursive: true, force: true });
});

describe("bootstrap CLI status", () => {
  it("keeps status, reset-local, and resume retry-safe in JSON mode", async () => {
    const first = await runBootstrap(["status", "--workspace-id", "workspace-local-v0", "--json"]);
    const second = await runBootstrap(["status", "--workspace-id", "workspace-local-v0", "--json"]);
    expect(first.exitCode).toBe(0);
    expect(second.exitCode).toBe(0);

    const firstStatus = JSON.parse(first.stdout) as {
      session: { createdObjectRefs: Array<{ id: string }> } | null;
    };
    const secondStatus = JSON.parse(second.stdout) as {
      session: { createdObjectRefs: Array<{ id: string }> } | null;
    };
    expect(firstStatus.session?.createdObjectRefs).toEqual(secondStatus.session?.createdObjectRefs);

    const reset1 = await runBootstrap(["reset-local", "--workspace-id", "workspace-local-v0", "--json"]);
    const reset2 = await runBootstrap(["reset-local", "--workspace-id", "workspace-local-v0", "--json"]);
    const resume1 = await runBootstrap(["resume", "--workspace-id", "workspace-local-v0", "--principal-id", "user-admin-1", "--json"]);
    const resume2 = await runBootstrap(["resume", "--workspace-id", "workspace-local-v0", "--principal-id", "user-admin-1", "--json"]);

    expect(reset1.exitCode).toBe(0);
    expect(reset2.exitCode).toBe(0);
    expect(resume1.exitCode).toBe(0);
    expect(resume2.exitCode).toBe(0);

    const resumed = JSON.parse(resume2.stdout) as {
      status: string;
      session: { createdObjectRefs: Array<{ id: string }> } | null;
    };
    const ids = resumed.session?.createdObjectRefs.map((ref) => ref.id) ?? [];
    expect(resumed.status).toBe("completed");
    expect(new Set(ids).size).toBe(ids.length);
  }, 30_000);
});

async function runBootstrap(args: string[]): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  try {
    const result = await exec("npx", ["tsx", join(process.cwd(), "src/cli/bootstrap.ts"), ...args], {
      cwd: process.cwd(),
      env: { ...process.env, PLUTO_DATA_DIR: dataDir },
      timeout: 10_000,
    });
    return { stdout: result.stdout, stderr: result.stderr, exitCode: 0 };
  } catch (error: unknown) {
    const failure = error as { stdout?: string; stderr?: string; code?: number };
    return {
      stdout: failure.stdout ?? "",
      stderr: failure.stderr ?? "",
      exitCode: failure.code ?? 1,
    };
  }
}

async function seedCanonicalArtifacts(dataDir: string, workspaceId: string, principalId: string): Promise<void> {
  const governance = new GovernanceStore({ dataDir });
  await governance.put("document", {
    schemaVersion: 0,
    kind: "document",
    id: `bootstrap-document-${workspaceId}`,
    workspaceId,
    createdAt: "2026-04-30T00:00:10.000Z",
    updatedAt: "2026-04-30T00:00:10.000Z",
    status: "ready",
    title: "Bootstrap document",
    ownerId: principalId,
    currentVersionId: `bootstrap-document-${workspaceId}-version-1`,
  });

  const packet: EvidencePacketV0 = {
    schemaVersion: 0,
    runId: `bootstrap-${workspaceId}-run-1`,
    taskTitle: "Bootstrap first artifact",
    status: "done",
    blockerReason: null,
    startedAt: "2026-04-30T00:00:20.000Z",
    finishedAt: "2026-04-30T00:00:22.000Z",
    workspace: workspaceId,
    workers: [],
    validation: { outcome: "pass", reason: null },
    citedInputs: { taskPrompt: "bootstrap", workspaceMarkers: [] },
    risks: [],
    openQuestions: [],
    classifierVersion: 0,
    generatedAt: "2026-04-30T00:00:23.000Z",
  };
  const runDir = join(dataDir, "runs", packet.runId);
  await mkdir(runDir, { recursive: true });
  await writeFile(join(runDir, "events.jsonl"), [
    { id: "r1", runId: packet.runId, ts: packet.startedAt, type: "run_started", payload: { title: packet.taskTitle } },
    { id: "r2", runId: packet.runId, ts: packet.finishedAt, type: "run_completed", payload: {} },
  ].map((event) => JSON.stringify(event)).join("\n") + "\n", "utf8");
  await writeFile(join(runDir, "evidence.json"), `${JSON.stringify(packet, null, 2)}\n`, "utf8");

  const evidence = new EvidenceGraphStore({ dataDir });
  await evidence.putSealedEvidenceRef({
    id: `sealed-${packet.runId}`,
    packetId: `packet-${packet.runId}`,
    runId: packet.runId,
    evidencePath: `.pluto/runs/${packet.runId}/evidence.json`,
    sealChecksum: "sha256:bootstrap",
    sealedAt: "2026-04-30T00:00:24.000Z",
    sourceRun: {
      runId: packet.runId,
      status: "done",
      blockerReason: null,
      finishedAt: packet.finishedAt,
    },
    immutablePacket: { ...toImmutableEvidencePacketMetadataV0(packet) },
  });

  const sampleDir = join(dataDir, "bootstrap", workspaceId, "samples", "local-v0");
  await mkdir(sampleDir, { recursive: true });
  await writeFile(join(sampleDir, "sample-curated-default-workflow.json"), `${JSON.stringify({
    schema: "pluto.bootstrap.sample-install",
    schemaVersion: 0,
    sampleId: "sample-curated-default-workflow",
    workspaceRef: { workspaceId, kind: "workspace", id: workspaceId },
    actorRefs: [{ workspaceId, kind: "user", principalId }],
    scope: "local-v0",
    lifecycleStatus: "active",
    definition: {
      sampleId: "sample-curated-default-workflow",
      scope: "local-v0",
      status: "active",
      name: "Curated Default Workflow",
      playbookRef: { id: "playbook-1" },
      scenarioRef: { id: "scenario-1" },
      templateRef: { id: "template-1", version: "0.0.1" },
      skillRefs: [],
      policyPackRef: { id: "policy-1", version: "0.0.1" },
      requiredCapabilities: [],
      requiredSecretRefNames: [],
      expectedArtifacts: [],
      evidenceContractRefs: [],
    },
    installedAt: "2026-04-30T00:00:05.000Z",
    activatedAt: "2026-04-30T00:00:06.000Z",
    revokedAt: null,
    updatedAt: "2026-04-30T00:00:06.000Z",
    auditEventIds: [],
  }, null, 2)}\n`, "utf8");
}
