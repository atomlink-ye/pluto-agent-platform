import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { PortableBundleStore } from "@/portability/bundle-store.js";
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
        PLUTO_NOW: "2026-04-30T00:31:00.000Z",
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
  workDir = await mkdtemp(join(tmpdir(), "pluto-portability-cli-test-"));
  dataDir = join(workDir, ".pluto");
  await seedComplianceExportFlow(dataDir);
  await runCli("compliance", [
    "export",
    REVIEW_PUBLISH_RELEASE_FIXTURE_IDS.publishPackageId,
    "--manifest-id",
    COMPLIANCE_EXPORT_FLOW_IDS.manifestId,
    "--json",
  ]);
});

afterEach(async () => {
  await rm(workDir, { recursive: true, force: true });
});

describe("portability cli", () => {
  it("seals and persists a portability bundle from the compliance manifest", async () => {
    const { stdout, exitCode } = await runCli("portability", [
      "export",
      COMPLIANCE_EXPORT_FLOW_IDS.manifestId,
      "--bundle-id",
      COMPLIANCE_EXPORT_FLOW_IDS.bundleId,
      "--template-id",
      COMPLIANCE_EXPORT_FLOW_IDS.templateId,
      "--json",
    ]);
    expect(exitCode).toBe(0);

    const output = JSON.parse(stdout) as {
      bundleRef: string;
      record: {
        bundleId: string;
        sealedBundle: {
          bundle: { manifest: { assetKinds: string[] }; assets: Array<{ kind: string }> };
          seal: { schema: string };
        };
      };
    };
    expect(output.bundleRef).toBe(`portable-bundle://${COMPLIANCE_EXPORT_FLOW_IDS.bundleId}`);
    expect(output.record.bundleId).toBe(COMPLIANCE_EXPORT_FLOW_IDS.bundleId);
    expect(output.record.sealedBundle.seal.schema).toBe("pluto.portability.bundle-seal");
    expect(output.record.sealedBundle.bundle.manifest.assetKinds).toEqual(expect.arrayContaining([
      "document",
      "template",
      "publish_package",
      "evidence_summary",
    ]));

    const store = new PortableBundleStore({ dataDir });
    await expect(store.readBundle(COMPLIANCE_EXPORT_FLOW_IDS.bundleId)).resolves.toMatchObject({
      bundleId: COMPLIANCE_EXPORT_FLOW_IDS.bundleId,
    });
  });

  it("lists and shows stored portability bundles", async () => {
    await runCli("portability", [
      "export",
      COMPLIANCE_EXPORT_FLOW_IDS.manifestId,
      "--bundle-id",
      COMPLIANCE_EXPORT_FLOW_IDS.bundleId,
      "--template-id",
      COMPLIANCE_EXPORT_FLOW_IDS.templateId,
      "--json",
    ]);

    const list = await runCli("portability", ["list"]);
    expect(list.exitCode).toBe(0);
    expect(list.stdout).toContain(COMPLIANCE_EXPORT_FLOW_IDS.bundleId);

    const show = await runCli("portability", ["show", COMPLIANCE_EXPORT_FLOW_IDS.bundleId, "--json"]);
    expect(show.exitCode).toBe(0);
    expect(JSON.parse(show.stdout)).toMatchObject({
      record: {
        bundleId: COMPLIANCE_EXPORT_FLOW_IDS.bundleId,
        sealedBundle: {
          bundle: {
            assets: expect.arrayContaining([
              expect.objectContaining({ kind: "document" }),
              expect.objectContaining({ kind: "template" }),
              expect.objectContaining({ kind: "publish_package" }),
            ]),
          },
        },
      },
    });
  });

  it("validates stored bundles and reports portability conflicts from read paths", async () => {
    await runCli("portability", [
      "export",
      COMPLIANCE_EXPORT_FLOW_IDS.manifestId,
      "--bundle-id",
      COMPLIANCE_EXPORT_FLOW_IDS.bundleId,
      "--template-id",
      COMPLIANCE_EXPORT_FLOW_IDS.templateId,
      "--json",
    ]);

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

    const validate = await runCli("portability", [
      "validate",
      COMPLIANCE_EXPORT_FLOW_IDS.bundleId,
      "--secret-name",
      "DOCS_TARGET_TOKEN",
      "--json",
    ]);
    expect(validate.exitCode).toBe(0);
    expect(JSON.parse(validate.stdout)).toMatchObject({
      bundleId: COMPLIANCE_EXPORT_FLOW_IDS.bundleId,
      ok: true,
    });

    const conflicts = await runCli("portability", [
      "conflicts",
      COMPLIANCE_EXPORT_FLOW_IDS.bundleId,
      "--asset-logical-id",
      `template:${COMPLIANCE_EXPORT_FLOW_IDS.templateId}`,
      "--existing-status",
      "published",
      "--resolution",
      "reject",
      "--json",
    ]);
    expect(conflicts.exitCode).toBe(0);
    expect(JSON.parse(conflicts.stdout)).toMatchObject({
      conflict: {
        code: "protected_record_conflict",
        resolution: "reject",
        outcome: "rejected",
      },
    });
  });
});
