import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { EvidenceGraphStore } from "@/evidence/evidence-graph.js";
import { GovernanceStore } from "@/governance/governance-store.js";
import { IdentityStore } from "@/identity/identity-store.js";
import {
  ensureLocalWorkspaceBootstrap,
  getLocalWorkspaceBootstrapStatus,
  resumeLocalWorkspaceBootstrap,
} from "@/bootstrap/workspace-bootstrap.js";
import { toImmutableEvidencePacketMetadataV0 } from "@/contracts/evidence-graph.js";
import type { EvidencePacketV0 } from "@/contracts/types.js";

let workDir = "";
let dataDir = "";

beforeEach(async () => {
  workDir = await mkdtemp(join(tmpdir(), "pluto-bootstrap-retry-idempotency-"));
  dataDir = join(workDir, ".pluto");
});

afterEach(async () => {
  await rm(workDir, { recursive: true, force: true });
});

describe("bootstrap retry idempotency", () => {
  it("reconciles canonical refs without duplicating underlying workspace/sample/document/run/evidence records", async () => {
    await ensureLocalWorkspaceBootstrap({
      dataDir,
      now: "2026-04-30T00:00:00.000Z",
      workspaceId: "workspace-local-v0",
      principalId: "user-admin-1",
    });
    await seedCanonicalArtifacts(dataDir, "workspace-local-v0", "user-admin-1");

    await resumeLocalWorkspaceBootstrap({
      dataDir,
      now: "2026-04-30T00:01:00.000Z",
      workspaceId: "workspace-local-v0",
      principalId: "user-admin-1",
    });
    await resumeLocalWorkspaceBootstrap({
      dataDir,
      now: "2026-04-30T00:02:00.000Z",
      workspaceId: "workspace-local-v0",
      principalId: "user-admin-1",
    });

    const status = await getLocalWorkspaceBootstrapStatus({ dataDir, workspaceId: "workspace-local-v0" });
    const objectRefIds = status.session?.createdObjectRefs.map((ref) => ref.id) ?? [];

    expect(status.status).toBe("completed");
    expect(new Set(objectRefIds).size).toBe(objectRefIds.length);
    expect(objectRefIds).toEqual(expect.arrayContaining([
      "workspace-local-v0:workspace:workspace-local-v0",
      "workspace-local-v0:user:user-admin-1",
      "workspace-local-v0:admin:user:user-admin-1",
      "bootstrap-sample:sample-curated-default-workflow",
      "bootstrap-document:bootstrap-document-workspace-local-v0",
      "bootstrap-run:bootstrap-workspace-local-v0-run-1",
      "bootstrap-evidence:sealed-bootstrap-workspace-local-v0-run-1",
    ]));

    const identity = new IdentityStore({ dataDir });
    const governance = new GovernanceStore({ dataDir });
    expect(await identity.list("workspace")).toHaveLength(1);
    expect(await identity.list("user")).toHaveLength(1);
    expect(await identity.list("membership_binding")).toHaveLength(1);
    expect(await governance.list("document")).toHaveLength(1);
  });
});

export async function seedCanonicalArtifacts(dataDir: string, workspaceId: string, principalId: string): Promise<void> {
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
