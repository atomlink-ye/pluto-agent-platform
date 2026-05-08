import { execFile } from "node:child_process";
import { join } from "node:path";
import { promisify } from "node:util";

import { describe, expect, it } from "vitest";

const exec = promisify(execFile);
const archivedMessage = "v1.6 runtime was archived in S7. Reference copy lives on the legacy-v1.6-harness-prototype branch. v2 takes pluto:run --spec <path> only.";

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

describe("src/cli/run.ts archived v1 entrypoints", () => {
  it("rejects every archived v1 invocation path with the archived branch message", async () => {
    const cases: Array<{ label: string; args: string[]; env?: Record<string, string> }> = [
      { label: "--runtime=v1", args: ["--runtime=v1"] },
      { label: "--scenario X", args: ["--scenario", "hello-team"] },
      { label: "--playbook Y", args: ["--playbook", "research-review"] },
      { label: "--run-profile Z", args: ["--run-profile", "fake-smoke"] },
      { label: "PLUTO_RUNTIME=v1", args: [], env: { PLUTO_RUNTIME: "v1" } },
    ];

    for (const testCase of cases) {
      const result = await runCli(testCase.args, testCase.env);

      expect(result.exitCode, testCase.label).toBe(1);
      expect(result.stdout, testCase.label).toBe("");
      expect(result.stderr, testCase.label).toContain(archivedMessage);
    }
  });
});
