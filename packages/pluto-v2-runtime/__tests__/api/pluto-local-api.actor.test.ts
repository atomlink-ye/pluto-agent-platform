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
} from '@pluto/v2-core';

import { startPlutoLocalApi } from '../../src/api/pluto-local-api.js';
import { makeTurnLeaseStore } from '../../src/mcp/turn-lease.js';
import { makePlutoToolHandlers } from '../../src/tools/pluto-tool-handlers.js';

const FIXED_ISO = '2026-05-08T00:00:00.000Z';
const TOKEN = 'pluto-test-token';

function createKernel() {
  return new RunKernel({
    initialState: initialState(TeamContextSchema.parse({
      runId: 'run-1',
      scenarioRef: 'scenario/local-api-actor',
      runProfileRef: 'unit-test',
      declaredActors: [
        { kind: 'manager' },
        { kind: 'role', role: 'lead' },
        { kind: 'role', role: 'generator' },
      ],
      initialTasks: [],
      policy: AUTHORITY_MATRIX,
    })),
    eventLog: new InMemoryEventLogStore(),
    idProvider: counterIdProvider(1),
    clockProvider: fixedClockProvider(FIXED_ISO),
  });
}

function createHandlers() {
  return makePlutoToolHandlers({
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
      forActor: vi.fn(() => ({ run: { runId: 'run-1' }, tasks: [] })),
    },
  });
}

async function requestApi(args: {
  url: string;
  actor?: string;
}) {
  const response = await fetch(`${args.url}/tools/create-task`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${TOKEN}`,
      ...(args.actor == null ? {} : { 'Pluto-Run-Actor': args.actor }),
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      title: 'Draft the change',
      ownerActor: { kind: 'role', role: 'generator' },
      dependsOn: [],
    }),
  });

  return {
    status: response.status,
    body: await response.json(),
  };
}

describe('pluto local api actor header enforcement', () => {
  it('returns missing_actor_header when a mutating request omits Pluto-Run-Actor', async () => {
    const api = await startPlutoLocalApi({
      bearerToken: TOKEN,
      registeredActorKeys: new Set(['role:lead']),
      handlers: createHandlers(),
      leaseStore: makeTurnLeaseStore({ kind: 'role', role: 'lead' }),
    });

    try {
      const response = await requestApi({ url: api.url });
      expect(response.status).toBe(400);
      expect(response.body).toMatchObject({
        error: {
          code: 'missing_actor_header',
        },
      });
    } finally {
      await api.shutdown();
    }
  });

  it('returns unknown_actor when a mutating request claims an unregistered actor', async () => {
    const api = await startPlutoLocalApi({
      bearerToken: TOKEN,
      registeredActorKeys: new Set(['role:lead']),
      handlers: createHandlers(),
      leaseStore: makeTurnLeaseStore({ kind: 'role', role: 'lead' }),
    });

    try {
      const response = await requestApi({ url: api.url, actor: 'role:generator' });
      expect(response.status).toBe(403);
      expect(response.body).toEqual({
        error: {
          code: 'unknown_actor',
          detail: 'actor role:generator not registered for this run',
        },
      });
    } finally {
      await api.shutdown();
    }
  });

  it('accepts a mutating request when the actor header is registered', async () => {
    const api = await startPlutoLocalApi({
      bearerToken: TOKEN,
      registeredActorKeys: new Set(['role:lead']),
      handlers: createHandlers(),
      leaseStore: makeTurnLeaseStore({ kind: 'role', role: 'lead' }),
    });

    try {
      const response = await requestApi({ url: api.url, actor: 'role:lead' });
      expect(response.status).toBe(200);
      expect(response.body).toMatchObject({
        accepted: true,
        taskId: expect.any(String),
        turnDisposition: 'waiting',
        nextWakeup: 'event',
      });
    } finally {
      await api.shutdown();
    }
  });
});
