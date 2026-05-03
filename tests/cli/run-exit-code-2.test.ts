import { execFile } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

import { afterEach, describe, expect, it } from "vitest";

const exec = promisify(execFile);
const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe("src/cli/run.ts exit code 2", () => {
  it("exits with code 2 when paseo chat capability probing fails", async () => {
    const workspace = await mkdtemp(join(tmpdir(), "pluto-run-cli-exit-2-"));
    const dataDir = join(workspace, ".pluto");
    tempDirs.push(workspace);

    try {
      await exec(
        "npx",
        [
          "tsx",
          join(process.cwd(), "src/cli/run.ts"),
          "--scenario",
          "hello-team",
          "--run-profile",
          "fake-smoke",
          "--workspace",
          workspace,
          "--data-dir",
          dataDir,
          "--adapter",
          "paseo-opencode",
        ],
        {
          cwd: process.cwd(),
          timeout: 15_000,
          env: {
            ...process.env,
            PASEO_BIN: "/definitely/missing/paseo",
          },
        },
      );
      throw new Error("expected CLI failure");
    } catch (error) {
      const execError = error as { code?: number; stdout?: string };
      expect(execError.code).toBe(2);
      const output = JSON.parse(String(execError.stdout ?? "{}")) as { status?: string };
      expect(output.status).toBe("failed");
    }
  });
});
