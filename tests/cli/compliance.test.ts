import { execFile } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { ComplianceStore } from "@/compliance/compliance-store.js";
import { REVIEW_PUBLISH_RELEASE_FIXTURE_IDS } from "@/governance/seed.js";

import { COMPLIANCE_EXPORT_FLOW_IDS, seedComplianceExportFlow } from "../fixtures/compliance-export-flow.js";

const exec = promisify(execFile);

let workDir = "";
let dataDir = "";

async function runCli(args: string[]): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  try {
    const result = await exec("npx", ["tsx", join(process.cwd(), "src/cli/compliance.ts"), ...args], {
      cwd: process.cwd(),
      env: {
        ...process.env,
        PLUTO_DATA_DIR: dataDir,
        PLUTO_NOW: "2026-04-30T00:30:00.000Z",
      },
      timeout: 10_000,
    });
    return { stdout: result.stdout, stderr: result.stderr, exitCode: 0 };
  } catch (err: unknown) {
    const e = err as { stdout?: string; stderr?: string; code?: number };
    return { stdout: e.stdout ?? "", stderr: e.stderr ?? "", exitCode: e.code ?? 1 };
  }
}

beforeEach(async () => {
  workDir = await mkdtemp(join(tmpdir(), "pluto-compliance-cli-test-"));
  dataDir = join(workDir, ".pluto");
  await seedComplianceExportFlow(dataDir);
});

afterEach(async () => {
  await rm(workDir, { recursive: true, force: true });
});

describe("compliance cli", () => {
  it("creates a local audit export manifest and persists the stored view", async () => {
    const { stdout, exitCode } = await runCli([
      "export",
      REVIEW_PUBLISH_RELEASE_FIXTURE_IDS.publishPackageId,
      "--manifest-id",
      COMPLIANCE_EXPORT_FLOW_IDS.manifestId,
      "--actor",
      "exporter-1",
      "--json",
    ]);
    expect(exitCode).toBe(0);

    const output = JSON.parse(stdout) as {
      manifest: { id: string; status: string; evidenceRefs: string[]; complianceEventRefs: string[] };
      generatedEvent: { action: string; actorId: string };
    };
    expect(output.manifest.id).toBe(COMPLIANCE_EXPORT_FLOW_IDS.manifestId);
    expect(output.manifest.status).toBe("generated");
    expect(output.manifest.evidenceRefs).toEqual(expect.arrayContaining([
      COMPLIANCE_EXPORT_FLOW_IDS.complianceEvidenceId,
      REVIEW_PUBLISH_RELEASE_FIXTURE_IDS.mainSealedEvidenceId,
    ]));
    expect(output.generatedEvent).toMatchObject({
      action: "audit_export_generated",
      actorId: "exporter-1",
    });

    const store = new ComplianceStore({ dataDir });
    await expect(store.get("audit_export_manifest", COMPLIANCE_EXPORT_FLOW_IDS.manifestId)).resolves.toMatchObject({
      id: COMPLIANCE_EXPORT_FLOW_IDS.manifestId,
      governedChain: [
        expect.objectContaining({ kind: "document", stableId: REVIEW_PUBLISH_RELEASE_FIXTURE_IDS.documentId }),
        expect.objectContaining({ kind: "version", stableId: REVIEW_PUBLISH_RELEASE_FIXTURE_IDS.versionId }),
        expect.objectContaining({ kind: "publish_package", stableId: REVIEW_PUBLISH_RELEASE_FIXTURE_IDS.publishPackageId }),
      ],
    });
  });

  it("shows the persisted manifest view and linked event ids", async () => {
    await runCli([
      "export",
      REVIEW_PUBLISH_RELEASE_FIXTURE_IDS.publishPackageId,
      "--manifest-id",
      COMPLIANCE_EXPORT_FLOW_IDS.manifestId,
      "--json",
    ]);

    const { stdout, exitCode } = await runCli(["show", COMPLIANCE_EXPORT_FLOW_IDS.manifestId]);
    expect(exitCode).toBe(0);
    expect(stdout).toContain(`Manifest: ${COMPLIANCE_EXPORT_FLOW_IDS.manifestId}`);
    expect(stdout).toContain(`publish_package:${REVIEW_PUBLISH_RELEASE_FIXTURE_IDS.publishPackageId}`);
    expect(stdout).toContain(`${COMPLIANCE_EXPORT_FLOW_IDS.manifestId}:generated`);
  });

  it("lists compliance record kinds and shows stored evidence/event records", async () => {
    await runCli([
      "export",
      REVIEW_PUBLISH_RELEASE_FIXTURE_IDS.publishPackageId,
      "--manifest-id",
      COMPLIANCE_EXPORT_FLOW_IDS.manifestId,
      "--json",
    ]);

    const list = await runCli(["list", "retention_policy"]);
    expect(list.exitCode).toBe(0);
    expect(list.stdout).toContain(COMPLIANCE_EXPORT_FLOW_IDS.retentionPolicyId);

    const showEvidence = await runCli(["show", "evidence", COMPLIANCE_EXPORT_FLOW_IDS.complianceEvidenceId]);
    expect(showEvidence.exitCode).toBe(0);
    expect(showEvidence.stdout).toContain(`Record: ${COMPLIANCE_EXPORT_FLOW_IDS.complianceEvidenceId}`);
    expect(showEvidence.stdout).toContain(`Target: publish_package:${REVIEW_PUBLISH_RELEASE_FIXTURE_IDS.publishPackageId}`);

    const showEvent = await runCli(["show", "event", `${COMPLIANCE_EXPORT_FLOW_IDS.manifestId}:generated`]);
    expect(showEvent.exitCode).toBe(0);
    expect(showEvent.stdout).toContain(`Event: ${COMPLIANCE_EXPORT_FLOW_IDS.manifestId}:generated`);
    expect(showEvent.stdout).toContain("Action: audit_export_generated");
  });
});
