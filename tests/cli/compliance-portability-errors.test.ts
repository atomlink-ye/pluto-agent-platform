import { execFile } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { REVIEW_PUBLISH_RELEASE_FIXTURE_IDS } from "@/governance/seed.js";

import { COMPLIANCE_EXPORT_FLOW_IDS, seedComplianceExportFlow } from "../fixtures/compliance-export-flow.js";

const exec = promisify(execFile);

let workDir = "";
let dataDir = "";

async function runCli(script: "compliance" | "portability", args: string[]): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  try {
    const result = await exec("npx", ["tsx", join(process.cwd(), `src/cli/${script}.ts`), ...args], {
      cwd: process.cwd(),
      env: {
        ...process.env,
        PLUTO_DATA_DIR: dataDir,
        PLUTO_NOW: "2026-04-30T00:32:00.000Z",
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
  workDir = await mkdtemp(join(tmpdir(), "pluto-compliance-portability-errors-"));
  dataDir = join(workDir, ".pluto");
});

afterEach(async () => {
  await rm(workDir, { recursive: true, force: true });
});

describe("compliance and portability cli errors", () => {
  it("rejects missing publish packages during compliance export", async () => {
    await seedComplianceExportFlow(dataDir);
    const { stderr, exitCode } = await runCli("compliance", ["export", "missing-package"]);
    expect(exitCode).not.toBe(0);
    expect(stderr).toContain("publish package not found: missing-package");
  });

  it("rejects missing manifests during portability export", async () => {
    await seedComplianceExportFlow(dataDir);
    const { stderr, exitCode } = await runCli("portability", ["export", "missing-manifest"]);
    expect(exitCode).not.toBe(0);
    expect(stderr).toContain("audit export manifest not found: missing-manifest");
  });

  it("fails closed when active retention or a placed hold blocks portability export", async () => {
    await seedComplianceExportFlow(dataDir, {
      retentionStatus: "active",
      legalHoldStatus: "placed",
    });
    await runCli("compliance", [
      "export",
      REVIEW_PUBLISH_RELEASE_FIXTURE_IDS.publishPackageId,
      "--manifest-id",
      COMPLIANCE_EXPORT_FLOW_IDS.manifestId,
      "--json",
    ]);

    const { stderr, exitCode } = await runCli("portability", [
      "export",
      COMPLIANCE_EXPORT_FLOW_IDS.manifestId,
      "--bundle-id",
      COMPLIANCE_EXPORT_FLOW_IDS.bundleId,
    ]);
    expect(exitCode).not.toBe(0);
    expect(stderr).toContain("retention_blocked:");
    expect(stderr).toContain("legal_hold_blocked:");
  });

  it("reports missing secret-name requirements during portability validation", async () => {
    await seedComplianceExportFlow(dataDir);
    await runCli("compliance", [
      "export",
      REVIEW_PUBLISH_RELEASE_FIXTURE_IDS.publishPackageId,
      "--manifest-id",
      COMPLIANCE_EXPORT_FLOW_IDS.manifestId,
      "--json",
    ]);
    await runCli("portability", [
      "export",
      COMPLIANCE_EXPORT_FLOW_IDS.manifestId,
      "--bundle-id",
      COMPLIANCE_EXPORT_FLOW_IDS.bundleId,
      "--json",
    ]);

    const { readFile, writeFile } = await import("node:fs/promises");
    const bundlePath = join(dataDir, "portability", "bundles", `${COMPLIANCE_EXPORT_FLOW_IDS.bundleId}.json`);
    const raw = JSON.parse(await readFile(bundlePath, "utf8")) as {
      sealedBundle: {
        bundle: {
          manifest: {
            importRequirements: Array<Record<string, unknown>>;
          };
        };
      };
    };
    raw.sealedBundle.bundle.manifest.importRequirements.push({
      schema: "pluto.portability.import-requirement",
      schemaVersion: 0,
      code: "secret-name",
      required: true,
      description: "Importer must provide DOCS_TARGET_TOKEN.",
      secretNames: ["DOCS_TARGET_TOKEN"],
    });
    await writeFile(bundlePath, JSON.stringify(raw, null, 2) + "\n", "utf8");

    const { stderr, exitCode } = await runCli("portability", ["validate", COMPLIANCE_EXPORT_FLOW_IDS.bundleId]);
    expect(exitCode).not.toBe(0);
    expect(stderr).toContain("missing_secret_name: DOCS_TARGET_TOKEN");
  });

  it("reports conflict rejection for protected records", async () => {
    await seedComplianceExportFlow(dataDir);
    await runCli("compliance", [
      "export",
      REVIEW_PUBLISH_RELEASE_FIXTURE_IDS.publishPackageId,
      "--manifest-id",
      COMPLIANCE_EXPORT_FLOW_IDS.manifestId,
      "--json",
    ]);
    await runCli("portability", [
      "export",
      COMPLIANCE_EXPORT_FLOW_IDS.manifestId,
      "--bundle-id",
      COMPLIANCE_EXPORT_FLOW_IDS.bundleId,
      "--json",
    ]);

    const { stdout, exitCode } = await runCli("portability", [
      "conflicts",
      COMPLIANCE_EXPORT_FLOW_IDS.bundleId,
      "--existing-status",
      "published",
      "--json",
    ]);
    expect(exitCode).toBe(0);
    expect(JSON.parse(stdout)).toMatchObject({
      conflict: {
        code: "protected_record_conflict",
        outcome: "rejected",
      },
    });
  });
});
