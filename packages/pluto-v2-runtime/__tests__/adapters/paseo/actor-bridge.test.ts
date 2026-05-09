import { spawn, spawnSync } from 'node:child_process';
import { mkdtemp, mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { describe, expect, it, vi } from 'vitest';

import type { PromptView } from '../../../src/adapters/paseo/prompt-view.js';
import { materializeActorBridge } from '../../../src/adapters/paseo/actor-bridge.js';

type RecordedFs = {
  readonly fs: typeof import('node:fs/promises');
  readonly writes: Map<string, string>;
  readonly modes: Map<string, number>;
  readonly symlink: ReturnType<typeof vi.fn>;
};

function promptViewForLead(): PromptView {
  return {
    run: {
      runId: 'run-1',
      scenarioRef: 'scenario/actor-bridge',
      runProfileRef: 'unit-test',
    },
    userTask: 'Ship the bridge.',
    forActor: { kind: 'role', role: 'lead' },
    playbook: null,
    budgets: {
      turnIndex: 1,
      maxTurns: 10,
      parseFailuresThisTurn: 0,
      maxParseFailuresPerTurn: 0,
      kernelRejections: 0,
      maxKernelRejections: 3,
      noProgressTurns: 0,
      maxNoProgressTurns: 3,
    },
    tasks: [],
    mailbox: [],
    artifacts: [],
    activeDelegation: null,
    lastRejection: null,
  };
}

async function startPromptViewServer(promptView: PromptView, expected: {
  token: string;
  actor: string;
}): Promise<{ url: string; stop: () => Promise<void> }> {
  const serverScript = [
    'const http = require("node:http");',
    'const promptView = JSON.parse(process.env.PROMPT_VIEW_JSON);',
    'const expectedToken = process.env.EXPECTED_TOKEN;',
    'const expectedActor = process.env.EXPECTED_ACTOR;',
    'const server = http.createServer((request, response) => {',
    '  if (request.method !== "GET" || request.url !== "/state") {',
    '    response.writeHead(404, { "content-type": "application/json; charset=utf-8" });',
    '    response.end(JSON.stringify({ error: { message: "not found" } }));',
    '    return;',
    '  }',
    '  if (request.headers.authorization !== `Bearer ${expectedToken}` || request.headers["pluto-run-actor"] !== expectedActor) {',
    '    response.writeHead(401, { "content-type": "application/json; charset=utf-8" });',
    '    response.end(JSON.stringify({ error: { message: "unauthorized" } }));',
    '    return;',
    '  }',
    '  response.writeHead(200, { "content-type": "application/json; charset=utf-8" });',
    '  response.end(JSON.stringify(promptView));',
    '});',
    'server.listen(0, "127.0.0.1", () => {',
    '  const address = server.address();',
    '  process.stdout.write(JSON.stringify({ url: `http://127.0.0.1:${address.port}` }) + "\\n");',
    '});',
    'process.on("SIGTERM", () => {',
    '  server.close(() => process.exit(0));',
    '});',
  ].join(' ');

  const child = spawn(process.execPath, ['-e', serverScript], {
    env: {
      PROMPT_VIEW_JSON: JSON.stringify(promptView),
      EXPECTED_TOKEN: expected.token,
      EXPECTED_ACTOR: expected.actor,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  const url = await new Promise<string>((resolve, reject) => {
    let stdout = '';
    let stderr = '';
    const readyTimer = setTimeout(() => {
      reject(new Error(`PromptView server did not start in time. stderr: ${stderr}`));
    }, 5000);

    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk) => {
      stdout += chunk;
      const newlineIndex = stdout.indexOf('\n');
      if (newlineIndex < 0) {
        return;
      }

      clearTimeout(readyTimer);
      resolve((JSON.parse(stdout.slice(0, newlineIndex)) as { url: string }).url);
    });
    child.stderr.on('data', (chunk) => {
      stderr += chunk;
    });
    child.on('error', (error) => {
      clearTimeout(readyTimer);
      reject(error);
    });
    child.on('exit', (code) => {
      clearTimeout(readyTimer);
      reject(new Error(`PromptView server exited before readiness with code ${code}. stderr: ${stderr}`));
    });
  });

  return {
    url,
    async stop() {
      if (child.exitCode != null) {
        return;
      }

      child.kill('SIGTERM');
      await new Promise<void>((resolve) => {
        child.once('exit', () => {
          resolve();
        });
      });
    },
  };
}

function runBinPathFor(rootDir: string): string {
  return join(rootDir, '.pluto', 'runs', 'run-1', 'bin', 'pluto-tool');
}

async function createCompiledBinStub(rootDir: string): Promise<string> {
  const binPath = join(rootDir, 'runtime', 'dist', 'src', 'cli', 'pluto-tool.js');
  await mkdir(dirname(binPath), { recursive: true });
  await writeFile(binPath, '#!/usr/bin/env node\nprocess.stdout.write("stub\\n");\n', 'utf8');
  return binPath;
}

function createRecordingFs(existingPaths: readonly string[]): RecordedFs {
  const writes = new Map<string, string>();
  const modes = new Map<string, number>();
  const directories = new Set<string>();
  const knownPaths = new Set(existingPaths);
  const symlink = vi.fn(async () => undefined);

  const fs = {
    async stat(path: string) {
      if (knownPaths.has(path) || writes.has(path) || directories.has(path)) {
        return {} as Awaited<ReturnType<typeof stat>>;
      }

      const error = new Error(`ENOENT: no such file or directory, stat '${path}'`) as NodeJS.ErrnoException;
      error.code = 'ENOENT';
      throw error;
    },
    async mkdir(path: string) {
      directories.add(path);
    },
    async writeFile(path: string, data: string | Uint8Array) {
      const text = typeof data === 'string' ? data : Buffer.from(data).toString('utf8');
      writes.set(path, text);
      knownPaths.add(path);
    },
    async chmod(path: string, mode: number) {
      modes.set(path, mode);
      knownPaths.add(path);
    },
    symlink,
  } as unknown as typeof import('node:fs/promises');

  return {
    fs,
    writes,
    modes,
    symlink,
  };
}

describe('actor bridge materialization', () => {
  it('writes a handoff file with the live run connection details', async () => {
    const tempDir = await mkdtemp(join(tmpdir(), 'pluto-v2-actor-bridge-'));
    const actorDir = join(tempDir, 'lead');
    const plutoToolBinPath = await createCompiledBinStub(tempDir);

    try {
      const bridge = await materializeActorBridge({
        actorCwd: actorDir,
        runBinPath: runBinPathFor(tempDir),
        apiUrl: 'http://127.0.0.1:9876',
        bearerToken: 'bridge-token-lead',
        actorKey: 'role:lead',
        plutoToolBinPath,
      });

      expect(JSON.parse(await readFile(bridge.handoffJsonPath, 'utf8'))).toEqual({
        apiUrl: 'http://127.0.0.1:9876',
        bearerToken: 'bridge-token-lead',
        actorKey: 'role:lead',
        schemaVersion: '1.0',
      });
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  it('marks the wrapper as executable', async () => {
    const tempDir = await mkdtemp(join(tmpdir(), 'pluto-v2-actor-bridge-'));
    const actorDir = join(tempDir, 'lead');
    const plutoToolBinPath = await createCompiledBinStub(tempDir);

    try {
      const bridge = await materializeActorBridge({
        actorCwd: actorDir,
        runBinPath: runBinPathFor(tempDir),
        apiUrl: 'http://127.0.0.1:9876',
        bearerToken: 'bridge-token',
        actorKey: 'role:lead',
        plutoToolBinPath,
      });

      const wrapperStat = await stat(bridge.wrapperPath);
      expect(wrapperStat.mode & 0o100).toBe(0o100);

      const runBinStat = await stat(bridge.runBinPath);
      expect(runBinStat.mode & 0o100).toBe(0o100);
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  it('writes a node-based run-level wrapper without tsx or source-tree dependencies', async () => {
    const rootDir = '/tmp/pluto-v2-actor-bridge-fake';
    const actorDir = join(rootDir, 'actors', 'lead');
    const runBinPath = runBinPathFor(rootDir);
    const plutoToolBinPath = join(rootDir, 'runtime', 'dist', 'src', 'cli', 'pluto-tool.js');
    const fakeFs = createRecordingFs([plutoToolBinPath]);

    const bridge = await materializeActorBridge({
      actorCwd: actorDir,
      runBinPath,
      apiUrl: 'http://127.0.0.1:9876',
      bearerToken: 'bridge-token',
      actorKey: 'role:lead',
      plutoToolBinPath,
      fs: fakeFs.fs,
    });

    expect(bridge.runBinPath).toBe(runBinPath);
    expect(bridge.wrapperPath).toBe(join(actorDir, 'pluto-tool'));
    expect(fakeFs.writes.get(runBinPath)).toContain(`exec node '${plutoToolBinPath}' "$@"`);
    expect(fakeFs.writes.get(runBinPath)).toContain('export PATH=');
    expect(fakeFs.writes.get(runBinPath)).not.toContain('tsx');
    expect(fakeFs.writes.get(runBinPath)).not.toContain('pluto-tool.ts');
    expect(fakeFs.writes.get(runBinPath)).not.toContain('tsconfig.json');
    expect(fakeFs.symlink).not.toHaveBeenCalled();
  });

  it('invokes read-state through the wrapper from a child with no Pluto env vars', async () => {
    const tempDir = await mkdtemp(join(tmpdir(), 'pluto-v2-actor-bridge-'));
    const token = 'actor-bridge-token';
    const actorDir = join(tempDir, 'lead');
    const plutoToolBinPath = await createCompiledBinStub(tempDir);
    const server = await startPromptViewServer(promptViewForLead(), {
      token,
      actor: 'role:lead',
    });

    try {
      const bridge = await materializeActorBridge({
        actorCwd: actorDir,
        runBinPath: runBinPathFor(tempDir),
        apiUrl: server.url,
        bearerToken: token,
        actorKey: 'role:lead',
        plutoToolBinPath,
      });

      const result = spawnSync(bridge.wrapperPath, ['read-state'], {
        cwd: actorDir,
        env: {},
        encoding: 'utf8',
        timeout: 10000,
      });

      expect(result.error).toBeUndefined();
      expect(result.status).toBe(0);
      expect(result.stderr).toBe('');
      expect(JSON.parse(result.stdout)).toMatchObject({
        run: { runId: 'run-1' },
        forActor: { kind: 'role', role: 'lead' },
        budgets: { turnIndex: 1 },
      });
    } finally {
      await server.stop();
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  it('reuses the same run-level binary path across actors in one run', async () => {
    const tempDir = await mkdtemp(join(tmpdir(), 'pluto-v2-actor-bridge-'));
    const sharedRunBinPath = runBinPathFor(tempDir);
    const plutoToolBinPath = await createCompiledBinStub(tempDir);

    try {
      const leadBridge = await materializeActorBridge({
        actorCwd: join(tempDir, 'lead'),
        runBinPath: sharedRunBinPath,
        apiUrl: 'http://127.0.0.1:9876',
        bearerToken: 'bridge-token-lead',
        actorKey: 'role:lead',
        plutoToolBinPath,
      });
      const generatorBridge = await materializeActorBridge({
        actorCwd: join(tempDir, 'generator'),
        runBinPath: sharedRunBinPath,
        apiUrl: 'http://127.0.0.1:9876',
        bearerToken: 'bridge-token-generator',
        actorKey: 'role:generator',
        plutoToolBinPath,
      });

      expect(leadBridge.runBinPath).toBe(sharedRunBinPath);
      expect(generatorBridge.runBinPath).toBe(sharedRunBinPath);
      expect(leadBridge.runBinPath).toBe(generatorBridge.runBinPath);
      const leadHandoff = JSON.parse(await readFile(leadBridge.handoffJsonPath, 'utf8')) as { bearerToken: string; actorKey: string };
      const generatorHandoff = JSON.parse(await readFile(generatorBridge.handoffJsonPath, 'utf8')) as { bearerToken: string; actorKey: string };
      expect(leadHandoff).toMatchObject({ bearerToken: 'bridge-token-lead', actorKey: 'role:lead' });
      expect(generatorHandoff).toMatchObject({ bearerToken: 'bridge-token-generator', actorKey: 'role:generator' });
      expect(leadHandoff.bearerToken).not.toBe(generatorHandoff.bearerToken);
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });
});
