import { execFile } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";

import { describe, expect, it } from "vitest";

const exec = promisify(execFile);
const SPEC_PATH = join(process.cwd(), "packages/pluto-v2-runtime/test-fixtures/scenarios/hello-team-paseo-mock/scenario.yaml");

async function installV2PackageShims(): Promise<void> {
  const shimRoots = [
    join(process.cwd(), "node_modules", "@pluto"),
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

describe("src/cli/run.ts v2 exit code 2", () => {
  it("exits with code 2 when the paseo binary is missing on the default v2 path", async () => {
    await installV2PackageShims();
    try {
      await exec(
        "npx",
        ["tsx", join(process.cwd(), "src/cli/run.ts"), `--spec=${SPEC_PATH}`],
        {
          cwd: process.cwd(),
          timeout: 30_000,
          env: {
            ...process.env,
            PASEO_BIN: "/definitely/missing/paseo",
          },
        },
      );
      throw new Error("expected CLI failure");
    } catch (error) {
      const execError = error as { code?: number; stdout?: string; stderr?: string };
      expect(execError.code).toBe(2);
      const output = JSON.parse(String(execError.stdout ?? "{}")) as { status?: string; exitCode?: number };
      expect(output.status).toBe("failed");
      expect(output.exitCode).toBe(2);
      expect(String(execError.stderr ?? "")).toContain("ENOENT");
    }
  }, 30_000);
});
