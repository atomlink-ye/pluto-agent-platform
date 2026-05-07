import { execFile } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

import { afterEach, describe, expect, it } from "vitest";

const exec = promisify(execFile);
const tempDirs: string[] = [];
const warning = "v1.6 runtime is deprecated; will be archived in S7. See docs/design-docs/v2-cli-default-switch.md for migration.";

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

async function runCli(args: string[], env?: Record<string, string>): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  try {
    const result = await exec("npx", ["tsx", join(process.cwd(), "src/cli/run.ts"), ...args], {
      cwd: process.cwd(),
      timeout: 30_000,
      env: { ...process.env, ...env },
    });
    return { stdout: result.stdout, stderr: result.stderr, exitCode: 0 };
  } catch (error) {
    const execError = error as { stdout?: string; stderr?: string; code?: number };
    return {
      stdout: execError.stdout ?? "",
      stderr: execError.stderr ?? "",
      exitCode: execError.code ?? 1,
    };
  }
}

describe("src/cli/run.ts v1 opt-in", () => {
  it("routes to the four-layer v1 harness and emits one deprecation warning", async () => {
    const workspace = await mkdtemp(join(tmpdir(), "pluto-run-v1-opt-in-"));
    const dataDir = join(workspace, ".pluto");
    tempDirs.push(workspace);

    const result = await runCli([
      "--runtime=v1",
      "--scenario",
      "hello-team",
      "--playbook",
      "research-review",
      "--run-profile",
      "fake-smoke",
      "--workspace",
      workspace,
      "--data-dir",
      dataDir,
    ]);

    expect(result.exitCode).toBe(0);
    expect(result.stderr).toContain(warning);
    expect(result.stderr.match(/v1\.6 runtime is deprecated/g)).toHaveLength(1);

    const output = JSON.parse(result.stdout) as { status: string; scenario: string; playbook: string };
    expect(output.status).toBe("succeeded");
    expect(output.scenario).toBe("hello-team");
    expect(output.playbook).toBe("research-review");
  }, 30_000);
});
