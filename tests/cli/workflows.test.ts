import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type {
  PortableWorkflowDraftSummaryV0,
  PortableWorkflowImportResultV0,
} from "@/portable-workflow/index.js";

const exec = promisify(execFile);

let workDir: string;
let dataDir: string;

beforeEach(async () => {
  workDir = await mkdtemp(join(tmpdir(), "pluto-workflows-cli-"));
  dataDir = join(workDir, ".pluto");
});

afterEach(async () => {
  await rm(workDir, { recursive: true, force: true });
});

async function runCli(args: string[]): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  try {
    const result = await exec("npx", ["tsx", join(process.cwd(), "src/cli/workflows.ts"), ...args], {
      cwd: process.cwd(),
      env: { ...process.env, PLUTO_DATA_DIR: dataDir },
      timeout: 10_000,
    });
    return { stdout: result.stdout, stderr: result.stderr, exitCode: 0 };
  } catch (error: unknown) {
    const err = error as { stdout?: string; stderr?: string; code?: number };
    return {
      stdout: err.stdout ?? "",
      stderr: err.stderr ?? "",
      exitCode: err.code ?? 1,
    };
  }
}

describe("pnpm workflows", () => {
  it("exports, imports, lists, and shows portable workflow drafts", async () => {
    const bundlePath = join(workDir, "bundle.json");

    const exportResult = await runCli(["export", "--output", bundlePath]);
    expect(exportResult.exitCode).toBe(0);
    expect(exportResult.stdout.trim()).toBe(bundlePath);

    const importResult = await runCli(["import", bundlePath, "--json"]);
    expect(importResult.exitCode).toBe(0);
    const imported: PortableWorkflowImportResultV0 = JSON.parse(importResult.stdout);
    expect(imported.status).toBe("ready");
    expect(imported.importable).toBe(true);
    expect(imported.mode).toBe("draft");
    expect(imported.publishedStateMaterialized).toBe(false);
    expect(imported.runtimeStateMaterialized).toBe(false);
    expect(imported.source?.path).toBe("bundle.json");
    expect(importResult.stdout).not.toContain(bundlePath);
    expect(importResult.stdout).not.toContain(workDir);

    const listResult = await runCli(["drafts", "list", "--json"]);
    expect(listResult.exitCode).toBe(0);
    const listed = JSON.parse(listResult.stdout) as {
      schemaVersion: 0;
      items: PortableWorkflowDraftSummaryV0[];
    };
    expect(listed.schemaVersion).toBe(0);
    expect(listed.items).toHaveLength(1);
    expect(listed.items[0]?.draftId).toBe(imported.draftId);

    const showResult = await runCli(["drafts", "show", imported.draftId, "--json"]);
    expect(showResult.exitCode).toBe(0);
    const shown: PortableWorkflowImportResultV0 = JSON.parse(showResult.stdout);
    expect(shown.draftId).toBe(imported.draftId);
    expect(shown.bundle?.manifest.kind).toBe("pluto-portable-workflow");
    expect(shown.source?.path).toBe("bundle.json");
    expect(showResult.stdout).not.toContain(bundlePath);

    const persisted = await readFile(join(dataDir, "portable-workflows", `${imported.draftId}.json`), "utf8");
    expect(persisted).toContain('"path": "bundle.json"');
    expect(persisted).not.toContain(bundlePath);
    expect(persisted).not.toContain(workDir);
  });

  it("fails import when the requested mode is unsupported", async () => {
    const bundlePath = join(workDir, "bundle.json");
    await runCli(["export", "--output", bundlePath]);

    const result = await runCli(["import", bundlePath, "--mode", "published"]);
    expect(result.exitCode).not.toBe(0);
    expect(result.stderr).toContain("Invalid --mode 'published'. Expected draft or fork.");
  });
});
