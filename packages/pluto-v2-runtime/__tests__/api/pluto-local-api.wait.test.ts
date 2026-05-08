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
  type RunEvent,
} from '@pluto/v2-core';

import type { PromptView } from '../../src/adapters/paseo/prompt-view.js';
import { startPlutoLocalApi } from '../../src/api/pluto-local-api.js';
import { makeWaitRegistry } from '../../src/api/wait-registry.js';
import { makeTurnLeaseStore } from '../../src/mcp/turn-lease.js';
import { makePlutoToolHandlers } from '../../src/tools/pluto-tool-handlers.js';

const FIXED_ISO = '2026-05-08T00:00:00.000Z';
const TOKEN = 'pluto-test-token';
const LEAD: ActorRef = { kind: 'role', role: 'lead' };
const GENERATOR: ActorRef = { kind: 'role', role: 'generator' };

function createKernel() {
  return new RunKernel({
    initialState: initialState(TeamContextSchema.parse({
      runId: 'run-1',
      scenarioRef: 'scenario/local-api-wait',
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
      policy: AUTHORITY_MATRIX,
    })),
    eventLog: new InMemoryEventLogStore(),
    idProvider: counterIdProvider(1),
    clockProvider: fixedClockProvider(FIXED_ISO),
  });
}

function sequentialRequestIds(values: readonly string[]) {
  let index = 0;
  return () => values[index++] ?? `00000000-0000-4000-8000-${String(index + 900).padStart(12, '0')}`;
}

function promptViewFor(actor: ActorRef, mailbox: PromptView['mailbox'] = []): PromptView {
  return {
    run: {
      runId: 'run-1',
      scenarioRef: 'scenario/local-api-wait',
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

async function withWaitApi(
  run: (context: {
    url: string;
    events: RunEvent[];
    registry: ReturnType<typeof makeWaitRegistry>;
    leaseStore: ReturnType<typeof makeTurnLeaseStore>;
    traces: string[];
  }) => Promise<void>,
) {
  const kernel = createKernel();
  const leaseStore = makeTurnLeaseStore(LEAD);
  const events: RunEvent[] = [];
  const traces: string[] = [];
  const cursorByActorKey = new Map<string, number>();
  const handlers = makePlutoToolHandlers({
    kernel,
    runId: 'run-1',
    schemaVersion: SCHEMA_VERSION,
    clock: () => new Date(FIXED_ISO),
    idProvider: sequentialRequestIds(['00000000-0000-4000-8000-000000000101']),
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
    onTrace: (event) => traces.push(event.kind),
  });
  const api = await startPlutoLocalApi({
    bearerToken: TOKEN,
    handlers,
    leaseStore,
    waitService: {
      registry,
      cursorForActor(actor) {
        return cursorByActorKey.get(`${actor.kind}:${actor.kind === 'role' ? actor.role : actor.kind}`) ?? -1;
      },
      onEventDelivered(actor, sequence) {
        cursorByActorKey.set(`${actor.kind}:${actor.kind === 'role' ? actor.role : actor.kind}`, sequence);
      },
    },
  });

  try {
    await run({ url: api.url, events, registry, leaseStore, traces });
  } finally {
    await api.shutdown();
  }
}

describe('pluto local api wait-for-event route', () => {
  it('returns an event payload for a parked wait', async () => {
    await withWaitApi(async ({ url, events, registry }) => {
      const pending = fetch(`${url}/tools/wait-for-event`, {
        method: 'POST',
        headers: {
          authorization: `Bearer ${TOKEN}`,
          'Pluto-Run-Actor': 'role:lead',
          'content-type': 'application/json',
        },
        body: JSON.stringify({ timeoutSec: 300 }),
      });

      const event = mailboxEvent(0);
      events.push(event);
      registry.notify(event, (actor) => promptViewFor(actor, [{ sequence: 0, from: GENERATOR, to: LEAD, kind: 'completion', body: 'done' }]));

      const response = await pending;
      expect(response.status).toBe(200);
      await expect(response.json()).resolves.toMatchObject({
        outcome: 'event',
        latestEvent: { kind: 'mailbox_message_appended', sequence: 0 },
        delta: {
          newMailbox: [{ sequence: 0, kind: 'completion', body: 'done' }],
        },
      });
    });
  });

  it('requires auth for wait-for-event', async () => {
    await withWaitApi(async ({ url }) => {
      const response = await fetch(`${url}/tools/wait-for-event`, {
        method: 'POST',
        headers: {
          authorization: 'Bearer wrong-token',
          'Pluto-Run-Actor': 'role:lead',
          'content-type': 'application/json',
        },
        body: JSON.stringify({ timeoutSec: 300 }),
      });

      expect(response.status).toBe(401);
      await expect(response.json()).resolves.toEqual({ error: 'unauthorized' });
    });
  });

  it('cancels a parked wait when the HTTP client disconnects', async () => {
    await withWaitApi(async ({ url, traces }) => {
      const controller = new AbortController();
      const pending = fetch(`${url}/tools/wait-for-event`, {
        method: 'POST',
        headers: {
          authorization: `Bearer ${TOKEN}`,
          'Pluto-Run-Actor': 'role:lead',
          'content-type': 'application/json',
        },
        body: JSON.stringify({ timeoutSec: 300 }),
        signal: controller.signal,
      });

      await vi.waitFor(() => {
        expect(traces).toContain('wait_armed');
      });

      controller.abort();
      await pending.catch(() => undefined);

      await vi.waitFor(() => {
        expect(traces).toContain('wait_cancelled');
      });
    });
  });
});
