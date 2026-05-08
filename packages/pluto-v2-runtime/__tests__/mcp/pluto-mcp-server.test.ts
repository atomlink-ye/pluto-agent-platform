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

import { startPlutoMcpServer, type PlutoMcpServerConfig } from '../../src/mcp/pluto-mcp-server.js';
import { makeTurnLeaseStore } from '../../src/mcp/turn-lease.js';
import { makePlutoToolHandlers } from '../../src/tools/pluto-tool-handlers.js';
import { PLUTO_TOOL_NAMES } from '../../src/tools/pluto-tool-schemas.js';

const FIXED_ISO = '2026-05-08T00:00:00.000Z';
const PROTOCOL_VERSION = '2025-11-25';
const TOKEN = 'pluto-test-token';

const leadActor = (): ActorRef => ({ kind: 'role', role: 'lead' });
const generatorActor = (): ActorRef => ({ kind: 'role', role: 'generator' });

const uuid = (suffix: string) => `00000000-0000-4000-8000-${suffix.padStart(12, '0')}`;

function createTeamContext(
  initialTasks: Array<{
    taskId: string;
    title: string;
    ownerActor: ActorRef | null;
    dependsOn: string[];
  }> = [],
) {
  return TeamContextSchema.parse({
    runId: 'run-1',
    scenarioRef: 'scenario/mcp-server',
    runProfileRef: 'unit-test',
    declaredActors: [
      { kind: 'manager' },
      { kind: 'role', role: 'lead' },
      { kind: 'role', role: 'planner' },
      { kind: 'role', role: 'generator' },
      { kind: 'role', role: 'evaluator' },
      { kind: 'system' },
    ],
    initialTasks,
    policy: AUTHORITY_MATRIX,
  });
}

function createKernel(
  initialTasks: Array<{
    taskId: string;
    title: string;
    ownerActor: ActorRef | null;
    dependsOn: string[];
  }> = [],
) {
  return new RunKernel({
    initialState: initialState(createTeamContext(initialTasks)),
    eventLog: new InMemoryEventLogStore(),
    idProvider: counterIdProvider(1),
    clockProvider: fixedClockProvider(FIXED_ISO),
  });
}

function sequentialRequestIds(values: readonly string[]) {
  let index = 0;

  return () => {
    const value = values[index];
    if (value === undefined) {
      throw new Error(`Missing request id at index ${index}`);
    }

    index += 1;
    return value;
  };
}

function createHandlerDeps(options?: {
  kernel?: RunKernelType;
  promptView?: unknown;
}) {
  const kernel = options?.kernel ?? createKernel();
  const artifactSidecar = {
    write: vi.fn(async (artifactId: string, _body: string | Uint8Array) => `/tmp/run-1/${artifactId}.txt`),
    read: vi.fn(async (_artifactId: string) => ({ path: '/tmp/artifact.txt', body: 'artifact body' })),
  };
  const transcriptSidecar = {
    read: vi.fn(async (_actorKey: string) => 'transcript text'),
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
      idProvider: sequentialRequestIds([uuid('101'), uuid('102'), uuid('103'), uuid('104')]),
      artifactSidecar,
      transcriptSidecar,
      promptViewer,
    }),
  };
}

function rpc(method: string, params?: Record<string, unknown>, id: string | number = 1) {
  return {
    jsonrpc: '2.0' as const,
    id,
    method,
    ...(params === undefined ? {} : { params }),
  };
}

async function postMcp(
  url: string,
  body: unknown,
  options?: {
    token?: string;
    actor?: ActorRef;
    protocolVersion?: string;
  },
) {
  const headers: Record<string, string> = {
    authorization: `Bearer ${options?.token ?? TOKEN}`,
    'content-type': 'application/json',
    'mcp-protocol-version': options?.protocolVersion ?? PROTOCOL_VERSION,
  };

  if (options?.actor) {
    headers['Pluto-Run-Actor'] = JSON.stringify(options.actor);
  }

  const response = await fetch(url, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  });
  const text = await response.text();

  return {
    status: response.status,
    protocolVersion: response.headers.get('MCP-Protocol-Version'),
    sessionId: response.headers.get('MCP-Session-Id'),
    text,
    json: text === '' ? undefined : JSON.parse(text),
  };
}

function expectRpcSuccess(response: Awaited<ReturnType<typeof postMcp>>) {
  expect(response.status).toBe(200);
  expect(response.json).toMatchObject({ jsonrpc: '2.0' });
  const body = response.json as { result?: unknown; error?: unknown };
  expect(body.error).toBeUndefined();
  return body.result;
}

function expectRpcError(response: Awaited<ReturnType<typeof postMcp>>) {
  expect(response.status).toBe(200);
  expect(response.json).toMatchObject({ jsonrpc: '2.0', error: expect.any(Object) });
  return (response.json as { error: { code: number; message: string; data?: unknown } }).error;
}

function toolJson(result: unknown) {
  const toolResult = result as { content: Array<{ type: string; text: string }> };
  const firstChunk = toolResult.content[0];
  expect(firstChunk?.type).toBe('text');
  return JSON.parse(firstChunk?.text ?? 'null');
}

async function withServer(
  options: {
    leaseActor?: ActorRef | null;
    kernel?: RunKernelType;
    promptView?: unknown;
    port?: number;
    onRequest?: PlutoMcpServerConfig['onRequest'];
  },
  run: (context: {
    handle: Awaited<ReturnType<typeof startPlutoMcpServer>>;
    kernel: RunKernelType;
    promptViewer: { forActor: ReturnType<typeof vi.fn> };
  }) => Promise<void>,
) {
  const { kernel, promptViewer, handlers } = createHandlerDeps({
    kernel: options.kernel,
    promptView: options.promptView,
  });
  const leaseStore = makeTurnLeaseStore(options.leaseActor ?? leadActor());
  const handle = await startPlutoMcpServer({
    bearerToken: TOKEN,
    handlers,
    leaseStore,
    ...(options.port === undefined ? {} : { port: options.port }),
    ...(options.onRequest === undefined ? {} : { onRequest: options.onRequest }),
  });

  try {
    await run({ handle, kernel, promptViewer });
  } finally {
    await handle.shutdown();
  }
}

describe('startPlutoMcpServer', () => {
  it('starts on localhost, returns a URL, and lists pluto tools', async () => {
    await withServer({}, async ({ handle }) => {
      expect(handle.url).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/mcp$/);
      expect(handle.port).toBeGreaterThan(0);

      const initializeResponse = await postMcp(
        handle.url,
        rpc('initialize', { protocolVersion: PROTOCOL_VERSION, capabilities: {} }),
      );

      expect(expectRpcSuccess(initializeResponse)).toMatchObject({
        protocolVersion: PROTOCOL_VERSION,
        capabilities: { tools: {} },
      });
      expect(initializeResponse.protocolVersion).toBe(PROTOCOL_VERSION);
      expect(initializeResponse.sessionId).toMatch(/[0-9a-f-]{36}/);

      const initializedNotification = await postMcp(
        handle.url,
        { jsonrpc: '2.0', method: 'notifications/initialized' },
      );
      expect(initializedNotification.status).toBe(202);

      const listResponse = await postMcp(handle.url, rpc('tools/list'));
      const listResult = expectRpcSuccess(listResponse) as { tools: Array<{ name: string }> };
      expect(listResult.tools.map((tool) => tool.name)).toEqual([...PLUTO_TOOL_NAMES]);
      expect(listResult.tools.every((tool) => tool.name.startsWith('pluto_'))).toBe(true);
    });
  });

  it('allows pluto_read_state without lease ownership', async () => {
    const promptView = { run: { runId: 'run-1' }, tasks: [{ taskId: 'task-1' }] };

    await withServer({ leaseActor: leadActor(), promptView }, async ({ handle, promptViewer }) => {
      const response = await postMcp(
        handle.url,
        rpc('tools/call', { name: 'pluto_read_state', arguments: {} }),
        { actor: generatorActor() },
      );

      const result = expectRpcSuccess(response);
      expect(toolJson(result)).toEqual(promptView);
      expect(promptViewer.forActor).toHaveBeenCalledWith({ kind: 'role', role: 'generator' });
    });
  });

  it('allows pluto_create_task for the current lease holder', async () => {
    await withServer({ leaseActor: leadActor() }, async ({ handle, kernel }) => {
      const response = await postMcp(
        handle.url,
        rpc('tools/call', {
          name: 'pluto_create_task',
          arguments: {
            title: 'Write MCP tests',
            ownerActor: { kind: 'role', role: 'generator' },
            dependsOn: [],
          },
        }),
        { actor: leadActor() },
      );

      expect(toolJson(expectRpcSuccess(response))).toEqual({
        accepted: true,
        eventId: uuid('1'),
        sequence: 0,
        taskId: uuid('2'),
      });
      expect(kernel.eventLog.read()).toHaveLength(1);
      expect(kernel.eventLog.read()[0]?.kind).toBe('task_created');
    });
  });

  it('rejects pluto_create_task when the actor is outside the current lease', async () => {
    await withServer({ leaseActor: leadActor() }, async ({ handle, kernel }) => {
      const response = await postMcp(
        handle.url,
        rpc('tools/call', {
          name: 'pluto_create_task',
          arguments: {
            title: 'No lease',
            ownerActor: { kind: 'role', role: 'generator' },
            dependsOn: [],
          },
        }),
        { actor: generatorActor() },
      );

      const error = expectRpcError(response);
      expect(error.code).toBe(-32001);
      expect(error.message).toContain('Lease mismatch');
      expect(kernel.eventLog.read()).toHaveLength(0);
    });
  });

  it('rejects all requests with the wrong bearer token', async () => {
    await withServer({}, async ({ handle }) => {
      const response = await postMcp(handle.url, rpc('tools/list'), {
        token: 'wrong-token',
      });

      expect(response.status).toBe(401);
      expect(response.json).toEqual({ error: 'unauthorized' });
    });
  });

  it('rejects non-loopback bind hosts', async () => {
    const { handlers } = createHandlerDeps();

    await expect(
      startPlutoMcpServer({
        bindHost: '0.0.0.0' as '127.0.0.1',
        bearerToken: TOKEN,
        handlers,
        leaseStore: makeTurnLeaseStore(leadActor()),
      }),
    ).rejects.toThrow('127.0.0.1');
  });

  it('surfaces pluto_complete_run lead-only rejection as an MCP error', async () => {
    await withServer({ leaseActor: generatorActor() }, async ({ handle, kernel }) => {
      const response = await postMcp(
        handle.url,
        rpc('tools/call', {
          name: 'pluto_complete_run',
          arguments: {
            status: 'failed',
            summary: 'Not allowed',
          },
        }),
        { actor: generatorActor() },
      );

      const error = expectRpcError(response);
      expect(error.code).toBe(-32003);
      expect(error.message).toContain('PLUTO_TOOL_LEAD_ONLY');
      expect(kernel.eventLog.read()).toHaveLength(0);
    });
  });

  it('returns the actual bound port when started with port 0', async () => {
    await withServer({ port: 0 }, async ({ handle }) => {
      expect(handle.port).toBeGreaterThan(0);
      expect(handle.port).not.toBe(0);
    });
  });

  it('releases a fixed port on shutdown', async () => {
    const first = createHandlerDeps();
    const firstServer = await startPlutoMcpServer({
      bearerToken: TOKEN,
      handlers: first.handlers,
      leaseStore: makeTurnLeaseStore(leadActor()),
      port: 0,
    });

    const port = firstServer.port;
    await firstServer.shutdown();

    const second = createHandlerDeps();
    const secondServer = await startPlutoMcpServer({
      bearerToken: TOKEN,
      handlers: second.handlers,
      leaseStore: makeTurnLeaseStore(leadActor()),
      port,
    });

    try {
      expect(secondServer.port).toBe(port);
      const listResponse = await postMcp(secondServer.url, rpc('tools/list'));
      expect(expectRpcSuccess(listResponse)).toMatchObject({
        tools: expect.any(Array),
      });
    } finally {
      await secondServer.shutdown();
    }
  });

  it('fires onRequest for each tool call with the method, tool name, and current lease', async () => {
    const seenRequests: Array<{ method: string; toolName?: string; lease?: ActorRef }> = [];

    await withServer(
      {
        leaseActor: leadActor(),
        onRequest: (request) => {
          seenRequests.push(request);
        },
      },
      async ({ handle }) => {
        await postMcp(
          handle.url,
          rpc('tools/call', { name: 'pluto_read_state', arguments: {} }),
          { actor: generatorActor() },
        );
        await postMcp(
          handle.url,
          rpc('tools/call', {
            name: 'pluto_create_task',
            arguments: {
              title: 'Observed task',
              ownerActor: { kind: 'role', role: 'generator' },
              dependsOn: [],
            },
          }),
          { actor: leadActor() },
        );

        expect(seenRequests).toEqual([
          {
            method: 'tools/call',
            toolName: 'pluto_read_state',
            lease: { kind: 'role', role: 'lead' },
          },
          {
            method: 'tools/call',
            toolName: 'pluto_create_task',
            lease: { kind: 'role', role: 'lead' },
          },
        ]);
      },
    );
  });
});
