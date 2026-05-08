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
import { makeWaitRegistry } from '../../src/api/wait-registry.js';
import { startPlutoMcpServer } from '../../src/mcp/pluto-mcp-server.js';
import { makeTurnLeaseStore } from '../../src/mcp/turn-lease.js';
import { makePlutoToolHandlers } from '../../src/tools/pluto-tool-handlers.js';

const FIXED_ISO = '2026-05-08T00:00:00.000Z';
const TOKEN = 'pluto-mcp-wait-token';
const PROTOCOL_VERSION = '2025-11-25';
const LEAD: ActorRef = { kind: 'role', role: 'lead' };
const GENERATOR: ActorRef = { kind: 'role', role: 'generator' };

function createKernel() {
  return new RunKernel({
    initialState: initialState(TeamContextSchema.parse({
      runId: 'run-1',
      scenarioRef: 'scenario/mcp-wait',
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

function promptViewFor(actor: ActorRef, mailbox: PromptView['mailbox'] = []): PromptView {
  return {
    run: {
      runId: 'run-1',
      scenarioRef: 'scenario/mcp-wait',
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

async function withWaitServer(run: (context: {
  url: string;
  registry: ReturnType<typeof makeWaitRegistry>;
  events: RunEvent[];
}) => Promise<void>) {
  const events: RunEvent[] = [];
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
  const server = await startPlutoMcpServer({
    bearerToken: TOKEN,
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
    await run({ url: server.url, registry, events });
  } finally {
    await server.shutdown();
  }
}

describe('pluto mcp server wait tool', () => {
  it('lists and serves pluto_wait_for_event', async () => {
    await withWaitServer(async ({ url, registry, events }) => {
      const listResponse = await fetch(url, {
        method: 'POST',
        headers: {
          authorization: `Bearer ${TOKEN}`,
          'content-type': 'application/json',
          'mcp-protocol-version': PROTOCOL_VERSION,
        },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }),
      });
      const listJson = await listResponse.json() as { result: { tools: Array<{ name: string }> } };
      expect(listJson.result.tools.map((tool) => tool.name)).toContain('pluto_wait_for_event');

      const pending = fetch(url, {
        method: 'POST',
        headers: {
          authorization: `Bearer ${TOKEN}`,
          'content-type': 'application/json',
          'mcp-protocol-version': PROTOCOL_VERSION,
          'Pluto-Run-Actor': JSON.stringify(LEAD),
        },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 2,
          method: 'tools/call',
          params: {
            name: 'pluto_wait_for_event',
            arguments: { timeoutSec: 300 },
          },
        }),
      });

      const event = mailboxEvent(0);
      events.push(event);
      registry.notify(event, (actor) => promptViewFor(actor, [{ sequence: 0, from: GENERATOR, to: LEAD, kind: 'completion', body: 'done' }]));

      const response = await pending;
      const json = await response.json() as { result: { content: Array<{ text: string }> } };
      expect(JSON.parse(json.result.content[0]?.text ?? 'null')).toMatchObject({
        outcome: 'event',
        latestEvent: { kind: 'mailbox_message_appended', sequence: 0 },
      });
    });
  });
});
