import { spawn } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it, vi } from 'vitest';

import {
  AUTHORITY_MATRIX,
  InMemoryEventLogStore,
  RunKernel,
  SCHEMA_VERSION,
  TeamContextSchema,
  counterIdProvider,
  fixedClockProvider,
  initialState,
  type ActorRef,
} from '@pluto/v2-core';

import { startPlutoLocalApi } from '../../src/api/pluto-local-api.js';
import { parseCliArgs } from '../../src/cli/pluto-tool.js';
import { makeTurnLeaseStore } from '../../src/mcp/turn-lease.js';
import { makePlutoToolHandlers } from '../../src/tools/pluto-tool-handlers.js';

const FIXED_ISO = '2026-05-08T00:00:00.000Z';
const REPO_ROOT = fileURLToPath(new URL('../../../../', import.meta.url));
const CLI_PATH = fileURLToPath(new URL('../../src/cli/pluto-tool.ts', import.meta.url));

function createKernel() {
  return new RunKernel({
    initialState: initialState(TeamContextSchema.parse({
      runId: 'run-1',
      scenarioRef: 'scenario/pluto-tool-cli',
      runProfileRef: 'unit-test',
      declaredActors: [
        { kind: 'manager' },
        { kind: 'role', role: 'lead' },
        { kind: 'role', role: 'planner' },
        { kind: 'role', role: 'generator' },
        { kind: 'role', role: 'evaluator' },
        { kind: 'system' },
      ],
      initialTasks: [],
      policy: AUTHORITY_MATRIX,
    })),
    eventLog: new InMemoryEventLogStore(),
    idProvider: counterIdProvider(1),
    clockProvider: fixedClockProvider(FIXED_ISO),
  });
}

function sequentialRequestIds(values: readonly string[]) {
  let index = 0;

  return () => {
    const value = values[index];
    if (value == null) {
      throw new Error(`Missing request id at index ${index}`);
    }

    index += 1;
    return value;
  };
}

async function withApi(run: (context: { url: string; token: string }) => Promise<void>) {
  const handlers = makePlutoToolHandlers({
    kernel: createKernel(),
    runId: 'run-1',
    schemaVersion: SCHEMA_VERSION,
    clock: () => new Date(FIXED_ISO),
    idProvider: sequentialRequestIds([
      '00000000-0000-4000-8000-000000000101',
      '00000000-0000-4000-8000-000000000102',
      '00000000-0000-4000-8000-000000000103',
    ]),
    artifactSidecar: {
      write: vi.fn(async (artifactId: string, _body: string | Uint8Array) => `/tmp/run-1/${artifactId}.txt`),
      read: vi.fn(async (_artifactId: string) => ({ path: '/tmp/artifact.txt', body: 'artifact body' })),
    },
    transcriptSidecar: {
      read: vi.fn(async (_actorKey: string) => 'transcript text'),
    },
    promptViewer: {
      forActor: vi.fn((actor: ActorRef) => ({ run: { runId: 'run-1' }, forActor: actor })),
    },
  });
  const token = 'cli-test-token';
  const api = await startPlutoLocalApi({
    bearerToken: token,
    registeredActorKeys: new Set(['manager', 'role:lead', 'role:planner', 'role:generator', 'role:evaluator', 'system']),
    handlers,
    leaseStore: makeTurnLeaseStore({ kind: 'role', role: 'lead' }),
  });

  try {
    await run({ url: api.url, token });
  } finally {
    await api.shutdown();
  }
}

async function runCli(args: readonly string[], env: NodeJS.ProcessEnv) {
  return await new Promise<{ exitCode: number; stdout: string; stderr: string }>((resolve, reject) => {
    const child = spawn('pnpm', ['exec', 'tsx', CLI_PATH, ...args], {
      cwd: REPO_ROOT,
      env: {
        ...process.env,
        ...env,
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk) => {
      stdout += chunk;
    });
    child.stderr.on('data', (chunk) => {
      stderr += chunk;
    });
    child.on('error', reject);
    child.on('close', (exitCode) => {
      resolve({
        exitCode: exitCode ?? 0,
        stdout,
        stderr,
      });
    });
  });
}

describe('pluto-tool argv parsing', () => {
  it('parses each subcommand into the expected REST request', async () => {
    const tempDir = await mkdtemp(join(tmpdir(), 'pluto-tool-cli-'));
    const bodyPath = join(tempDir, 'mailbox.txt');

    try {
      await writeFile(bodyPath, 'body from file', 'utf8');

      await expect(parseCliArgs(['--actor', 'role:lead', 'create-task', '--owner=generator', '--title=Draft']))
        .resolves.toMatchObject({
          kind: 'command',
          name: 'create-task',
          actor: 'role:lead',
          requiresActor: true,
        });

      await expect(parseCliArgs(['create-task', '--owner=generator', '--title=Draft', '--depends-on=a', '--depends-on=b']))
        .resolves.toMatchObject({
          kind: 'command',
          name: 'create-task',
          method: 'POST',
          path: '/tools/create-task',
          body: {
            title: 'Draft',
            ownerActor: { kind: 'role', role: 'generator' },
            dependsOn: ['a', 'b'],
          },
        });

      await expect(parseCliArgs(['change-task-state', '--task-id=task-1', '--to=completed']))
        .resolves.toMatchObject({
          kind: 'command',
          name: 'change-task-state',
          path: '/tools/change-task-state',
          body: { taskId: 'task-1', to: 'completed' },
        });

      await expect(parseCliArgs(['send-mailbox', '--to=lead', '--kind=completion', `--body=@${bodyPath}`]))
        .resolves.toMatchObject({
          kind: 'command',
          name: 'send-mailbox',
          path: '/tools/append-mailbox-message',
          body: {
            toActor: { kind: 'role', role: 'lead' },
            kind: 'completion',
            body: 'body from file',
          },
        });

      await expect(parseCliArgs(['publish-artifact', '--kind=final', '--media-type=text/plain', '--byte-size=12', '--body=hello']))
        .resolves.toMatchObject({
          kind: 'command',
          name: 'publish-artifact',
          path: '/tools/publish-artifact',
          body: {
            kind: 'final',
            mediaType: 'text/plain',
            byteSize: 12,
            body: 'hello',
          },
        });

      await expect(parseCliArgs(['complete-run', '--status=succeeded', '--summary=done']))
        .resolves.toMatchObject({
          kind: 'command',
          name: 'complete-run',
          path: '/tools/complete-run',
          body: { status: 'succeeded', summary: 'done' },
        });

      await expect(parseCliArgs(['wait', '--timeout-sec=12']))
        .resolves.toMatchObject({
          kind: 'command',
          name: 'wait',
          path: '/tools/wait-for-event',
          body: { timeoutSec: 12 },
        });

      await expect(parseCliArgs(['read-state']))
        .resolves.toMatchObject({ kind: 'command', name: 'read-state', method: 'GET', path: '/state' });

      await expect(parseCliArgs(['read-artifact', '--artifact-id=artifact-1']))
        .resolves.toMatchObject({ kind: 'command', name: 'read-artifact', path: '/artifacts/artifact-1' });

      await expect(parseCliArgs(['read-transcript', '--actor-key=role:generator']))
        .resolves.toMatchObject({ kind: 'command', name: 'read-transcript', path: '/transcripts/role%3Agenerator' });
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });
});

describe('pluto-tool subprocess', () => {
  it('returns API JSON responses from a real subprocess', async () => {
    await withApi(async ({ url, token }) => {
      const result = await runCli(
        ['--actor', 'role:lead', 'create-task', '--owner=generator', '--title=Draft haiku v1'],
        {
          PLUTO_RUN_API_URL: url,
          PLUTO_RUN_TOKEN: token,
        },
      );

      expect(result.exitCode).toBe(0);
      expect(result.stderr).toBe('');
      expect(JSON.parse(result.stdout)).toMatchObject({
        actor: 'role:lead',
        accepted: true,
        taskId: expect.any(String),
      });
    });
  });

  it('fails with a clear error when actor is missing for a mutating command', async () => {
    await withApi(async ({ url, token }) => {
      const result = await runCli(['create-task', '--owner=generator', '--title=Draft haiku v1'], {
        PLUTO_RUN_API_URL: url,
        PLUTO_RUN_TOKEN: token,
      });

      expect(result.exitCode).toBe(1);
      expect(result.stderr).toContain('missing_actor: pass --actor <key> or set PLUTO_RUN_ACTOR');
    });
  });

  it('fails with a clear error when the runtime env vars are missing', async () => {
    const result = await runCli(['read-state'], {
      PLUTO_RUN_TOKEN: 'token',
      PLUTO_RUN_ACTOR: 'role:lead',
    });

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain('Missing PLUTO_RUN_API_URL');
    expect(result.stderr).toContain('Pluto runtime sessions are expected to set PLUTO_RUN_API_URL, PLUTO_RUN_TOKEN, and PLUTO_RUN_ACTOR automatically.');
  });
});
