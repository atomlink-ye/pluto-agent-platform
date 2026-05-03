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

describe("src/cli/run.ts", () => {
  it("invokes the four-layer manager harness from the CLI", async () => {
    const workspace = await mkdtemp(join(tmpdir(), "pluto-run-cli-"));
    const dataDir = join(workspace, ".pluto");
    tempDirs.push(workspace);

    const { stdout } = await exec(
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
      ],
      { cwd: process.cwd(), timeout: 30_000 },
    );

    const output = JSON.parse(stdout) as { status: string; scenario: string; evidencePacketPath: string };
    expect(output.status).toBe("succeeded");
    expect(output.scenario).toBe("hello-team");
    expect(output.evidencePacketPath.endsWith("evidence-packet.json")).toBe(true);
  }, 30_000);
});

describe("src/cli/package.ts", () => {
  it("prints a compiled run package from the CLI", async () => {
    const workspace = await mkdtemp(join(tmpdir(), "pluto-package-cli-"));
    tempDirs.push(workspace);

    const { stdout } = await exec(
      "pnpm",
      [
        "--silent",
        "pluto:package",
        "--",
        "--scenario",
        "hello-team",
        "--run-profile",
        "fake-smoke",
        "--workspace",
        workspace,
      ],
      { cwd: process.cwd(), timeout: 15_000 },
    );

    const output = JSON.parse(stdout) as { kind: string; runId: string; selection: { scenario: string }; workspace: { materializedCwd: string } };
    expect(output.kind).toBe("run_package");
    expect(output.runId).toBe("inspect-run");
    expect(output.selection.scenario).toBe("hello-team");
    expect(output.workspace.materializedCwd).toBe(workspace);
  });
});
