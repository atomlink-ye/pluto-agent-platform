#!/usr/bin/env node
import { access, lstat, mkdir, rm, writeFile } from "node:fs/promises";
import { basename, dirname, extname, join, relative, resolve } from "node:path";
import process from "node:process";
import { fileURLToPath, pathToFileURL } from "node:url";

import { FakeAdapter } from "../adapters/fake/index.js";
import { PaseoOpenCodeAdapter } from "../adapters/paseo-opencode/index.js";
import { parseKeyValueFlags, resolvePlutoDataDir } from "./shared/flags.js";
import { buildRunSelection } from "./shared/run-selection.js";
import { runManagerHarness } from "../orchestrator/manager-run-harness.js";
import { resolveRuntimeHelperMvpEnabled } from "../orchestrator/runtime-helper.js";

type CliRuntime = "v1" | "v2";

interface CliFlags {
  root: string;
  runtime?: CliRuntime;
  spec?: string;
  scenario?: string;
  runProfile?: string;
  playbook?: string;
  task?: string;
  workspace?: string;
  adapter: "fake" | "paseo-opencode";
  dataDir?: string;
}

const V1_DEPRECATION_WARNING = "v1.6 runtime is deprecated; will be archived in S7. See docs/design-docs/v2-cli-default-switch.md for migration.";
const V2_NAME_SELECTOR_ERROR = "v1.6 name-based selection (--scenario/--playbook/--run-profile) requires --runtime=v1. For v2, pass a single --spec=<path> AuthoredSpec file. v1.6 will be archived in S7.";
let hasEmittedV1DeprecationWarning = false;

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
      adapter: "fake",
    },
    flags: {
      "--root": { key: "root" },
      "--runtime": { key: "runtime", parse: parseCliRuntime },
      "--spec": { key: "spec" },
      "--scenario": { key: "scenario" },
      "--run-profile": { key: "runProfile" },
      "--playbook": { key: "playbook" },
      "--task": { key: "task" },
      "--workspace": { key: "workspace" },
      "--adapter": {
        key: "adapter",
        parse: (value) => {
          if (value !== "fake" && value !== "paseo-opencode") {
            throw new Error(`unknown_adapter:${value}`);
          }
          return value;
        },
      },
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

function emitV1DeprecationWarning(): void {
  if (hasEmittedV1DeprecationWarning) {
    return;
  }

  hasEmittedV1DeprecationWarning = true;
  console.error(V1_DEPRECATION_WARNING);
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

  const importTarget = relative(packageDir, targetPath).replaceAll("\\", "/");
  const normalizedImportTarget = importTarget.startsWith(".") ? importTarget : `./${importTarget}`;
  await writeFile(
    join(packageDir, "package.json"),
    `${JSON.stringify({
      name: packageName,
      private: true,
      type: "module",
      exports: {
        ".": "./index.js",
      },
    }, null, 2)}\n`,
    "utf8",
  );
  await writeFile(join(packageDir, "index.js"), `export * from ${JSON.stringify(normalizedImportTarget)};\n`, "utf8");
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

async function runV1(flags: CliFlags): Promise<void> {
  if (!flags.scenario) {
    throw new Error("missing_required_flag: --scenario is required");
  }

  emitV1DeprecationWarning();
  const selection = buildRunSelection({
    scenario: flags.scenario,
    ...(flags.runProfile ? { runProfile: flags.runProfile } : {}),
    ...(flags.playbook ? { playbook: flags.playbook } : {}),
    ...(flags.task ? { task: flags.task } : {}),
  });
  const workspaceSubdirPerRun = Boolean(flags.workspace)
    && flags.adapter === "paseo-opencode"
    && resolveRuntimeHelperMvpEnabled();
  const result = await runManagerHarness({
    rootDir: resolve(flags.root),
    selection,
    ...(flags.workspace ? { workspaceOverride: resolve(flags.workspace) } : {}),
    ...(workspaceSubdirPerRun ? { workspaceSubdirPerRun: true } : {}),
    ...(flags.dataDir ? { dataDir: flags.dataDir } : {}),
    createAdapter: ({ team, workspaceCwd }) => flags.adapter === "fake"
      ? new FakeAdapter({ team })
      : new PaseoOpenCodeAdapter({ workspaceCwd, deleteAgentsOnEnd: false }),
  });

  console.log(JSON.stringify({
    runId: result.run.runId,
    status: result.run.status,
    scenario: result.run.scenario,
    playbook: result.run.playbook,
    runProfile: result.run.runProfile,
    workspaceDir: result.workspaceDir,
    runDir: result.runDir,
    artifactPath: result.artifactPath,
    evidencePacketPath: result.canonicalEvidencePath,
    evidencePath: result.legacyEvidencePath,
  }, null, 2));

  if (result.run.status !== "succeeded") {
    process.exitCode = result.legacyResult.blockerReason === "chat_transport_unavailable" ? 2 : 1;
  }
}

async function runV2(flags: CliFlags): Promise<void> {
  if (hasV1NameSelectors(flags)) {
    throw new Error(V2_NAME_SELECTOR_ERROR);
  }

  if (!flags.spec) {
    throw new Error("missing_required_flag: --spec is required");
  }

  const [{ runViaV2Bridge }, bridgeDeps] = await Promise.all([
    loadV2BridgeModule(),
    loadV2BridgeDeps(),
  ]);
  const result = await runViaV2Bridge({
    specPath: resolve(flags.spec),
    workspaceCwd: resolve(flags.workspace ?? flags.root),
    evidenceOutputDir: resolveV2EvidenceOutputDir(flags),
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
  if (resolveSelectedRuntime(flags) === "v1") {
    await runV1(flags);
    return;
  }

  await runV2(flags);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
