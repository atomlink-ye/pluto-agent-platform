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
  type RunEvent,
  type ActorRef,
} from '@pluto/v2-core';

import type { PromptView } from '../../src/adapters/paseo/prompt-view.js';
import { makeWaitRegistry } from '../../src/api/wait-registry.js';
import { startPlutoLocalApi } from '../../src/api/pluto-local-api.js';
import { parseCliArgs, runCli as runCliInProcess } from '../../src/cli/pluto-tool.js';
import { makeTurnLeaseStore } from '../../src/mcp/turn-lease.js';
import { makePlutoToolHandlers } from '../../src/tools/pluto-tool-handlers.js';

const FIXED_ISO = '2026-05-08T00:00:00.000Z';
const REPO_ROOT = fileURLToPath(new URL('../../../../', import.meta.url));
const CLI_PATH = fileURLToPath(new URL('../../src/cli/pluto-tool.ts', import.meta.url));
const TOKEN_BY_ACTOR = new Map([
  ['manager', 'cli-test-token-manager'],
  ['role:lead', 'cli-test-token-lead'],
  ['role:planner', 'cli-test-token-planner'],
  ['role:generator', 'cli-test-token-generator'],
  ['role:evaluator', 'cli-test-token-evaluator'],
  ['system', 'cli-test-token-system'],
]);

function tokenForActor(actorKey = 'role:lead'): string {
  const token = TOKEN_BY_ACTOR.get(actorKey);
  if (token == null) {
    throw new Error(`Missing CLI test token for ${actorKey}`);
  }

  return token;
}

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

async function withApi(run: (context: {
  url: string;
  token: string;
  tokenForActor: (actorKey: string) => string;
}) => Promise<void>) {
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
  const token = tokenForActor('role:lead');
  const api = await startPlutoLocalApi({
    tokenByActor: TOKEN_BY_ACTOR,
    registeredActorKeys: new Set(['manager', 'role:lead', 'role:planner', 'role:generator', 'role:evaluator', 'system']),
    handlers,
    leaseStore: makeTurnLeaseStore({ kind: 'role', role: 'lead' }),
  });

  try {
    await run({ url: api.url, token, tokenForActor });
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

function actorKey(actor: ActorRef): string {
  switch (actor.kind) {
    case 'manager':
      return 'manager';
    case 'system':
      return 'system';
    case 'role':
      return `role:${actor.role}`;
  }
}

function promptViewFor(actor: ActorRef): PromptView {
  return {
    run: {
      runId: 'run-1',
      scenarioRef: 'scenario/pluto-tool-cli',
      runProfileRef: 'unit-test',
    },
    userTask: actor.kind === 'role' && actor.role === 'lead' ? 'Ship it.' : null,
    forActor: actor,
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

function createIoCapture() {
  let stdout = '';
  let stderr = '';
  return {
    io: {
      stdout: {
        write(chunk: string) {
          stdout += chunk;
          return true;
        },
      },
      stderr: {
        write(chunk: string) {
          stderr += chunk;
          return true;
        },
      },
    },
    read() {
      return { stdout, stderr };
    },
  };
}

async function withWaitApi(
  run: (context: {
    url: string;
    token: string;
    tokenForActor: (actorKey: string) => string;
    handlers: ReturnType<typeof makePlutoToolHandlers>;
    kernel: ReturnType<typeof createKernel>;
    waitRegistry: ReturnType<typeof makeWaitRegistry>;
    leaseStore: ReturnType<typeof makeTurnLeaseStore>;
  }) => Promise<void>,
) {
  const kernel = createKernel();
  const handlers = makePlutoToolHandlers({
    kernel,
    runId: 'run-1',
    schemaVersion: SCHEMA_VERSION,
    clock: () => new Date(FIXED_ISO),
    idProvider: sequentialRequestIds([
      '00000000-0000-4000-8000-000000000101',
      '00000000-0000-4000-8000-000000000102',
      '00000000-0000-4000-8000-000000000103',
      '00000000-0000-4000-8000-000000000104',
    ]),
    artifactSidecar: {
      write: vi.fn(async (artifactId: string, _body: string | Uint8Array) => `/tmp/run-1/${artifactId}.txt`),
      read: vi.fn(async (_artifactId: string) => ({ path: '/tmp/artifact.txt', body: 'artifact body' })),
    },
    transcriptSidecar: {
      read: vi.fn(async (_actorKey: string) => 'transcript text'),
    },
    promptViewer: {
      forActor: vi.fn((actor: ActorRef) => promptViewFor(actor)),
    },
  });
  const token = tokenForActor('role:lead');
  const leaseStore = makeTurnLeaseStore({ kind: 'role', role: 'lead' });
  const cursorByActorKey = new Map<string, number>();
  const waitRegistry = makeWaitRegistry({
    events: () => kernel.eventLog.read(0, kernel.eventLog.head + 1),
    getPromptViewForActor: (actor) => promptViewFor(actor),
  });
  const api = await startPlutoLocalApi({
    tokenByActor: TOKEN_BY_ACTOR,
    registeredActorKeys: new Set(['manager', 'role:lead', 'role:planner', 'role:generator', 'role:evaluator', 'system']),
    handlers,
    leaseStore,
    waitService: {
      registry: waitRegistry,
      cursorForActor(actor) {
        return cursorByActorKey.get(actorKey(actor)) ?? kernel.eventLog.head;
      },
      onEventDelivered(actor, sequence) {
        cursorByActorKey.set(actorKey(actor), sequence);
      },
    },
  });

  try {
    await run({ url: api.url, token, tokenForActor, handlers, kernel, waitRegistry, leaseStore });
  } finally {
    await api.shutdown();
  }
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
          noWait: false,
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
          noWait: false,
          body: { taskId: 'task-1', to: 'completed' },
        });

      await expect(parseCliArgs(['create-task', '--owner=generator', '--title=Draft', '--no-wait', '--wait-timeout-ms=2500']))
        .resolves.toMatchObject({
          kind: 'command',
          name: 'create-task',
          noWait: true,
          waitTimeoutMs: 2500,
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

      await expect(parseCliArgs(['worker-complete', '--task-id=task-1', '--summary=done', '--artifact=artifact-1', '--artifact=artifact-2']))
        .resolves.toMatchObject({
          kind: 'command',
          name: 'worker-complete',
          path: '/v2/composite/worker-complete',
          noWait: false,
          body: {
            taskId: 'task-1',
            summary: 'done',
            artifacts: ['artifact-1', 'artifact-2'],
          },
        });

      await expect(parseCliArgs(['evaluator-verdict', '--task-id=task-1', '--verdict=needs-revision', '--summary=fix it']))
        .resolves.toMatchObject({
          kind: 'command',
          name: 'evaluator-verdict',
          path: '/v2/composite/evaluator-verdict',
          noWait: false,
          body: {
            taskId: 'task-1',
            verdict: 'needs-revision',
            summary: 'fix it',
          },
        });

      await expect(parseCliArgs(['final-reconciliation', '--completed-tasks=task-1,task-2', '--cited-messages=message-1,message-2', '--summary=done']))
        .resolves.toMatchObject({
          kind: 'command',
          name: 'final-reconciliation',
          path: '/v2/composite/final-reconciliation',
          body: {
            completedTasks: ['task-1', 'task-2'],
            citedMessages: ['message-1', 'message-2'],
            summary: 'done',
          },
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
        ['--actor', 'role:lead', 'create-task', '--owner=generator', '--title=Draft haiku v1', '--no-wait'],
        {
          PLUTO_RUN_API_URL: url,
          PLUTO_RUN_TOKEN: token,
        },
      );

      expect(result.exitCode).toBe(0);
      expect(result.stderr).toBe('');
      expect(JSON.parse(result.stdout)).toMatchObject({
        accepted: true,
        taskId: expect.any(String),
        turnDisposition: 'waiting',
        nextWakeup: 'event',
      });
    });
  });

  it('auto-waits after a successful mutating command by default and returns merged JSON', async () => {
    await withWaitApi(async ({ url, token, handlers, kernel, waitRegistry }) => {
      const capture = createIoCapture();
      const releaseLead = new Promise<void>((resolve) => {
        setTimeout(async () => {
        await handlers.pluto_append_mailbox_message({ currentActor: { kind: 'role', role: 'generator' }, isLead: false }, {
          toActor: { kind: 'role', role: 'lead' },
          kind: 'completion',
          body: 'done',
        });
        const event = kernel.eventLog.read(0, kernel.eventLog.head + 1).at(-1) as RunEvent;
        waitRegistry.notify(event, (actor) => promptViewFor(actor));
          resolve();
        }, 20);
      });

      const exitCode = await runCliInProcess(
        ['--actor', 'role:lead', 'create-task', '--owner=generator', '--title=Draft haiku v1'],
        {
          PLUTO_RUN_API_URL: url,
          PLUTO_RUN_TOKEN: token,
        },
        capture.io as unknown as Pick<typeof process, 'stdout' | 'stderr'>,
      );

      await releaseLead;

      const { stdout, stderr } = capture.read();
      expect(exitCode).toBe(0);
      expect(stderr).toBe('');
      expect(JSON.parse(stdout)).toMatchObject({
        mutation: {
          accepted: true,
          taskId: expect.any(String),
          turnDisposition: 'waiting',
          nextWakeup: 'event',
        },
        wait: {
          outcome: expect.stringMatching(/event|cancelled/),
        },
      });
    });
  });

  it('returns only the mutation payload when --no-wait is passed', async () => {
    await withApi(async ({ url, token }) => {
      const capture = createIoCapture();
      const exitCode = await runCliInProcess(
        ['--actor', 'role:lead', 'create-task', '--owner=generator', '--title=Draft haiku v1', '--no-wait'],
        {
          PLUTO_RUN_API_URL: url,
          PLUTO_RUN_TOKEN: token,
        },
        capture.io as unknown as Pick<typeof process, 'stdout' | 'stderr'>,
      );

      const { stdout, stderr } = capture.read();
      expect(exitCode).toBe(0);
      expect(stderr).toBe('');
      expect(JSON.parse(stdout)).toMatchObject({
        accepted: true,
        taskId: expect.any(String),
        turnDisposition: 'waiting',
        nextWakeup: 'event',
      });
      expect(stdout).not.toContain('"wait"');
    });
  });

  it('does not auto-wait for complete-run and returns terminal disposition', async () => {
    await withApi(async ({ url, token }) => {
      const capture = createIoCapture();
      const exitCode = await runCliInProcess(
        ['--actor', 'role:lead', 'complete-run', '--status=succeeded', '--summary=done'],
        {
          PLUTO_RUN_API_URL: url,
          PLUTO_RUN_TOKEN: token,
        },
        capture.io as unknown as Pick<typeof process, 'stdout' | 'stderr'>,
      );

      const { stdout, stderr } = capture.read();
      expect(exitCode).toBe(0);
      expect(stderr).toBe('');
      expect(JSON.parse(stdout)).toMatchObject({
        accepted: true,
        turnDisposition: 'terminal',
      });
      expect(stdout).not.toContain('"wait"');
    });
  });

  it('auto-waits for worker-complete by default and returns merged JSON', async () => {
    await withWaitApi(async ({ url, tokenForActor, handlers, kernel, waitRegistry, leaseStore }) => {
      const created = await handlers.pluto_create_task({ currentActor: { kind: 'role', role: 'lead' }, isLead: true }, {
        title: 'Implement',
        ownerActor: { kind: 'role', role: 'generator' },
        dependsOn: [],
      });
      if (!created.ok) {
        throw new Error('Expected task creation to succeed');
      }

      const taskId = JSON.parse((created.data as { content: Array<{ text: string }> }).content.at(0)?.text ?? '{}').taskId as string;
      leaseStore.setCurrent({ kind: 'role', role: 'generator' });
      const capture = createIoCapture();
      const releaseGenerator = new Promise<void>((resolve) => {
        setTimeout(async () => {
          await handlers.pluto_append_mailbox_message({ currentActor: { kind: 'role', role: 'lead' }, isLead: true }, {
            toActor: { kind: 'role', role: 'generator' },
            kind: 'task',
            body: 'next task',
          });
          const event = kernel.eventLog.read(0, kernel.eventLog.head + 1).at(-1) as RunEvent;
          waitRegistry.notify(event, (actor) => promptViewFor(actor));
          resolve();
        }, 20);
      });

      const exitCode = await runCliInProcess(
        ['--actor', 'role:generator', 'worker-complete', `--task-id=${taskId}`, '--summary=done'],
        {
          PLUTO_RUN_API_URL: url,
          PLUTO_RUN_TOKEN: tokenForActor('role:generator'),
        },
        capture.io as unknown as Pick<typeof process, 'stdout' | 'stderr'>,
      );

      await releaseGenerator;

      const { stdout, stderr } = capture.read();
      expect(exitCode).toBe(0);
      expect(stderr).toBe('');
      expect(JSON.parse(stdout)).toMatchObject({
        mutation: {
          accepted: true,
          composite: 'worker-complete',
          turnDisposition: 'waiting',
          nextWakeup: 'event',
        },
        wait: {
          outcome: expect.stringMatching(/event|cancelled/),
        },
      });
    });
  });

  it('does not auto-wait for final-reconciliation and returns terminal disposition', async () => {
    await withApi(async ({ url, token }) => {
      const capture = createIoCapture();
      const exitCode = await runCliInProcess(
        [
          '--actor',
          'role:lead',
          'final-reconciliation',
          '--completed-tasks=task-1,task-2',
          '--cited-messages=message-1,message-2',
          '--summary=done',
        ],
        {
          PLUTO_RUN_API_URL: url,
          PLUTO_RUN_TOKEN: token,
        },
        capture.io as unknown as Pick<typeof process, 'stdout' | 'stderr'>,
      );

      const { stdout, stderr } = capture.read();
      expect(exitCode).toBe(0);
      expect(stderr).toBe('');
      expect(JSON.parse(stdout)).toMatchObject({
        accepted: true,
        composite: 'final-reconciliation',
        turnDisposition: 'terminal',
      });
      expect(stdout).not.toContain('"wait"');
    });
  });

  it('returns promptly for rejected mutations without entering auto-wait', async () => {
    await withWaitApi(async ({ url, tokenForActor, leaseStore }) => {
      leaseStore.setCurrent({ kind: 'role', role: 'generator' });
      const capture = createIoCapture();
      const startedAt = Date.now();

      const exitCode = await runCliInProcess(
        ['--actor', 'role:generator', 'create-task', '--owner=generator', '--title=Rejected draft', '--wait-timeout-ms=2000'],
        {
          PLUTO_RUN_API_URL: url,
          PLUTO_RUN_TOKEN: tokenForActor('role:generator'),
        },
        capture.io as unknown as Pick<typeof process, 'stdout' | 'stderr'>,
      );

      const elapsedMs = Date.now() - startedAt;
      const { stdout, stderr } = capture.read();
      expect(exitCode).toBe(0);
      expect(stderr).toBe('');
      expect(elapsedMs).toBeLessThan(1000);
      expect(JSON.parse(stdout)).toMatchObject({
        accepted: false,
        reason: 'actor_not_authorized',
      });
      expect(stdout).not.toContain('"wait"');
      expect(stdout).not.toContain('turnDisposition');
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
