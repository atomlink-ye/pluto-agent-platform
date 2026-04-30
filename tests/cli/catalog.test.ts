import { execFile } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { CatalogListOutputV0, PolicyPackV0, SkillCatalogEntryV0 } from "@/catalog/contracts.js";
import { CatalogStore } from "@/catalog/catalog-store.js";

const exec = promisify(execFile);

let workDir: string;
let dataDir: string;

beforeEach(async () => {
  workDir = await mkdtemp(join(tmpdir(), "pluto-catalog-cli-test-"));
  dataDir = join(workDir, ".pluto");

  const store = new CatalogStore({ dataDir });
  await store.upsert("entries", "entry-draft", makeEntry({ id: "entry-draft", reviewStatus: "draft" }));
  await store.upsert("entries", "entry-draft", makeEntry({
    id: "entry-draft",
    version: "0.0.2",
    reviewStatus: "draft",
    summary: "CLI inspection fixture for a newer version.",
    versionPolicy: {
      track: "catalog-default",
      defaultVersion: "0.0.2",
      autoUpdate: "minor-only",
    },
  }));
  await store.upsert("entries", "entry-deprecated", makeEntry({
    id: "entry-deprecated",
    status: "deprecated",
    reviewStatus: "approved",
    deprecation: {
      status: "deprecated",
      replacementEntryId: "entry-approved",
      sunsetAt: "2026-06-01T00:00:00.000Z",
      note: "Superseded.",
    },
  }));
  await store.upsert("policy-packs", "blocked-pack", makeBlockedPolicyPack());
});

afterEach(async () => {
  await rm(workDir, { recursive: true, force: true });
});

async function runCatalog(args: string[]): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  try {
    const result = await exec("npx", ["tsx", join(process.cwd(), "src/cli/catalog.ts"), ...args], {
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

describe("pnpm catalog", () => {
  it("lists catalog records in text and JSON modes with inspection states", async () => {
    const text = await runCatalog(["list"]);
    expect(text.exitCode).toBe(0);
    expect(text.stdout).toContain("entry-draft");
    expect(text.stdout).toContain("blocked");
    expect(text.stdout).toContain("deprecated");

    const json = await runCatalog(["list", "--json"]);
    expect(json.exitCode).toBe(0);
    const output: CatalogListOutputV0 = JSON.parse(json.stdout);
    expect(output.schema).toBe("pluto.catalog.list-output");
    expect(output.schemaVersion).toBe(0);
    expect(output.items.filter((item) => item.id === "entry-draft")).toHaveLength(2);
    expect(output.items.find((item) => item.id === "entry-draft" && item.version === "0.0.1")?.state).toBe("blocked");
    expect(output.items.find((item) => item.id === "entry-draft" && item.version === "0.0.2")?.state).toBe("blocked");
    expect(output.items.find((item) => item.id === "entry-deprecated")?.state).toBe("deprecated");
    expect(output.items.find((item) => item.id === "blocked-pack")?.state).toBe("blocked");
  });

  it("shows, approves, and deprecates entries through the CLI with explicit version targeting when needed", async () => {
    const showDraft = await runCatalog(["show", "entries", "entry-draft", "--json"]);
    expect(showDraft.exitCode).not.toBe(0);
    expect(showDraft.stderr).toContain("Multiple catalog versions found for entries/entry-draft; specify a version.");

    const showDraftV2 = await runCatalog(["show", "entries", "entry-draft", "--version", "0.0.2", "--json"]);
    expect(showDraftV2.exitCode).toBe(0);
    expect(JSON.parse(showDraftV2.stdout).record.version).toBe("0.0.2");

    const approve = await runCatalog(["approve", "entry-draft", "--version", "0.0.2", "--json"]);
    expect(approve.exitCode).toBe(0);
    const approved = JSON.parse(approve.stdout);
    expect(approved.item.state).toBe("active");
    expect(approved.record.reviewStatus).toBe("approved");
    expect(approved.record.version).toBe("0.0.2");

    const deprecate = await runCatalog([
      "deprecate",
      "entry-draft",
      "--version",
      "0.0.2",
      "--replacement-entry-id",
      "entry-approved-v2",
      "--sunset-at",
      "2026-07-01T00:00:00.000Z",
      "--note",
      "Retired for a newer bundle.",
      "--json",
    ]);
    expect(deprecate.exitCode).toBe(0);
    const deprecated = JSON.parse(deprecate.stdout);
    expect(deprecated.item.state).toBe("deprecated");
    expect(deprecated.record.deprecation.replacementEntryId).toBe("entry-approved-v2");
    expect(deprecated.record.version).toBe("0.0.2");
  });
});

function makeEntry(overrides: Partial<SkillCatalogEntryV0> & Pick<SkillCatalogEntryV0, "id">): SkillCatalogEntryV0 {
  const { id, ...rest } = overrides;
  return {
    schema: "pluto.catalog.skill-entry",
    schemaVersion: 0,
    version: "0.0.1",
    status: "active",
    summary: "CLI inspection fixture.",
    visibility: "catalog",
    reviewStatus: "approved",
    trustTier: "trusted",
    deprecation: { status: "none" },
    versionPolicy: {
      track: "catalog-default",
      defaultVersion: "0.0.1",
      autoUpdate: "minor-only",
    },
    workerRole: { id: "generator", version: "0.0.1" },
    skill: { id: "repo-synthesis", version: "0.0.1" },
    labels: ["cli"],
    id,
    ...rest,
  };
}

function makeBlockedPolicyPack(): PolicyPackV0 {
  return {
    schema: "pluto.catalog.policy-pack",
    schemaVersion: 0,
    id: "blocked-pack",
    version: "0.0.1",
    status: "blocked",
    name: "Blocked Pack",
    summary: "Conflicts with another policy pack.",
    reason: "conflict",
    conflicts: [
      {
        policyId: "blocked-pack",
        withPolicyId: "default-guardrails",
        message: "Mutually exclusive runtime posture.",
      },
    ],
  };
}
