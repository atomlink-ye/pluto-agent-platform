import { execFile } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";

import { describe, expect, it } from "vitest";

const exec = promisify(execFile);
const SPEC_PATH = join(process.cwd(), "packages/pluto-v2-runtime/test-fixtures/scenarios/hello-team-paseo-mock/scenario.yaml");

async function installV2PackageShims(): Promise<void> {
  process.env.TSX_TSCONFIG_PATH = join(process.cwd(), "tests/cli/tsconfig.subpath-shims.json");
  const shimRoots = [
    join(process.cwd(), "src", "node_modules", "@pluto"),
  ];
  const coreSubpaths = [
    "index",
    "actor-ref",
    "run-event",
    "versioning",
    "protocol-request",
    "projections",
    "projections/replay",
    "core/team-context",
    "core/providers",
    "core/run-kernel",
    "core/run-state",
    "core/run-state-reducer",
    "core/spec-compiler",
  ];
  const coreExports = Object.fromEntries(
    coreSubpaths.map((subpath) => [subpath === "index" ? "." : `./${subpath}`, `./${subpath}.js`]),
  );

  for (const shimRoot of shimRoots) {
    const coreDir = join(shimRoot, "v2-core");
    await mkdir(coreDir, { recursive: true });
    await writeFile(join(coreDir, "package.json"), JSON.stringify({ name: "@pluto/v2-core", type: "module", exports: coreExports }, null, 2), "utf8");
    for (const subpath of coreSubpaths) {
      const parts = subpath.split("/");
      if (parts.length > 1) {
        await mkdir(join(coreDir, ...parts.slice(0, -1)), { recursive: true });
      }
      const target = pathToFileURL(join(process.cwd(), "packages/pluto-v2-core/src", `${subpath}.ts`)).href;
      await writeFile(join(coreDir, `${subpath}.js`), `export * from ${JSON.stringify(target)};\n`, "utf8");
    }

    const runtimeDir = join(shimRoot, "v2-runtime");
    await mkdir(runtimeDir, { recursive: true });
    await writeFile(join(runtimeDir, "package.json"), JSON.stringify({ name: "@pluto/v2-runtime", type: "module", exports: "./index.js" }, null, 2), "utf8");
    await writeFile(join(runtimeDir, "index.js"), `export * from ${JSON.stringify(pathToFileURL(join(process.cwd(), "packages/pluto-v2-runtime/src/index.ts")).href)};\n`, "utf8");
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
