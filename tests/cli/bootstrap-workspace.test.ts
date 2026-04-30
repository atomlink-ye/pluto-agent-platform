import { execFile } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

const exec = promisify(execFile);

let workDir = "";
let dataDir = "";

beforeEach(async () => {
  workDir = await mkdtemp(join(tmpdir(), "pluto-bootstrap-cli-test-"));
  dataDir = join(workDir, ".pluto");
});

afterEach(async () => {
  await rm(workDir, { recursive: true, force: true });
});

async function runCli(args: string[]): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  try {
    const result = await exec("npx", ["tsx", join(process.cwd(), "src/cli/bootstrap.ts"), ...args], {
      cwd: process.cwd(),
      env: { ...process.env, PLUTO_DATA_DIR: dataDir },
      timeout: 10_000,
    });
    return { stdout: result.stdout, stderr: result.stderr, exitCode: 0 };
  } catch (error: unknown) {
    const failure = error as { stdout?: string; stderr?: string; code?: number };
    return {
      stdout: failure.stdout ?? "",
      stderr: failure.stderr ?? "",
      exitCode: failure.code ?? 1,
    };
  }
}

describe("pnpm bootstrap", () => {
  it("supports workspace, status, resume, and reset-local with JSON and text output", async () => {
    const workspace = await runCli([
      "workspace",
      "--workspace-id",
      "workspace-local-v0",
      "--principal-id",
      "user-admin-1",
      "--json",
    ]);
    expect(workspace.exitCode).toBe(0);
    expect(JSON.parse(workspace.stdout)).toMatchObject({
      command: "workspace",
      status: "completed",
      workspaceRef: { id: "workspace-local-v0" },
      principalRef: { principalId: "user-admin-1" },
    });

    const statusText = await runCli(["status", "--workspace-id", "workspace-local-v0"]);
    expect(statusText.exitCode).toBe(0);
    expect(statusText.stdout).toContain("Status: completed");
    expect(statusText.stdout).toContain("Workspace: workspace-local-v0");
    expect(statusText.stdout).toContain("Checklist: 8/8");

    const reset = await runCli(["reset-local", "--workspace-id", "workspace-local-v0", "--json"]);
    expect(reset.exitCode).toBe(0);
    expect(JSON.parse(reset.stdout)).toMatchObject({
      command: "reset-local",
      status: "reset",
      revoked: { adminBinding: true },
    });

    const resume = await runCli([
      "resume",
      "--workspace-id",
      "workspace-local-v0",
      "--principal-id",
      "user-admin-2",
      "--json",
    ]);
    expect(resume.exitCode).toBe(0);
    expect(JSON.parse(resume.stdout)).toMatchObject({
      command: "resume",
      status: "completed",
      principalRef: { principalId: "user-admin-2" },
    });

    const statusJson = await runCli(["status", "--workspace-id", "workspace-local-v0", "--json"]);
    expect(statusJson.exitCode).toBe(0);
    expect(JSON.parse(statusJson.stdout)).toMatchObject({
      status: "completed",
      principalRef: { principalId: "user-admin-2" },
      blocker: null,
    });
  });
});
