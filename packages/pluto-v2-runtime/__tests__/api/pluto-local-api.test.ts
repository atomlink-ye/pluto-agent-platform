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
  type RunKernel as RunKernelType,
} from '@pluto/v2-core';

import { startPlutoLocalApi } from '../../src/api/pluto-local-api.js';
import { makeTurnLeaseStore } from '../../src/mcp/turn-lease.js';
import { makePlutoToolHandlers } from '../../src/tools/pluto-tool-handlers.js';

const FIXED_ISO = '2026-05-08T00:00:00.000Z';
const TOKEN = 'pluto-test-token';

const leadActor = (): ActorRef => ({ kind: 'role', role: 'lead' });
const generatorActor = (): ActorRef => ({ kind: 'role', role: 'generator' });

const uuid = (suffix: string) => `00000000-0000-4000-8000-${suffix.padStart(12, '0')}`;

function createKernel() {
  return new RunKernel({
    initialState: initialState(TeamContextSchema.parse({
      runId: 'run-1',
      scenarioRef: 'scenario/local-api',
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

function createHandlerDeps(options?: {
  kernel?: RunKernelType;
  promptView?: unknown;
  transcriptText?: string;
}) {
  const kernel = options?.kernel ?? createKernel();
  const artifactSidecar = {
    write: vi.fn(async (artifactId: string, _body: string | Uint8Array) => `/tmp/run-1/${artifactId}.txt`),
    read: vi.fn(async (_artifactId: string) => ({ path: '/tmp/artifact.txt', body: 'artifact body' })),
  };
  const transcriptSidecar = {
    read: vi.fn(async (_actorKey: string) => options?.transcriptText ?? 'transcript text'),
  };
  const promptViewer = {
    forActor: vi.fn((_actor: ActorRef) => options?.promptView ?? { run: { runId: 'run-1' }, tasks: [] }),
  };

  return {
    kernel,
    promptViewer,
    handlers: makePlutoToolHandlers({
      kernel,
      runId: 'run-1',
      schemaVersion: SCHEMA_VERSION,
      clock: () => new Date(FIXED_ISO),
      idProvider: sequentialRequestIds([
        uuid('101'),
        uuid('102'),
        uuid('103'),
        uuid('104'),
        uuid('105'),
        uuid('106'),
        uuid('107'),
        uuid('108'),
      ]),
      artifactSidecar,
      transcriptSidecar,
      promptViewer,
    }),
  };
}

async function requestApi(args: {
  url: string;
  method: 'GET' | 'POST';
  path: string;
  body?: unknown;
  token?: string;
  actor?: string;
}) {
  const response = await fetch(`${args.url}${args.path}`, {
    method: args.method,
    headers: {
      authorization: `Bearer ${args.token ?? TOKEN}`,
      ...(args.actor == null ? {} : { 'Pluto-Run-Actor': args.actor }),
      ...(args.body === undefined ? {} : { 'content-type': 'application/json' }),
    },
    ...(args.body === undefined ? {} : { body: JSON.stringify(args.body) }),
  });
  const text = await response.text();
  const contentType = response.headers.get('content-type') ?? '';

  return {
    status: response.status,
    text,
    body: contentType.includes('application/json') && text.length > 0 ? JSON.parse(text) : text,
  };
}

async function withApi(
  options: {
    promptView?: unknown;
    transcriptText?: string;
  },
  run: (context: {
    url: string;
    kernel: RunKernelType;
    promptViewer: { forActor: ReturnType<typeof vi.fn> };
    leaseStore: ReturnType<typeof makeTurnLeaseStore>;
  }) => Promise<void>,
) {
  const { kernel, promptViewer, handlers } = createHandlerDeps(options);
  const leaseStore = makeTurnLeaseStore(leadActor());
  const api = await startPlutoLocalApi({
    bearerToken: TOKEN,
    handlers,
    leaseStore,
  });

  try {
    await run({ url: api.url, kernel, promptViewer, leaseStore });
  } finally {
    await api.shutdown();
  }
}

describe('startPlutoLocalApi', () => {
  it('starts on localhost, returns a URL, and binds a random port', async () => {
    await withApi({}, async ({ url }) => {
      expect(url).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/v1$/);
    });
  });

  it('smokes every route end-to-end and preserves auth plus lease semantics', async () => {
    const promptView = { run: { runId: 'run-1' }, tasks: [{ id: 'task-1' }] };

    await withApi({ promptView, transcriptText: 'lead transcript text' }, async ({ url, kernel, promptViewer, leaseStore }) => {
      const createTask = await requestApi({
        url,
        method: 'POST',
        path: '/tools/create-task',
        actor: 'role:lead',
        body: {
          title: 'Draft the change',
          ownerActor: { kind: 'role', role: 'generator' },
          dependsOn: [],
        },
      });
      expect(createTask.status).toBe(200);
      expect(createTask.body).toMatchObject({
        accepted: true,
        eventId: uuid('1'),
        sequence: 0,
        taskId: uuid('2'),
      });
      const taskId = (createTask.body as { taskId: string }).taskId;

      const secondCreateTask = await requestApi({
        url,
        method: 'POST',
        path: '/tools/create-task',
        actor: 'role:lead',
        body: {
          title: 'Blocked second write',
          ownerActor: { kind: 'role', role: 'lead' },
          dependsOn: [],
        },
      });
      expect(secondCreateTask.status).toBe(409);
      expect(secondCreateTask.body).toMatchObject({
        error: {
          code: 'PLUTO_TURN_CONSUMED',
        },
      });

      leaseStore.setCurrent(leadActor());
      const changeTaskState = await requestApi({
        url,
        method: 'POST',
        path: '/tools/change-task-state',
        actor: JSON.stringify(leadActor()),
        body: {
          taskId,
          to: 'running',
        },
      });
      expect(changeTaskState.status).toBe(200);
      expect(changeTaskState.body).toMatchObject({ accepted: true, sequence: 1 });

      leaseStore.setCurrent(leadActor());
      const sendMailbox = await requestApi({
        url,
        method: 'POST',
        path: '/tools/append-mailbox-message',
        actor: 'lead',
        body: {
          toActor: { kind: 'role', role: 'generator' },
          kind: 'task',
          body: 'Handle the change.',
        },
      });
      expect(sendMailbox.status).toBe(200);
      expect(sendMailbox.body).toMatchObject({ accepted: true, sequence: 2 });

      leaseStore.setCurrent(leadActor());
      const publishArtifact = await requestApi({
        url,
        method: 'POST',
        path: '/tools/publish-artifact',
        actor: 'role:lead',
        body: {
          kind: 'final',
          mediaType: 'text/plain',
          byteSize: 13,
          body: 'artifact body',
        },
      });
      expect(publishArtifact.status).toBe(200);
      expect(publishArtifact.body).toMatchObject({
        accepted: true,
        sequence: 3,
        artifactId: expect.any(String),
        path: expect.stringContaining('.txt'),
      });
      const artifactId = (publishArtifact.body as { artifactId: string }).artifactId;

      const readState = await requestApi({
        url,
        method: 'GET',
        path: '/state',
        actor: 'role:generator',
      });
      expect(readState.status).toBe(200);
      expect(readState.body).toEqual(promptView);
      expect(promptViewer.forActor).toHaveBeenCalledWith(generatorActor());

      const readArtifact = await requestApi({
        url,
        method: 'GET',
        path: `/artifacts/${artifactId}`,
        actor: 'role:lead',
      });
      expect(readArtifact.status).toBe(200);
      expect(readArtifact.text).toBe('artifact body');

      const readTranscript = await requestApi({
        url,
        method: 'GET',
        path: '/transcripts/role%3Alead',
        actor: 'role:lead',
      });
      expect(readTranscript.status).toBe(200);
      expect(readTranscript.text).toBe('lead transcript text');

      leaseStore.setCurrent(leadActor());
      const completeRun = await requestApi({
        url,
        method: 'POST',
        path: '/tools/complete-run',
        actor: 'role:lead',
        body: {
          status: 'succeeded',
          summary: 'done',
        },
      });
      expect(completeRun.status).toBe(200);
      expect(completeRun.body).toMatchObject({ accepted: true, sequence: 4 });
      expect(kernel.eventLog.read().map((event) => event.kind)).toEqual([
        'task_created',
        'task_state_changed',
        'mailbox_message_appended',
        'artifact_published',
        'run_completed',
      ]);
    });
  });

  it('returns 401 for bad bearer tokens and 403 when the actor header is missing', async () => {
    await withApi({}, async ({ url }) => {
      const unauthorized = await requestApi({
        url,
        method: 'GET',
        path: '/state',
        token: 'wrong-token',
        actor: 'role:lead',
      });
      expect(unauthorized.status).toBe(401);
      expect(unauthorized.body).toEqual({ error: 'unauthorized' });

      const missingActor = await requestApi({
        url,
        method: 'GET',
        path: '/state',
      });
      expect(missingActor.status).toBe(403);
      expect(missingActor.body).toMatchObject({
        error: {
          code: 'PLUTO_ACTOR_REQUIRED',
        },
      });
    });
  });
});
