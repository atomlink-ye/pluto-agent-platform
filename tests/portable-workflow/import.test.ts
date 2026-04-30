import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  exportPortableWorkflowBundle,
  importPortableWorkflowBundle,
  PortableWorkflowStore,
} from "@/portable-workflow/index.js";

let workDir: string;
let store: PortableWorkflowStore;

beforeEach(async () => {
  workDir = await mkdtemp(join(tmpdir(), "pluto-portable-import-"));
  store = new PortableWorkflowStore({ dataDir: join(workDir, ".pluto") });
});

afterEach(async () => {
  await rm(workDir, { recursive: true, force: true });
});

describe("portable workflow import", () => {
  it("imports a compatible bundle as a draft and persists the stored result", async () => {
    const bundle = exportPortableWorkflowBundle({ exportedAt: "2026-04-30T00:00:00.000Z" });

    const result = await importPortableWorkflowBundle(
      {
        bundle,
        mode: "draft",
        source: { path: "fixtures/default-bundle.json" },
      },
      {
        store,
        idGen: () => "draft-test-001",
        clock: () => new Date("2026-04-30T12:00:00.000Z"),
      },
    );

    expect(result.status).toBe("ready");
    expect(result.importable).toBe(true);
    expect(result.mode).toBe("draft");
    expect(result.publishedStateMaterialized).toBe(false);
    expect(result.runtimeStateMaterialized).toBe(false);
    expect(result.compatibility.status).toBe("compatible");
    expect(result.conflicts).toEqual([]);

    const stored = await store.readDraft("draft-test-001");
    expect(stored).toEqual(result);

    const raw = JSON.parse(
      await readFile(join(workDir, ".pluto", "portable-workflows", "draft-test-001.json"), "utf8"),
    ) as typeof result;
    expect(raw.bundle?.manifest.workflowId).toBe(bundle.manifest.workflowId);
    expect(raw.source?.path).toBe("fixtures/default-bundle.json");

    const drafts = await store.listDrafts();
    expect(drafts).toEqual([
      {
        schemaVersion: 0,
        draftId: "draft-test-001",
        workflowId: bundle.manifest.workflowId,
        workflowName: bundle.manifest.workflowName,
        mode: "draft",
        status: "ready",
        importedAt: "2026-04-30T12:00:00.000Z",
        importable: true,
        conflictCount: 0,
      },
    ]);
  });

  it("redacts absolute import source paths before returning and storing draft metadata", async () => {
    const bundle = exportPortableWorkflowBundle({ exportedAt: "2026-04-30T00:00:00.000Z" });
    const sourcePath = join(workDir, "private", "incoming", "bundle.json");

    const result = await importPortableWorkflowBundle(
      {
        bundle,
        mode: "draft",
        source: { path: sourcePath },
      },
      {
        store,
        idGen: () => "draft-test-abs-source",
        clock: () => new Date("2026-04-30T12:02:00.000Z"),
      },
    );

    expect(result.source?.path).toBe("bundle.json");
    expect(JSON.stringify(result)).not.toContain(sourcePath);

    const raw = await readFile(join(workDir, ".pluto", "portable-workflows", "draft-test-abs-source.json"), "utf8");
    expect(raw).toContain('"path": "bundle.json"');
    expect(raw).not.toContain(sourcePath);
    expect(raw).not.toContain(workDir);
  });

  it("redacts Windows absolute import source paths before returning and storing draft metadata", async () => {
    const bundle = exportPortableWorkflowBundle({ exportedAt: "2026-04-30T00:00:00.000Z" });
    const sourcePath = "C:\\Users\\alice\\private\\incoming\\bundle.json";

    const result = await importPortableWorkflowBundle(
      {
        bundle,
        mode: "draft",
        source: { path: sourcePath },
      },
      {
        store,
        idGen: () => "draft-test-win-source",
        clock: () => new Date("2026-04-30T12:03:00.000Z"),
      },
    );

    expect(result.source?.path).toBe("bundle.json");
    expect(JSON.stringify(result)).not.toContain(sourcePath);
    expect(result.source?.path).not.toContain("C:\\Users");

    const raw = await readFile(join(workDir, ".pluto", "portable-workflows", "draft-test-win-source.json"), "utf8");
    expect(raw).toContain('"path": "bundle.json"');
    expect(raw).not.toContain(sourcePath);
    expect(raw).not.toContain("C:\\Users");
  });

  it("imports a compatible bundle as a fork without activating runtime state", async () => {
    const bundle = exportPortableWorkflowBundle({ exportedAt: "2026-04-30T00:00:00.000Z" });

    const result = await importPortableWorkflowBundle(
      { bundle, mode: "fork" },
      {
        store,
        idGen: () => "draft-test-002",
        clock: () => new Date("2026-04-30T12:01:00.000Z"),
      },
    );

    expect(result.status).toBe("ready");
    expect(result.mode).toBe("fork");
    expect(result.importable).toBe(true);
    expect(result.bundle?.manifest.workflowName).toBe(bundle.manifest.workflowName);
    expect(result.publishedStateMaterialized).toBe(false);
    expect(result.runtimeStateMaterialized).toBe(false);
  });
});
