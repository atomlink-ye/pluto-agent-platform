import { execFile } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";

import { afterEach, describe, expect, it } from "vitest";

const exec = promisify(execFile);
const tempDirs: string[] = [];
const archivedMessage = "v1.6 runtime was archived in S7. Reference copy lives on the legacy-v1.6-harness-prototype branch. v2 takes pluto:run --spec <path> only.";

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

async function runCli(args: string[]): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  try {
    const result = await exec("npx", ["tsx", join(process.cwd(), "src/cli/run.ts"), ...args], {
      cwd: process.cwd(),
      timeout: 30_000,
      env: { ...process.env },
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

async function installV2PackageShims(): Promise<void> {
  const shimRoots = [
    join(process.cwd(), "src", "node_modules", "@pluto"),
    join(process.cwd(), "packages", "pluto-v2-runtime", "node_modules", "@pluto"),
  ];
  const packages = [
    {
      name: "v2-core",
      target: pathToFileURL(join(process.cwd(), "packages/pluto-v2-core/src/index.ts")).href,
    },
    {
      name: "v2-runtime",
      target: pathToFileURL(join(process.cwd(), "packages/pluto-v2-runtime/src/index.ts")).href,
    },
  ];

  for (const shimRoot of shimRoots) {
    for (const pkg of packages) {
      const dir = join(shimRoot, pkg.name);
      await mkdir(dir, { recursive: true });
      await writeFile(join(dir, "package.json"), JSON.stringify({ name: `@pluto/${pkg.name}`, type: "module", exports: "./index.js" }, null, 2), "utf8");
      await writeFile(join(dir, "index.js"), `export * from ${JSON.stringify(pkg.target)};\n`, "utf8");
    }
  }
}

describe("src/cli/run.ts unsupported v1 selectors on v2", () => {
  it("fails with the archived message for legacy v1 selectors", async () => {
    const cases = [
      ["--scenario", "hello-team"],
      ["--playbook", "research-review"],
      ["--run-profile", "fake-smoke"],
    ];

    for (const args of cases) {
      const result = await runCli(args);

      expect(result.exitCode).toBe(1);
      expect(result.stdout).toBe("");
      expect(result.stderr).toContain(archivedMessage);
    }
  });

  it("fails with the unsupported legacy field name when a v1.6-only field appears in a v2 spec", async () => {
    const workspace = await mkdtemp(join(tmpdir(), "pluto-run-v2-unsupported-"));
    tempDirs.push(workspace);

    const specPath = join(workspace, "legacy-field.yaml");
    await writeFile(specPath, [
      "runId: run-legacy-field",
      "scenarioRef: scenario/hello-team",
      "runProfileRef: fake-smoke",
      "actors:",
      "  manager:",
      "    kind: manager",
      "  generator:",
      "    kind: role",
      "    role: generator",
      "declaredActors:",
      "  - manager",
      "  - generator",
      "helperCli: ./legacy-helper.sh",
    ].join("\n"), "utf8");

    await installV2PackageShims();
    const result = await runCli([`--spec=${specPath}`]);

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("helperCli");
    expect(result.stderr).toContain("v2 AuthoredSpec does not support v1.6-only field helperCli");
    expect(result.stderr).toContain("legacy-v1.6-harness-prototype");
  });
});
