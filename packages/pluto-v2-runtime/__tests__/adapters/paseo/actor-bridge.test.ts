import { spawn, spawnSync } from 'node:child_process';
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import type { PromptView } from '../../../src/adapters/paseo/prompt-view.js';
import {
  materializeActorBridge,
  resolveActorBridgeDependencyPaths,
} from '../../../src/adapters/paseo/actor-bridge.js';

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

describe('actor bridge materialization', () => {
  it('writes a handoff file with the live run connection details', async () => {
    const tempDir = await mkdtemp(join(tmpdir(), 'pluto-v2-actor-bridge-'));
    const paths = await resolveActorBridgeDependencyPaths();

    try {
      const bridge = await materializeActorBridge({
        actorCwd: tempDir,
        apiUrl: 'http://127.0.0.1:9876',
        bearerToken: 'bridge-token',
        actorKey: 'role:lead',
        plutoToolSourcePath: paths.plutoToolSourcePath,
        tsxBinPath: paths.tsxBinPath,
      });

      expect(JSON.parse(await readFile(bridge.handoffJsonPath, 'utf8'))).toEqual({
        apiUrl: 'http://127.0.0.1:9876',
        bearerToken: 'bridge-token',
        actorKey: 'role:lead',
        schemaVersion: '1.0',
      });
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  it('marks the wrapper as executable', async () => {
    const tempDir = await mkdtemp(join(tmpdir(), 'pluto-v2-actor-bridge-'));
    const paths = await resolveActorBridgeDependencyPaths();

    try {
      const bridge = await materializeActorBridge({
        actorCwd: tempDir,
        apiUrl: 'http://127.0.0.1:9876',
        bearerToken: 'bridge-token',
        actorKey: 'role:lead',
        plutoToolSourcePath: paths.plutoToolSourcePath,
        tsxBinPath: paths.tsxBinPath,
      });

      const wrapperStat = await stat(bridge.wrapperPath);
      expect(wrapperStat.mode & 0o100).toBe(0o100);
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  it('invokes read-state through the wrapper from a child with no Pluto env vars', async () => {
    const tempDir = await mkdtemp(join(tmpdir(), 'pluto-v2-actor-bridge-'));
    const paths = await resolveActorBridgeDependencyPaths();
    const token = 'actor-bridge-token';
    const server = await startPromptViewServer(promptViewForLead(), {
      token,
      actor: 'role:lead',
    });

    try {
      const bridge = await materializeActorBridge({
        actorCwd: tempDir,
        apiUrl: server.url,
        bearerToken: token,
        actorKey: 'role:lead',
        plutoToolSourcePath: paths.plutoToolSourcePath,
        tsxBinPath: paths.tsxBinPath,
      });

      const result = spawnSync(bridge.wrapperPath, ['read-state'], {
        cwd: tempDir,
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
});
