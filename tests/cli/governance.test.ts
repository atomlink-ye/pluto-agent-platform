import { execFile } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type {
  DocumentRecordV0,
  GovernanceListOutputV0,
  GovernanceShowOutputV0,
  ScheduleRecordV0,
  VersionRecordV0,
} from "@/contracts/governance.js";
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
  workDir = await mkdtemp(join(tmpdir(), "pluto-governance-cli-test-"));
  dataDir = join(workDir, ".pluto");

  const store = new GovernanceStore({ dataDir });
  const baseRecord = {
    schemaVersion: 0 as const,
    workspaceId: "workspace-1",
    createdAt: "2026-04-30T00:00:00.000Z",
    updatedAt: "2026-04-30T00:00:01.000Z",
    status: "active",
  };

  const document: DocumentRecordV0 = {
    ...baseRecord,
    kind: "document",
    id: "doc-1",
    title: "Governed doc",
    ownerId: "owner-1",
    currentVersionId: "ver-1",
  };
  const version: VersionRecordV0 = {
    ...baseRecord,
    kind: "version",
    id: "ver-1",
    documentId: document.id,
    createdById: "creator-1",
    label: "v1",
  };
  const schedule: ScheduleRecordV0 = {
    ...baseRecord,
    kind: "schedule",
    id: "sched-1",
    playbookId: "playbook-1",
    scenarioId: "scenario-1",
    ownerId: "owner-1",
    cadence: "0 9 * * 1",
  };

  await store.put("document", document);
  await store.put("version", version);
  await store.put("schedule", schedule);
});

afterEach(async () => {
  await rm(workDir, { recursive: true, force: true });
});

describe("pnpm governance list", () => {
  it("lists document records in text mode", async () => {
    const { stdout, exitCode } = await runCli(["list", "document"]);
    expect(exitCode).toBe(0);
    expect(stdout).toContain("doc-1");
    expect(stdout).toContain("Governed doc");
  });

  it("lists version records in JSON mode", async () => {
    const { stdout, exitCode } = await runCli(["list", "version", "--json"]);
    expect(exitCode).toBe(0);

    const output: GovernanceListOutputV0 = JSON.parse(stdout);
    expect(output.schemaVersion).toBe(0);
    expect(output.kind).toBe("version");
    expect(output.items).toHaveLength(1);
    expect(output.items[0]).toMatchObject({
      kind: "version",
      id: "ver-1",
      label: "v1",
    });
  });

  it("lists schedule records in text mode", async () => {
    const { stdout, exitCode } = await runCli(["list", "schedule"]);
    expect(exitCode).toBe(0);
    expect(stdout).toContain("sched-1");
    expect(stdout).toContain("0 9 * * 1");
  });
});

describe("pnpm governance show", () => {
  it("shows a document in JSON mode", async () => {
    const { stdout, exitCode } = await runCli(["show", "document", "doc-1", "--json"]);
    expect(exitCode).toBe(0);

    const output: GovernanceShowOutputV0 = JSON.parse(stdout);
    expect(output.schemaVersion).toBe(0);
    expect(output.kind).toBe("document");
    expect(output.item).toMatchObject({
      kind: "document",
      id: "doc-1",
      title: "Governed doc",
      currentVersionId: "ver-1",
    });
  });

  it("shows a version in text mode", async () => {
    const { stdout, exitCode } = await runCli(["show", "version", "ver-1"]);
    expect(exitCode).toBe(0);
    expect(stdout).toContain("Kind: version");
    expect(stdout).toContain("id: ver-1");
    expect(stdout).toContain("label: v1");
  });

  it("shows a schedule in JSON mode", async () => {
    const { stdout, exitCode } = await runCli(["show", "schedule", "sched-1", "--json"]);
    expect(exitCode).toBe(0);

    const output: GovernanceShowOutputV0 = JSON.parse(stdout);
    expect(output.schemaVersion).toBe(0);
    expect(output.kind).toBe("schedule");
    expect(output.item).toMatchObject({
      kind: "schedule",
      id: "sched-1",
      cadence: "0 9 * * 1",
    });
  });
});
