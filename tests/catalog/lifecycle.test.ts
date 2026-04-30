import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { SkillCatalogEntryV0 } from "@/catalog/contracts.js";
import { submitCatalogAsset, approveCatalogAsset, deprecateCatalogAsset } from "@/catalog/lifecycle.js";
import { CatalogStore } from "@/catalog/catalog-store.js";

let workDir: string;

beforeEach(async () => {
  workDir = await mkdtemp(join(tmpdir(), "pluto-catalog-lifecycle-test-"));
});

afterEach(async () => {
  await rm(workDir, { recursive: true, force: true });
});

function makeEntry(): SkillCatalogEntryV0 {
  return {
    schema: "pluto.catalog.skill-entry",
    schemaVersion: 0,
    id: "generator-repo-synthesis",
    version: "0.0.1",
    status: "active",
    summary: "Generator role with a draft skill entry.",
    visibility: "catalog",
    reviewStatus: "draft",
    trustTier: "experimental",
    deprecation: { status: "none" },
    versionPolicy: {
      track: "catalog-default",
      defaultVersion: "0.0.1",
      autoUpdate: "minor-only",
    },
    workerRole: { id: "generator", version: "0.0.1" },
    skill: { id: "repo-synthesis", version: "0.0.1" },
    labels: ["generator"],
  };
}

describe("catalog lifecycle", () => {
  it("preserves draft, submitted, approved, and deprecated transitions", async () => {
    const dataDir = join(workDir, ".pluto");
    const store = new CatalogStore({ dataDir });
    const entry = makeEntry();

    await store.upsert("entries", entry.id, entry);

    const submitted = await submitCatalogAsset({ store, assetId: entry.id });
    expect(submitted.reviewStatus).toBe("submitted");
    expect(submitted.status).toBe("active");

    const approved = await approveCatalogAsset({ store, assetId: entry.id });
    expect(approved.reviewStatus).toBe("approved");
    expect(approved.status).toBe("active");

    const deprecated = await deprecateCatalogAsset({
      store,
      assetId: entry.id,
      replacementEntryId: "generator-repo-synthesis-v2",
      sunsetAt: "2026-06-01T00:00:00.000Z",
      note: "Superseded by a newer reviewed skill bundle.",
    });

    expect(deprecated.status).toBe("deprecated");
    expect(deprecated.reviewStatus).toBe("approved");
    expect(deprecated.deprecation).toEqual({
      status: "deprecated",
      replacementEntryId: "generator-repo-synthesis-v2",
      sunsetAt: "2026-06-01T00:00:00.000Z",
      note: "Superseded by a newer reviewed skill bundle.",
    });

    expect(await store.read("entries", entry.id)).toEqual(deprecated);
  });

  it("targets an explicit version when multiple entry versions share the same id", async () => {
    const dataDir = join(workDir, ".pluto");
    const store = new CatalogStore({ dataDir });
    const entryV1 = makeEntry();
    const entryV2: SkillCatalogEntryV0 = {
      ...entryV1,
      version: "0.0.2",
      reviewStatus: "draft",
      summary: "Generator role with a newer draft skill entry.",
      versionPolicy: {
        ...entryV1.versionPolicy,
        defaultVersion: "0.0.2",
      },
    };

    await store.upsert("entries", entryV1.id, entryV1);
    await store.upsert("entries", entryV2.id, entryV2);

    await expect(approveCatalogAsset({ store, assetId: entryV1.id })).rejects.toThrow(
      "Multiple catalog versions found for entries/generator-repo-synthesis; specify a version.",
    );

    const approved = await approveCatalogAsset({
      store,
      assetId: entryV2.id,
      version: entryV2.version,
    });

    expect(approved.version).toBe("0.0.2");
    expect(approved.reviewStatus).toBe("approved");
    expect(await store.read("entries", entryV1.id, entryV1.version)).toEqual(entryV1);
    expect(await store.read("entries", entryV2.id, entryV2.version)).toEqual(approved);
  });
});
