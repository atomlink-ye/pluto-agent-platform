import * as nodeFs from 'node:fs/promises';
import { dirname, isAbsolute, join } from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

export interface ActorBridgeMaterialization {
  readonly runBinPath: string;
  readonly wrapperPath: string;
  readonly handoffJsonPath: string;
}

export interface ActorBridgeDependencyPaths {
  readonly runtimePackageRoot: string;
  readonly plutoToolBinPath: string;
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

function fileStdoutScript(): string {
  return 'process.stdout.write(require("fs").readFileSync(process.argv[1], "utf8"));';
}

function readStateFastPathScript(): string {
  return [
    'const fs = require("fs");',
    'const handoff = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));',
    'const rawApiUrl = String(handoff.apiUrl);',
    'const baseUrl = rawApiUrl.endsWith("/") ? rawApiUrl.slice(0, -1) : rawApiUrl;',
    'fetch(baseUrl + "/state", {',
    '  method: "GET",',
    '  headers: {',
    '    authorization: "Bearer " + String(handoff.bearerToken),',
    '    "Pluto-Run-Actor": String(handoff.actorKey),',
    '  },',
    '}).then(async (response) => {',
    '  const body = await response.text();',
    '  if (!response.ok) {',
    '    process.stderr.write(body.length > 0 ? body : "pluto-tool read-state failed with " + response.status);',
    '    process.exit(1);',
    '  }',
    '  process.stdout.write(body);',
    '  process.exit(0);',
    '}).catch((error) => {',
    '  process.stderr.write(error instanceof Error ? error.message : String(error));',
    '  process.exit(1);',
    '});',
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

async function assertCompiledPlutoToolExists(path: string, fs: FsModule): Promise<void> {
  try {
    await fs.stat(path);
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new Error(
      `Compiled pluto-tool bridge is missing at ${path}. Build the runtime CLI first with \`pnpm --filter @pluto/v2-runtime build\`. (${detail})`,
    );
  }
}

export async function resolveActorBridgeDependencyPaths(fs: FsModule = nodeFs): Promise<ActorBridgeDependencyPaths> {
  const moduleDir = dirname(fileURLToPath(import.meta.url));
  const runtimePackageRoot = await findRuntimePackageRoot(moduleDir, fs);
  const plutoToolBinPath = join(runtimePackageRoot, 'dist', 'src', 'cli', 'pluto-tool.js');

  await assertCompiledPlutoToolExists(plutoToolBinPath, fs);

  return {
    runtimePackageRoot,
    plutoToolBinPath,
  };
}

export async function materializeActorBridge(input: {
  readonly actorCwd: string;
  readonly runBinPath: string;
  readonly apiUrl: string;
  readonly bearerToken: string;
  readonly actorKey: string;
  readonly plutoToolBinPath: string;
  readonly fs?: FsModule;
}): Promise<ActorBridgeMaterialization> {
  const fs = input.fs ?? nodeFs;
  if (!isAbsolute(input.actorCwd)) {
    throw new Error(`actorCwd must be absolute: ${input.actorCwd}`);
  }
  if (!isAbsolute(input.runBinPath)) {
    throw new Error(`runBinPath must be absolute: ${input.runBinPath}`);
  }
  if (!isAbsolute(input.plutoToolBinPath)) {
    throw new Error(`plutoToolBinPath must be absolute: ${input.plutoToolBinPath}`);
  }

  const metadataDir = join(input.actorCwd, '.pluto');
  const handoffJsonPath = join(metadataDir, 'handoff.json');
  const wrapperPath = join(input.actorCwd, 'pluto-tool');
  const runBinDir = dirname(input.runBinPath);
  await assertCompiledPlutoToolExists(input.plutoToolBinPath, fs);
  await fs.mkdir(metadataDir, { recursive: true });
  await fs.mkdir(runBinDir, { recursive: true });
  await fs.writeFile(handoffJsonPath, JSON.stringify({
    apiUrl: input.apiUrl,
    bearerToken: input.bearerToken,
    actorKey: input.actorKey,
    schemaVersion: ACTOR_BRIDGE_SCHEMA_VERSION,
  }, null, 2));

  const nodeBinDir = dirname(process.execPath);
  const runBinWrapper = [
    '#!/bin/bash',
    'set -euo pipefail',
    `export PATH=${shellQuote(`${nodeBinDir}:/usr/local/bin:/usr/bin:/bin`)}\${PATH:+:$PATH}`,
    `exec node ${shellQuote(input.plutoToolBinPath)} "$@"`,
    '',
  ].join('\n');
  await fs.writeFile(input.runBinPath, runBinWrapper, 'utf8');
  await fs.chmod(input.runBinPath, 0o755);

  const wrapper = [
    '#!/bin/bash',
    'set -euo pipefail',
    `export PATH=${shellQuote(`${nodeBinDir}:/usr/local/bin:/usr/bin:/bin`)}\${PATH:+:$PATH}`,
    'HANDOFF="$(dirname "$0")/.pluto/handoff.json"',
    'SELF_CHECK_STATE="$(dirname "$0")/.pluto/self-check-state.json"',
    'if [ ! -f "$HANDOFF" ]; then',
    '  echo "pluto-tool: missing handoff at $HANDOFF" >&2',
    '  exit 64',
    'fi',
    'if [ "${1:-}" = "read-state" ]; then',
    '  if [ -f "$SELF_CHECK_STATE" ]; then',
    `    exec ${shellQuote(process.execPath)} -e ${shellQuote(fileStdoutScript())} "$SELF_CHECK_STATE"`,
    '  fi',
    `  exec ${shellQuote(process.execPath)} -e ${shellQuote(readStateFastPathScript())} "$HANDOFF"`,
    'fi',
    `export PLUTO_RUN_API_URL="$(${shellQuote(process.execPath)} -e ${shellQuote(handoffFieldReader('apiUrl'))} "$HANDOFF")"`,
    `export PLUTO_RUN_TOKEN="$(${shellQuote(process.execPath)} -e ${shellQuote(handoffFieldReader('bearerToken'))} "$HANDOFF")"`,
    `export PLUTO_RUN_ACTOR="$(${shellQuote(process.execPath)} -e ${shellQuote(handoffFieldReader('actorKey'))} "$HANDOFF")"`,
    `exec ${shellQuote(input.runBinPath)} --actor "$PLUTO_RUN_ACTOR" "$@"`,
    '',
  ].join('\n');
  await fs.writeFile(wrapperPath, wrapper, 'utf8');
  await fs.chmod(wrapperPath, 0o755);

  return {
    runBinPath: input.runBinPath,
    wrapperPath,
    handoffJsonPath,
  };
}
