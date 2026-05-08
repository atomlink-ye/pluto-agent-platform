import * as nodeFs from 'node:fs/promises';
import { dirname, isAbsolute, join } from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

export interface ActorBridgeMaterialization {
  readonly wrapperPath: string;
  readonly handoffJsonPath: string;
}

export interface ActorBridgeDependencyPaths {
  readonly runtimePackageRoot: string;
  readonly runtimeTsconfigPath: string;
  readonly plutoToolSourcePath: string;
  readonly tsxBinPath: string;
}

type FsModule = typeof import('node:fs/promises');

const RUNTIME_PACKAGE_NAME = '@pluto/v2-runtime';
const ACTOR_BRIDGE_SCHEMA_VERSION = '1.0';

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'"'"'`)}'`;
}

function handoffFieldReader(field: 'apiUrl' | 'bearerToken' | 'actorKey'): string {
  return [
    'const handoff = JSON.parse(require("fs").readFileSync(process.argv[1], "utf8"));',
    `process.stdout.write(String(handoff.${field}));`,
  ].join(' ');
}

async function findRuntimePackageRoot(startDir: string, fs: FsModule): Promise<string> {
  let currentDir = startDir;

  for (;;) {
    const packageJsonPath = join(currentDir, 'package.json');
    try {
      const packageJson = JSON.parse(await fs.readFile(packageJsonPath, 'utf8')) as { name?: unknown };
      if (packageJson.name === RUNTIME_PACKAGE_NAME) {
        return currentDir;
      }
    } catch {
      // Keep walking upward until the runtime package root is found.
    }

    const parentDir = dirname(currentDir);
    if (parentDir === currentDir) {
      throw new Error(`Unable to resolve ${RUNTIME_PACKAGE_NAME} package root from ${startDir}`);
    }
    currentDir = parentDir;
  }
}

async function assertPathExists(path: string, fs: FsModule): Promise<void> {
  try {
    await fs.stat(path);
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new Error(`Required actor bridge dependency is missing at ${path}: ${detail}`);
  }
}

async function ensurePlutoToolSourceDependencyLinks(runtimePackageRoot: string, fs: FsModule): Promise<void> {
  const packagesRoot = dirname(runtimePackageRoot);
  const corePackageRoot = join(packagesRoot, 'pluto-v2-core');
  const coreNodeModulesDir = join(corePackageRoot, 'node_modules');
  const linkedDependencyPath = join(coreNodeModulesDir, 'zod');
  const sourceDependencyPath = join(runtimePackageRoot, 'node_modules', 'zod');

  await assertPathExists(sourceDependencyPath, fs);
  await fs.mkdir(coreNodeModulesDir, { recursive: true });
  try {
    await fs.lstat(linkedDependencyPath);
    return;
  } catch (error) {
    if (!(error instanceof Error) || !('code' in error) || error.code !== 'ENOENT') {
      const detail = error instanceof Error ? error.message : String(error);
      throw new Error(`Unable to prepare Pluto tool source dependency link at ${linkedDependencyPath}: ${detail}`);
    }
  }

  await fs.symlink(sourceDependencyPath, linkedDependencyPath, 'dir');
}

export async function resolveActorBridgeDependencyPaths(fs: FsModule = nodeFs): Promise<ActorBridgeDependencyPaths> {
  const moduleDir = dirname(fileURLToPath(import.meta.url));
  const runtimePackageRoot = await findRuntimePackageRoot(moduleDir, fs);
  const repoRoot = dirname(dirname(runtimePackageRoot));
  const runtimeTsconfigPath = join(runtimePackageRoot, 'tsconfig.json');
  const plutoToolSourcePath = join(runtimePackageRoot, 'src', 'cli', 'pluto-tool.ts');
  const tsxBinPath = join(repoRoot, 'node_modules', '.bin', 'tsx');

  await assertPathExists(runtimeTsconfigPath, fs);
  await assertPathExists(plutoToolSourcePath, fs);
  await assertPathExists(tsxBinPath, fs);

  return {
    runtimePackageRoot,
    runtimeTsconfigPath,
    plutoToolSourcePath,
    tsxBinPath,
  };
}

export async function materializeActorBridge(input: {
  readonly actorCwd: string;
  readonly apiUrl: string;
  readonly bearerToken: string;
  readonly actorKey: string;
  readonly plutoToolSourcePath: string;
  readonly tsxBinPath: string;
  readonly fs?: FsModule;
}): Promise<ActorBridgeMaterialization> {
  const fs = input.fs ?? nodeFs;
  if (!isAbsolute(input.actorCwd)) {
    throw new Error(`actorCwd must be absolute: ${input.actorCwd}`);
  }
  if (!isAbsolute(input.plutoToolSourcePath)) {
    throw new Error(`plutoToolSourcePath must be absolute: ${input.plutoToolSourcePath}`);
  }
  if (!isAbsolute(input.tsxBinPath)) {
    throw new Error(`tsxBinPath must be absolute: ${input.tsxBinPath}`);
  }

  const metadataDir = join(input.actorCwd, '.pluto');
  const handoffJsonPath = join(metadataDir, 'handoff.json');
  const wrapperPath = join(input.actorCwd, 'pluto-tool');
  const runtimePackageRoot = dirname(dirname(dirname(input.plutoToolSourcePath)));
  const runtimeTsconfigPath = join(runtimePackageRoot, 'tsconfig.json');
  await assertPathExists(runtimeTsconfigPath, fs);
  await ensurePlutoToolSourceDependencyLinks(runtimePackageRoot, fs);
  await fs.mkdir(metadataDir, { recursive: true });
  await fs.writeFile(handoffJsonPath, JSON.stringify({
    apiUrl: input.apiUrl,
    bearerToken: input.bearerToken,
    actorKey: input.actorKey,
    schemaVersion: ACTOR_BRIDGE_SCHEMA_VERSION,
  }, null, 2));

  const wrapper = [
    '#!/bin/bash',
    'set -euo pipefail',
    'HANDOFF="$(dirname "$0")/.pluto/handoff.json"',
    'if [ ! -f "$HANDOFF" ]; then',
    '  echo "pluto-tool: missing handoff at $HANDOFF" >&2',
    '  exit 64',
    'fi',
    `export PLUTO_RUN_API_URL="$(${shellQuote(process.execPath)} -e ${shellQuote(handoffFieldReader('apiUrl'))} "$HANDOFF")"`,
    `export PLUTO_RUN_TOKEN="$(${shellQuote(process.execPath)} -e ${shellQuote(handoffFieldReader('bearerToken'))} "$HANDOFF")"`,
    `export PLUTO_RUN_ACTOR="$(${shellQuote(process.execPath)} -e ${shellQuote(handoffFieldReader('actorKey'))} "$HANDOFF")"`,
    `exec ${shellQuote(input.tsxBinPath)} --tsconfig ${shellQuote(runtimeTsconfigPath)} ${shellQuote(input.plutoToolSourcePath)} "$@"`,
    '',
  ].join('\n');
  await fs.writeFile(wrapperPath, wrapper, 'utf8');
  await fs.chmod(wrapperPath, 0o755);

  return {
    wrapperPath,
    handoffJsonPath,
  };
}
