import { execFile } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { DocumentRecordV0 } from "@/contracts/governance.js";
import { GovernanceStore } from "@/governance/governance-store.js";

const exec = promisify(execFile);

let workDir: string;
let dataDir: string;

async function runCli(args: string[]): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  try {
    const result = await exec(
      "npx",
      ["tsx", join(process.cwd(), "src/cli/governance.ts"), ...args],
      {
        cwd: process.cwd(),
        env: { ...process.env, PLUTO_DATA_DIR: dataDir },
        timeout: 10_000,
      },
    );
    return { stdout: result.stdout, stderr: result.stderr, exitCode: 0 };
  } catch (err: unknown) {
    const e = err as { stdout?: string; stderr?: string; code?: number };
    return {
      stdout: e.stdout ?? "",
      stderr: e.stderr ?? "",
      exitCode: e.code ?? 1,
    };
  }
}

beforeEach(async () => {
  workDir = await mkdtemp(join(tmpdir(), "pluto-governance-cli-errors-"));
  dataDir = join(workDir, ".pluto");

  const store = new GovernanceStore({ dataDir });
  const document: DocumentRecordV0 = {
    schemaVersion: 0,
    kind: "document",
    id: "doc-1",
    workspaceId: "workspace-1",
    createdAt: "2026-04-30T00:00:00.000Z",
    updatedAt: "2026-04-30T00:00:01.000Z",
    status: "draft",
    title: "Governed doc",
    ownerId: "owner-1",
    currentVersionId: null,
  };
  await store.put("document", document);
});

afterEach(async () => {
  await rm(workDir, { recursive: true, force: true });
});

describe("pnpm governance error handling", () => {
  it("rejects unknown kinds", async () => {
    const { stderr, exitCode } = await runCli(["list", "unknown-kind"]);
    expect(exitCode).not.toBe(0);
    expect(stderr).toContain("Unknown kind 'unknown-kind'");
  });

  it("rejects missing ids for show", async () => {
    const { stderr, exitCode } = await runCli(["show", "document"]);
    expect(exitCode).not.toBe(0);
    expect(stderr).toContain("Missing <id> argument for 'show'");
  });

  it("rejects missing objects", async () => {
    const { stderr, exitCode } = await runCli(["show", "document", "missing-doc"]);
    expect(exitCode).not.toBe(0);
    expect(stderr).toContain("document not found: missing-doc");
  });
});
