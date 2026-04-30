import { execFile } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

const exec = promisify(execFile);

let workDir: string;

beforeEach(async () => {
  workDir = await mkdtemp(join(tmpdir(), "pluto-submit-test-"));
});

afterEach(async () => {
  await rm(workDir, { recursive: true, force: true });
});

async function runSubmit(args: string[]): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  try {
    const result = await exec("npx", ["tsx", join(process.cwd(), "src/cli/submit.ts"), ...args], {
      cwd: process.cwd(),
      env: { ...process.env, PLUTO_DATA_DIR: join(workDir, ".pluto") },
      timeout: 10_000,
    });
    return { stdout: result.stdout, stderr: result.stderr, exitCode: 0 };
  } catch (err: unknown) {
    const e = err as { stdout?: string; stderr?: string; code?: number };
    return { stdout: e.stdout ?? "", stderr: e.stderr ?? "", exitCode: e.code ?? 1 };
  }
}

describe("pnpm submit --max-retries validation", () => {
  const baseArgs = [
    "--title", "Retry validation",
    "--prompt", "Produce a small artifact",
    "--workspace", "unused-invalid-retries-workspace",
    "--adapter", "fake",
  ];

  it.each(["abc", "-1", "4"])("rejects invalid value %s before running", async (value) => {
    const { exitCode, stderr, stdout } = await runSubmit([...baseArgs, "--max-retries", value]);
    expect(exitCode).not.toBe(0);
    expect(stdout).toBe("");
    expect(stderr).toContain("--max-retries must be an integer from 0 to 3");
  });
});
