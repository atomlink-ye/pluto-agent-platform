import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import { describe, expect, it, vi } from 'vitest';

import {
  CANONICAL_AUTHORITY_POLICY,
  InMemoryEventLogStore,
  RunKernel,
  SCHEMA_VERSION,
  TeamContextSchema,
  counterIdProvider,
  fixedClockProvider,
  initialState,
  type ActorRef,
  type RunEvent,
} from '@pluto/v2-core';

import type { PromptView } from '../../src/adapters/paseo/prompt-view.js';
import { startPlutoLocalApi } from '../../src/api/pluto-local-api.js';
import { makeWaitRegistry } from '../../src/api/wait-registry.js';
import { makeTurnLeaseStore } from '../../src/mcp/turn-lease.js';
import { makePlutoToolHandlers } from '../../src/tools/pluto-tool-handlers.js';

const FIXED_ISO = '2026-05-08T00:00:00.000Z';
const REPO_ROOT = fileURLToPath(new URL('../../../../', import.meta.url));
const CLI_PATH = fileURLToPath(new URL('../../src/cli/pluto-tool.ts', import.meta.url));
const TOKEN_BY_ACTOR = new Map([
  ['role:lead', 'cli-wait-token-lead'],
  ['role:generator', 'cli-wait-token-generator'],
]);
const LEAD: ActorRef = { kind: 'role', role: 'lead' };
const GENERATOR: ActorRef = { kind: 'role', role: 'generator' };

function tokenForActor(actorKey: 'role:lead' | 'role:generator'): string {
  const token = TOKEN_BY_ACTOR.get(actorKey);
  if (token == null) {
    throw new Error(`Missing CLI wait token for ${actorKey}`);
  }

  return token;
}

function createKernel() {
  return new RunKernel({
    initialState: initialState(TeamContextSchema.parse({
      runId: 'run-1',
      scenarioRef: 'scenario/pluto-tool-wait',
      runProfileRef: 'unit-test',
      declaredActors: [
        { kind: 'manager' },
        LEAD,
        { kind: 'role', role: 'planner' },
        GENERATOR,
        { kind: 'role', role: 'evaluator' },
        { kind: 'system' },
      ],
      initialTasks: [],
      policy: CANONICAL_AUTHORITY_POLICY,
    })),
    eventLog: new InMemoryEventLogStore(),
    idProvider: counterIdProvider(1),
    clockProvider: fixedClockProvider(FIXED_ISO),
  });
}

function promptViewFor(actor: ActorRef, mailbox: PromptView['mailbox'] = []): PromptView {
  return {
    run: {
      runId: 'run-1',
      scenarioRef: 'scenario/pluto-tool-wait',
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
    mailbox,
    artifacts: [],
    activeDelegation: null,
    lastRejection: null,
  };
}

function mailboxEvent(sequence: number): RunEvent {
  return {
    eventId: `00000000-0000-4000-8000-${String(sequence + 1).padStart(12, '0')}`,
    requestId: `00000000-0000-4000-8000-${String(sequence + 101).padStart(12, '0')}`,
    runId: 'run-1',
    actor: GENERATOR,
    timestamp: `2026-05-08T00:00:${String(sequence).padStart(2, '0')}.000Z`,
    sequence,
    schemaVersion: SCHEMA_VERSION,
    kind: 'mailbox_message_appended',
    outcome: 'accepted',
    payload: {
      messageId: `message-${sequence}`,
      fromActor: GENERATOR,
      toActor: LEAD,
      kind: 'completion',
      body: 'done',
    },
  } as unknown as RunEvent;
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
      resolve({ exitCode: exitCode ?? 0, stdout, stderr });
    });
  });
}

async function withWaitApi(run: (context: {
  url: string;
  token: string;
  registry: ReturnType<typeof makeWaitRegistry>;
  events: RunEvent[];
}) => Promise<void>) {
  const events: RunEvent[] = [];
  const leadToken = tokenForActor('role:lead');
  const handlers = makePlutoToolHandlers({
    kernel: createKernel(),
    runId: 'run-1',
    schemaVersion: SCHEMA_VERSION,
    clock: () => new Date(FIXED_ISO),
    idProvider: () => '00000000-0000-4000-8000-000000000101',
    artifactSidecar: {
      write: vi.fn(async (artifactId: string) => `/tmp/${artifactId}.txt`),
      read: vi.fn(async () => ({ path: '/tmp/artifact.txt', body: 'artifact body' })),
    },
    transcriptSidecar: {
      read: vi.fn(async () => 'transcript text'),
    },
    promptViewer: {
      forActor: vi.fn((actor: ActorRef) => promptViewFor(actor)),
    },
  });
  const registry = makeWaitRegistry({
    events: () => events,
    getPromptViewForActor: (actor) => promptViewFor(actor, [{ sequence: 0, from: GENERATOR, to: LEAD, kind: 'completion', body: 'done' }]),
  });
  const cursorByActorKey = new Map<string, number>();
  const api = await startPlutoLocalApi({
    tokenByActor: TOKEN_BY_ACTOR,
    handlers,
    leaseStore: makeTurnLeaseStore(LEAD),
    waitService: {
      registry,
      cursorForActor(actor) {
        return cursorByActorKey.get(actor.kind === 'role' ? `role:${actor.role}` : actor.kind) ?? -1;
      },
      onEventDelivered(actor, sequence) {
        cursorByActorKey.set(actor.kind === 'role' ? `role:${actor.role}` : actor.kind, sequence);
      },
    },
  });

  try {
    await run({ url: api.url, token: leadToken, registry, events });
  } finally {
    await api.shutdown();
  }
}

describe('pluto-tool wait', () => {
  it('returns the wait event payload from a real subprocess', async () => {
    await withWaitApi(async ({ url, token, registry, events }) => {
      const pending = runCli(['wait'], {
        PLUTO_RUN_API_URL: url,
        PLUTO_RUN_TOKEN: token,
        PLUTO_RUN_ACTOR: 'role:lead',
      });

      const event = mailboxEvent(0);
      events.push(event);
      registry.notify(event, (actor) => promptViewFor(actor, [{ sequence: 0, from: GENERATOR, to: LEAD, kind: 'completion', body: 'done' }]));

      const result = await pending;
      expect(result.exitCode).toBe(0);
      expect(result.stderr).toBe('');
      expect(JSON.parse(result.stdout)).toMatchObject({
        outcome: 'event',
        latestEvent: { kind: 'mailbox_message_appended', sequence: 0 },
      });
    });
  });

  it('honors the timeout flag', async () => {
    await withWaitApi(async ({ url, token }) => {
      const result = await runCli(['wait', '--timeout-sec=0'], {
        PLUTO_RUN_API_URL: url,
        PLUTO_RUN_TOKEN: token,
        PLUTO_RUN_ACTOR: 'role:lead',
      });

      expect(result.exitCode).toBe(0);
      expect(result.stderr).toBe('');
      expect(JSON.parse(result.stdout)).toEqual({ outcome: 'timeout' });
    });
  });
});
