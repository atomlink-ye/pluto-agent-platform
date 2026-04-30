import { mkdtemp, rm } from "node:fs/promises";
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
  workDir = await mkdtemp(join(tmpdir(), "pluto-portable-import-blockers-"));
  store = new PortableWorkflowStore({ dataDir: join(workDir, ".pluto") });
});

afterEach(async () => {
  await rm(workDir, { recursive: true, force: true });
});

describe("portable workflow import blockers", () => {
  it("persists blocked imports when the bundle schema is invalid", async () => {
    const bundle = exportPortableWorkflowBundle({ exportedAt: "2026-04-30T00:00:00.000Z" }) as {
      schemaVersion: number;
    };
    bundle.schemaVersion = 1;

    const result = await importPortableWorkflowBundle(
      { bundle },
      {
        store,
        idGen: () => "draft-blocked-schema",
        clock: () => new Date("2026-04-30T12:10:00.000Z"),
      },
    );

    expect(result.status).toBe("blocked");
    expect(result.importable).toBe(false);
    expect(result.bundle).toBeNull();
    expect(result.errors).toContain("invalid_bundle: unsupported schemaVersion '1'");
    expect(result.conflicts.map((conflict) => conflict.code)).toContain("missing_dependency");

    const stored = await store.readDraft("draft-blocked-schema");
    expect(stored?.status).toBe("blocked");
  });

  it("rejects unsafe raw bundle input before sanitization can drop forbidden fields", async () => {
    const bundle = exportPortableWorkflowBundle({ exportedAt: "2026-04-30T00:00:00.000Z" }) as unknown as {
      manifest: Record<string, unknown>;
    };
    bundle.manifest = {
      ...bundle.manifest,
      endpoint: "[REDACTED:endpoint]",
    };

    const result = await importPortableWorkflowBundle(
      { bundle },
      {
        store,
        idGen: () => "draft-blocked-unsafe-raw",
        clock: () => new Date("2026-04-30T12:10:30.000Z"),
      },
    );

    expect(result.status).toBe("blocked");
    expect(result.importable).toBe(false);
    expect(result.bundle).toBeNull();
    expect(result.errors).toContain(
      "portable_bundle_unsafe:bundle.manifest.endpoint is forbidden platform state",
    );

    const stored = await store.readDraft("draft-blocked-unsafe-raw");
    expect(stored?.status).toBe("blocked");
    expect(JSON.stringify(stored)).not.toContain("[REDACTED:endpoint]");
  });

  it("records capability and dependency conflicts before storing", async () => {
    const bundle = exportPortableWorkflowBundle({ exportedAt: "2026-04-30T00:00:00.000Z" });
    bundle.manifest.runtime.requirements.providers = ["other-provider"];
    bundle.manifest.runtime.requirements.tools = {
      shell: true,
      web_fetch: true,
    };

    const result = await importPortableWorkflowBundle(
      { bundle },
      {
        store,
        idGen: () => "draft-blocked-compat",
        clock: () => new Date("2026-04-30T12:11:00.000Z"),
      },
    );

    expect(result.status).toBe("blocked");
    expect(result.importable).toBe(false);
    expect(result.bundle?.manifest.runtime.requirements.providers).toEqual(["other-provider"]);
    expect(result.conflicts.map((conflict) => conflict.code)).toEqual(
      expect.arrayContaining(["missing_dependency", "capability_unavailable"]),
    );
    expect(result.compatibility.blockers).toEqual(
      expect.arrayContaining([
        "missing_dependency: A required dependency is missing from the target environment.",
        "capability_unavailable: Required runtime capabilities are unavailable in the target environment.",
      ]),
    );
  });

  it("rejects import modes outside draft and fork as policy-denied", async () => {
    const bundle = exportPortableWorkflowBundle({ exportedAt: "2026-04-30T00:00:00.000Z" });

    const result = await importPortableWorkflowBundle(
      {
        bundle,
        mode: "published" as "draft",
      },
      {
        store,
        idGen: () => "draft-blocked-policy",
        clock: () => new Date("2026-04-30T12:12:00.000Z"),
      },
    );

    expect(result.status).toBe("blocked");
    expect(result.importable).toBe(false);
    expect(result.errors).toContain(
      "policy_denied: imports must materialize as draft or fork, received 'published'",
    );
    expect(result.conflicts.map((conflict) => conflict.code)).toContain("policy_denied");
  });

  it("emits stored-workflow collision blockers for logical id and same-name imports", async () => {
    const originalBundle = exportPortableWorkflowBundle({ exportedAt: "2026-04-30T00:00:00.000Z" });
    await importPortableWorkflowBundle(
      { bundle: originalBundle, mode: "draft" },
      {
        store,
        idGen: () => "draft-existing-workflow",
        clock: () => new Date("2026-04-30T12:13:00.000Z"),
      },
    );

    const sameNameBundle = exportPortableWorkflowBundle({ exportedAt: "2026-04-30T00:01:00.000Z" });
    sameNameBundle.manifest.workflowId = "workflow-renamed-id";

    const sameNameResult = await importPortableWorkflowBundle(
      { bundle: sameNameBundle, mode: "draft" },
      {
        store,
        idGen: () => "draft-blocked-same-name",
        clock: () => new Date("2026-04-30T12:14:00.000Z"),
      },
    );

    expect(sameNameResult.status).toBe("blocked");
    expect(sameNameResult.importable).toBe(false);
    expect(sameNameResult.conflicts.map((conflict) => conflict.code)).toContain("name_collision");
    expect(sameNameResult.compatibility.blockers).toContain(
      "name_collision: Import target name collides with an existing object.",
    );

    const duplicateResult = await importPortableWorkflowBundle(
      { bundle: originalBundle, mode: "draft" },
      {
        store,
        idGen: () => "draft-blocked-existing-workflow",
        clock: () => new Date("2026-04-30T12:15:00.000Z"),
      },
    );

    expect(duplicateResult.status).toBe("blocked");
    expect(duplicateResult.importable).toBe(false);
    expect(duplicateResult.conflicts.map((conflict) => conflict.code)).toEqual(
      expect.arrayContaining(["logical_id_collision", "name_collision"]),
    );
    expect(duplicateResult.compatibility.blockers).toEqual(
      expect.arrayContaining([
        "logical_id_collision: Import target logical ID collides with an existing object.",
        "name_collision: Import target name collides with an existing object.",
      ]),
    );

    const stored = await store.readDraft("draft-blocked-existing-workflow");
    expect(stored?.status).toBe("blocked");
  });
});
