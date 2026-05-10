#!/usr/bin/env node
import { access, lstat, mkdir, rm, writeFile } from "node:fs/promises";
import { basename, dirname, extname, join, relative, resolve } from "node:path";
import process from "node:process";
import { fileURLToPath, pathToFileURL } from "node:url";

import { parseKeyValueFlags, resolvePlutoDataDir } from "./shared/flags.js";

type CliRuntime = "v1" | "v2";

interface CliFlags {
  root: string;
  runtime?: CliRuntime;
  spec?: string;
  scenario?: string;
  runProfile?: string;
  playbook?: string;
  workspace?: string;
  dataDir?: string;
}

const ARCHIVED_V1_MESSAGE = "v1.6 runtime was archived in S7. Reference copy lives on the legacy-v1.6-harness-prototype branch. v2 takes pluto:run --spec <path> only.";

function parseCliRuntime(value: string | undefined): CliRuntime {
  if (value === "v1" || value === "v2") {
    return value;
  }

  throw new Error(`invalid_runtime:${String(value)}`);
}

function parseFlags(argv: string[]): CliFlags {
  return parseKeyValueFlags<CliFlags>(argv, {
    defaults: {
      root: process.cwd(),
    },
    flags: {
      "--root": { key: "root" },
      "--runtime": { key: "runtime", parse: parseCliRuntime },
      "--spec": { key: "spec" },
      "--scenario": { key: "scenario" },
      "--run-profile": { key: "runProfile" },
      "--playbook": { key: "playbook" },
      "--workspace": { key: "workspace" },
      "--data-dir": { key: "dataDir" },
    },
  });
}

function resolveSelectedRuntime(flags: CliFlags): CliRuntime {
  if (flags.runtime) {
    return flags.runtime;
  }

  const envRuntime = process.env["PLUTO_RUNTIME"];
  return envRuntime === undefined ? "v2" : parseCliRuntime(envRuntime);
}

function hasV1NameSelectors(flags: CliFlags): boolean {
  return Boolean(flags.scenario || flags.playbook || flags.runProfile);
}

function validateInvocation(flags: CliFlags): void {
  const runtime = resolveSelectedRuntime(flags);
  if (runtime === "v1" || hasV1NameSelectors(flags)) {
    throw new Error(ARCHIVED_V1_MESSAGE);
  }

  if (!flags.spec) {
    throw new Error("missing_required_flag: --spec is required");
  }
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

async function resolveCliRepoRoot(): Promise<string> {
  let currentDir = dirname(fileURLToPath(import.meta.url));

  while (true) {
    if (
      await pathExists(join(currentDir, "packages", "pluto-v2-core"))
      && await pathExists(join(currentDir, "packages", "pluto-v2-runtime"))
    ) {
      return currentDir;
    }

    const parentDir = dirname(currentDir);
    if (parentDir === currentDir) {
      throw new Error("v2_runtime_shims_unavailable: unable to locate repo root for CLI runtime shims");
    }

    currentDir = parentDir;
  }
}

async function resolveShimTarget(repoRoot: string, packageName: "v2-core" | "v2-runtime"): Promise<string> {
  const packageDir = join(repoRoot, "packages", `pluto-${packageName}`);
  const candidates = [
    join(packageDir, "dist", "src", "index.js"),
    join(packageDir, "src", "index.ts"),
  ];

  for (const candidate of candidates) {
    if (await pathExists(candidate)) {
      return candidate;
    }
  }

  throw new Error(`v2_runtime_shims_unavailable: unable to locate ${packageName} entrypoint`);
}

async function writePackageShim(packageDir: string, targetPath: string, packageName: string): Promise<void> {
  const existingEntry = await lstat(packageDir).catch(() => null);
  if (existingEntry?.isSymbolicLink()) {
    await rm(packageDir, { force: true, recursive: true });
  }

  await mkdir(packageDir, { recursive: true });

  const targetRoot = dirname(targetPath);
  const targetExtension = extname(targetPath);
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
  const shimSubpaths = packageName === "@pluto/v2-core" ? coreSubpaths : ["index"];
  const packageExports = Object.fromEntries(
    shimSubpaths.map((subpath) => [subpath === "index" ? "." : `./${subpath}`, `./${subpath}.js`]),
  );
  await writeFile(
    join(packageDir, "package.json"),
    `${JSON.stringify({
      name: packageName,
      private: true,
      type: "module",
      exports: packageExports,
    }, null, 2)}\n`,
    "utf8",
  );

  for (const subpath of shimSubpaths) {
    const parts = subpath.split("/");
    if (parts.length > 1) {
      await mkdir(join(packageDir, ...parts.slice(0, -1)), { recursive: true });
    }
    const target = join(targetRoot, `${subpath}${targetExtension}`);
    const importTarget = relative(join(packageDir, ...parts.slice(0, -1)), target).replaceAll("\\", "/");
    const normalizedImportTarget = importTarget.startsWith(".") ? importTarget : `./${importTarget}`;
    await writeFile(join(packageDir, `${subpath}.js`), `export * from ${JSON.stringify(normalizedImportTarget)};\n`, "utf8");
  }
}

async function ensureV2RuntimeShims(): Promise<void> {
  const repoRoot = await resolveCliRepoRoot();
  const [coreTarget, runtimeTarget] = await Promise.all([
    resolveShimTarget(repoRoot, "v2-core"),
    resolveShimTarget(repoRoot, "v2-runtime"),
  ]);

  await Promise.all([
    writePackageShim(join(repoRoot, "node_modules", "@pluto", "v2-core"), coreTarget, "@pluto/v2-core"),
    writePackageShim(join(repoRoot, "node_modules", "@pluto", "v2-runtime"), runtimeTarget, "@pluto/v2-runtime"),
    writePackageShim(join(repoRoot, "packages", "pluto-v2-runtime", "node_modules", "@pluto", "v2-core"), coreTarget, "@pluto/v2-core"),
  ]);
}

async function loadV2BridgeModule(): Promise<{
  runViaV2Bridge: (
    input: Record<string, unknown>,
    deps: Record<string, unknown>,
  ) => Promise<Record<string, unknown>>;
}> {
  try {
    await ensureV2RuntimeShims();
    const moduleUrl = new URL("./v2-cli-bridge.js", import.meta.url).href;
    const bridgeModule = await import(moduleUrl) as {
      runViaV2Bridge?: unknown;
    };
    if (typeof bridgeModule.runViaV2Bridge !== "function") {
      throw new Error("v2_cli_bridge_missing_export:runViaV2Bridge");
    }

    return {
      runViaV2Bridge: bridgeModule.runViaV2Bridge as (
        input: Record<string, unknown>,
        deps: Record<string, unknown>,
      ) => Promise<Record<string, unknown>>,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (message.includes("v2-cli-bridge")) {
      throw new Error("v2_cli_bridge_unavailable: src/cli/v2-cli-bridge.ts is required for --runtime=v2");
    }

    throw error;
  }
}

async function loadV2BridgeDeps(): Promise<Record<string, unknown>> {
  await ensureV2RuntimeShims();
  const repoRoot = await resolveCliRepoRoot();
  const [coreTarget, runtimeTarget] = await Promise.all([
    resolveShimTarget(repoRoot, "v2-core"),
    resolveShimTarget(repoRoot, "v2-runtime"),
  ]);
  const [coreModule, runtimeModule] = await Promise.all([
    import(new URL(pathToFileURL(coreTarget).href).href) as Promise<Record<string, unknown>>,
    import(new URL(pathToFileURL(runtimeTarget).href).href) as Promise<Record<string, unknown>>,
  ]);

  const deps = {
    defaultClockProvider: coreModule["defaultClockProvider"],
    defaultIdProvider: coreModule["defaultIdProvider"],
    loadAuthoredSpec: runtimeModule["loadAuthoredSpec"],
    makePaseoAdapter: runtimeModule["makePaseoAdapter"],
    makePaseoCliClient: runtimeModule["makePaseoCliClient"],
    runPaseo: runtimeModule["runPaseo"],
  };

  if (Object.values(deps).some((value) => value === undefined)) {
    throw new Error("v2_bridge_deps_unavailable: required v2 runtime exports are missing");
  }

  return deps;
}

function resolveCliDataDir(flags: CliFlags): string {
  return flags.dataDir ? resolve(flags.dataDir) : resolvePlutoDataDir();
}

function resolveV2EvidenceOutputDir(flags: CliFlags): string {
  const specPath = resolve(flags.spec ?? "v2-cli");
  const runId = basename(specPath, extname(specPath)) || "v2-cli";
  return join(resolveCliDataDir(flags), "runs", runId);
}

function resolveV2RunRootDir(flags: CliFlags): string {
  if (flags.dataDir) {
    return join(resolve(flags.dataDir), "runs");
  }

  return join(resolve(flags.workspace ?? flags.root), ".pluto", "runs");
}

async function runV2(flags: CliFlags): Promise<void> {
  const specPath = flags.spec;
  if (!specPath) {
    throw new Error("missing_required_flag: --spec is required");
  }

  const [{ runViaV2Bridge }, bridgeDeps] = await Promise.all([
    loadV2BridgeModule(),
    loadV2BridgeDeps(),
  ]);
  const result = await runViaV2Bridge({
    specPath: resolve(specPath),
    workspaceCwd: resolve(flags.workspace ?? flags.root),
    evidenceOutputDir: resolveV2EvidenceOutputDir(flags),
    runRootDir: resolveV2RunRootDir(flags),
    ...(process.env["PASEO_HOST"] ? { paseoHost: process.env["PASEO_HOST"] } : {}),
    ...(process.env["PASEO_BIN"] ? { paseoBin: process.env["PASEO_BIN"] } : {}),
    stderr: process.stderr,
  }, bridgeDeps);

  console.log(JSON.stringify(result, null, 2));

  const exitCode = result["exitCode"];
  if (exitCode === 1 || exitCode === 2) {
    process.exitCode = exitCode;
  }
}

async function main() {
  const flags = parseFlags(process.argv.slice(2));
  validateInvocation(flags);
  await runV2(flags);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
