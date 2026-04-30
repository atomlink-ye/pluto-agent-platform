import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { seedDefaultCatalog } from "@/catalog/seed.js";
import {
  DEFAULT_TEAM,
  buildDefaultTeam,
  getRoleCatalogSelection,
} from "@/orchestrator/team-config.js";

const tempDirs: string[] = [];

async function makeTempDir() {
  const dir = await mkdtemp(join(tmpdir(), "pluto-default-team-"));
  tempDirs.push(dir);
  return dir;
}

async function writeGeneratorOverride(
  catalogDir: string,
  reviewStatus: "draft" | "reviewed" | "approved",
  workerRolePrompt = "File-backed generator prompt.",
) {
  await mkdir(join(catalogDir, "entries"), { recursive: true });
  await mkdir(join(catalogDir, "roles"), { recursive: true });

  await writeFile(
    join(catalogDir, "entries", "default-generator.json"),
    JSON.stringify({
      schema: "pluto.catalog.skill-entry",
      schemaVersion: 0,
      id: "default-generator",
      version: "0.0.1",
      status: "active",
      summary: "Override generator entry",
      visibility: "catalog",
      reviewStatus,
      trustTier: "trusted",
      deprecation: { status: "none" },
      versionPolicy: {
        track: "catalog-default",
        defaultVersion: "0.0.1",
        autoUpdate: "minor-only",
      },
      workerRole: { id: "generator", version: "0.0.1" },
      skill: { id: "generate-artifact", version: "0.0.1" },
      template: { id: "generator-body", version: "0.0.1" },
      policyPack: { id: "default-guardrails", version: "0.0.1" },
      labels: ["default", "generator", "override"],
    }),
    "utf8",
  );
  await writeFile(
    join(catalogDir, "roles", "generator.json"),
    JSON.stringify({
      schema: "pluto.catalog.worker-role",
      schemaVersion: 0,
      id: "generator",
      version: "0.0.1",
      status: "active",
      name: "Generator",
      responsibility: "Generate the artifact body.",
      systemPrompt: workerRolePrompt,
      allowedSkills: [{ id: "generate-artifact", version: "0.0.1" }],
      expectedEvidence: {
        artifactType: "patch",
        requiredFields: ["artifactBody"],
        citationPolicy: "local-only",
        retention: "durable",
      },
      versionMetadata: {
        channel: "stable",
        revision: 2,
        updatedAt: "2026-04-30T00:00:00Z",
      },
      labels: ["default", "generator"],
    }),
    "utf8",
  );
}

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe("default team catalog materialization", () => {
  it("falls back to curated seed assets when the catalog directory is missing, empty, or corrupt", async () => {
    const missingDir = join(await makeTempDir(), "missing");
    const emptyDir = await makeTempDir();
    const corruptDir = await makeTempDir();
    await writeFile(join(corruptDir, "broken.json"), "{not-json", "utf8");

    expect(seedDefaultCatalog({ catalogDir: missingDir }).source).toBe("curated-fallback");
    expect(seedDefaultCatalog({ catalogDir: emptyDir }).source).toBe("curated-fallback");
    expect(seedDefaultCatalog({ catalogDir: corruptDir }).source).toBe("curated-fallback");
  });

  it("materializes the default team from curated catalog entries and preserves role ordering", () => {
    expect(DEFAULT_TEAM.id).toBe("default-mvp-alpha");
    expect(DEFAULT_TEAM.roles.map((role) => role.id)).toEqual([
      "lead",
      "planner",
      "generator",
      "evaluator",
    ]);

    const plannerSelection = getRoleCatalogSelection(DEFAULT_TEAM, "planner");
    expect(plannerSelection).toMatchObject({
      entry: { id: "default-planner", version: "0.0.1" },
      workerRole: { id: "planner", version: "0.0.1" },
      skill: { id: "plan-artifact", version: "0.0.1" },
      template: { id: "planner-plan", version: "0.0.1" },
      policyPack: { id: "default-guardrails", version: "0.0.1" },
    });
  });

  it("ignores file-backed generator overrides until the entry is approved", async () => {
    const catalogDir = await makeTempDir();
    await writeGeneratorOverride(catalogDir, "draft");

    const team = buildDefaultTeam({ catalogDir });

    expect(seedDefaultCatalog({ catalogDir }).source).toBe("file-backed");
    expect(team.roles.map((role) => role.id)).toEqual(["lead", "planner", "generator", "evaluator"]);
    expect(team.roles.find((role) => role.id === "generator")?.systemPrompt).toBe(
      DEFAULT_TEAM.roles.find((role) => role.id === "generator")?.systemPrompt,
    );
    expect(getRoleCatalogSelection(team, "generator")?.entry.id).toBe("default-generator");
    expect(getRoleCatalogSelection(team, "generator")?.workerRole.id).toBe("generator");
  });

  it("ignores file-backed generator overrides when the entry is reviewed but not approved", async () => {
    const catalogDir = await makeTempDir();
    await writeGeneratorOverride(catalogDir, "reviewed");

    const team = buildDefaultTeam({ catalogDir });

    expect(seedDefaultCatalog({ catalogDir }).source).toBe("file-backed");
    expect(team.roles.find((role) => role.id === "generator")?.systemPrompt).toBe(
      DEFAULT_TEAM.roles.find((role) => role.id === "generator")?.systemPrompt,
    );
    expect(getRoleCatalogSelection(team, "generator")?.entry.id).toBe("default-generator");
  });

  it("keeps curated generator role bodies when only the file-backed role matches the curated id and version", async () => {
    const catalogDir = await makeTempDir();
    await writeGeneratorOverride(catalogDir, "draft", "Role-only override prompt.");

    const team = buildDefaultTeam({ catalogDir });

    expect(seedDefaultCatalog({ catalogDir }).source).toBe("file-backed");
    expect(team.roles.find((role) => role.id === "generator")?.systemPrompt).toBe(
      DEFAULT_TEAM.roles.find((role) => role.id === "generator")?.systemPrompt,
    );
    expect(team.roles.find((role) => role.id === "generator")?.systemPrompt).not.toBe(
      "Role-only override prompt.",
    );
    expect(getRoleCatalogSelection(team, "generator")).toMatchObject({
      entry: { id: "default-generator", version: "0.0.1" },
      workerRole: { id: "generator", version: "0.0.1" },
    });
  });

  it("still uses approved file-backed generator overrides", async () => {
    const catalogDir = await makeTempDir();
    await writeGeneratorOverride(catalogDir, "approved");

    const team = buildDefaultTeam({ catalogDir });

    expect(seedDefaultCatalog({ catalogDir }).source).toBe("file-backed");
    expect(team.roles.find((role) => role.id === "generator")?.systemPrompt).toBe(
      "File-backed generator prompt.",
    );
    expect(getRoleCatalogSelection(team, "generator")?.entry.id).toBe("default-generator");
  });
});
