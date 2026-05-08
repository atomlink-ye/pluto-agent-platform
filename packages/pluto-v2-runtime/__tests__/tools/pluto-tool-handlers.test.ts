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

import { makePlutoToolHandlers } from '../../src/tools/pluto-tool-handlers.js';

const FIXED_ISO = '2026-05-08T00:00:00.000Z';

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
    scenarioRef: 'scenario/tool-contract',
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
  idProvider?: () => string;
  artifactReadResult?: { path: string; body: string };
  artifactPathFactory?: (artifactId: string) => string;
  transcriptText?: string;
  promptView?: unknown;
}) {
  const kernel = options?.kernel ?? createKernel();
  const artifactPathFactory = options?.artifactPathFactory ?? ((artifactId: string) => `/tmp/run-1/${artifactId}.txt`);
  const artifactSidecar = {
    write: vi.fn(async (artifactId: string, _body: string | Uint8Array) => artifactPathFactory(artifactId)),
    read: vi.fn(async (_artifactId: string) => options?.artifactReadResult ?? { path: '/tmp/artifact.txt', body: 'artifact body' }),
  };
  const transcriptSidecar = {
    read: vi.fn(async (_actorKey: string) => options?.transcriptText ?? 'transcript text'),
  };
  const promptViewer = {
    forActor: vi.fn((_actor: ActorRef) => options?.promptView ?? { run: { runId: 'run-1' }, tasks: [] }),
  };

  return {
    deps: {
      kernel,
      runId: 'run-1',
      schemaVersion: SCHEMA_VERSION,
      clock: () => new Date(FIXED_ISO),
      idProvider: options?.idProvider ?? sequentialRequestIds([uuid('101'), uuid('102'), uuid('103'), uuid('104')]),
      artifactSidecar,
      transcriptSidecar,
      promptViewer,
    },
    artifactSidecar,
    transcriptSidecar,
    promptViewer,
  };
}

function leadSession(): { currentActor: ActorRef; isLead: boolean } {
  return {
    currentActor: { kind: 'role', role: 'lead' },
    isLead: true,
  };
}

function generatorSession(): { currentActor: ActorRef; isLead: boolean } {
  return {
    currentActor: { kind: 'role', role: 'generator' },
    isLead: false,
  };
}

function managerSession(): { currentActor: ActorRef; isLead: boolean } {
  return {
    currentActor: { kind: 'manager' },
    isLead: false,
  };
}

function plannerSession(): { currentActor: ActorRef; isLead: boolean } {
  return {
    currentActor: { kind: 'role', role: 'planner' },
    isLead: false,
  };
}

function textOf(result: Awaited<ReturnType<ReturnType<typeof makePlutoToolHandlers>['pluto_create_task']>>) {
  expect(result.ok).toBe(true);
  if (!result.ok) {
    throw new Error(`Expected ok result, received ${result.error.code}`);
  }

  return (result.data as { content: Array<{ type: string; text: string }> }).content[0]?.text ?? '';
}

function jsonOf(result: Awaited<ReturnType<ReturnType<typeof makePlutoToolHandlers>['pluto_create_task']>>) {
  return JSON.parse(textOf(result));
}

function firstEvent(kernel: RunKernel) {
  const [event] = kernel.eventLog.read();
  expect(event).toBeDefined();
  if (!event) {
    throw new Error('Expected an event to be recorded.');
  }

  return event;
}

describe('makePlutoToolHandlers', () => {
  it('pluto_create_task returns accepted event echo with kernel taskId', async () => {
    const { deps } = createHandlerDeps();
    const handlers = makePlutoToolHandlers(deps);

    const result = await handlers.pluto_create_task(leadSession(), {
      title: 'Write tests',
      ownerActor: { kind: 'role', role: 'generator' },
      dependsOn: [],
    });

    expect(jsonOf(result)).toEqual({
      accepted: true,
      eventId: uuid('1'),
      sequence: 0,
      taskId: uuid('2'),
    });
  });

  it('pluto_create_task rejects bad args without calling kernel', async () => {
    const submit = vi.fn(() => {
      throw new Error('submit should not be called');
    });
    const { deps } = createHandlerDeps({
      kernel: { submit } as unknown as RunKernelType,
    });
    const handlers = makePlutoToolHandlers(deps);

    const result = await handlers.pluto_create_task(leadSession(), {
      ownerActor: { kind: 'role', role: 'generator' },
      dependsOn: [],
    });

    expect(result).toMatchObject({
      ok: false,
      error: {
        code: 'PLUTO_TOOL_BAD_ARGS',
      },
    });
    expect(submit).not.toHaveBeenCalled();
  });

  it('pluto_create_task surfaces kernel authority rejection as accepted false', async () => {
    const { deps } = createHandlerDeps();
    const handlers = makePlutoToolHandlers(deps);

    const result = await handlers.pluto_create_task(generatorSession(), {
      title: 'Nope',
      ownerActor: { kind: 'role', role: 'generator' },
      dependsOn: [],
    });

    expect(jsonOf(result)).toMatchObject({
      accepted: false,
      reason: 'actor_not_authorized',
    });
  });

  it('pluto_change_task_state returns accepted event echo', async () => {
    const kernel = createKernel([
      {
        taskId: 'task-1',
        title: 'Queued task',
        ownerActor: { kind: 'role', role: 'generator' },
        dependsOn: [],
      },
    ]);
    const { deps } = createHandlerDeps({ kernel });
    const handlers = makePlutoToolHandlers(deps);

    const result = await handlers.pluto_change_task_state(managerSession(), {
      taskId: 'task-1',
      to: 'running',
    });

    expect(jsonOf(result)).toEqual({
      accepted: true,
      eventId: uuid('1'),
      sequence: 0,
    });
  });

  it('pluto_append_mailbox_message binds fromActor from session and ignores arg fromActor', async () => {
    const kernel = createKernel();
    const { deps } = createHandlerDeps({ kernel });
    const handlers = makePlutoToolHandlers(deps);

    const result = await handlers.pluto_append_mailbox_message(generatorSession(), {
      fromActor: { kind: 'manager' },
      toActor: { kind: 'broadcast' },
      kind: 'task',
      body: 'Started work',
    });

    expect(jsonOf(result)).toEqual({
      accepted: true,
      eventId: uuid('1'),
      sequence: 0,
    });

    const event = firstEvent(kernel);
    expect(event.kind).toBe('mailbox_message_appended');
    if (event.kind !== 'mailbox_message_appended') {
      throw new Error(`Expected mailbox_message_appended, received ${event.kind}`);
    }
    expect(event.payload.fromActor).toEqual({ kind: 'role', role: 'generator' });
  });

  it('pluto_publish_artifact without body skips sidecar write and omits path', async () => {
    const { deps, artifactSidecar } = createHandlerDeps();
    const handlers = makePlutoToolHandlers(deps);

    const result = await handlers.pluto_publish_artifact(generatorSession(), {
      kind: 'final',
      mediaType: 'text/plain',
      byteSize: 12,
    });

    expect(jsonOf(result)).toEqual({
      accepted: true,
      eventId: uuid('1'),
      sequence: 0,
      artifactId: uuid('2'),
    });
    expect(artifactSidecar.write).not.toHaveBeenCalled();
  });

  it('pluto_publish_artifact with body writes sidecar once and includes path', async () => {
    const { deps, artifactSidecar } = createHandlerDeps({
      artifactPathFactory: (artifactId) => `/tmp/run-1/${artifactId}.txt`,
    });
    const handlers = makePlutoToolHandlers(deps);

    const result = await handlers.pluto_publish_artifact(generatorSession(), {
      kind: 'intermediate',
      mediaType: 'text/plain',
      byteSize: 12,
      body: 'artifact body',
    });

    expect(artifactSidecar.write).toHaveBeenCalledTimes(1);
    expect(artifactSidecar.write).toHaveBeenCalledWith(uuid('2'), 'artifact body');
    expect(jsonOf(result)).toEqual({
      accepted: true,
      eventId: uuid('1'),
      sequence: 0,
      artifactId: uuid('2'),
      path: `/tmp/run-1/${uuid('2')}.txt`,
    });
  });

  it('pluto_publish_artifact does not write a sidecar when the kernel rejects the request', async () => {
    const { deps, artifactSidecar } = createHandlerDeps();
    const handlers = makePlutoToolHandlers(deps);

    const result = await handlers.pluto_publish_artifact(plannerSession(), {
      kind: 'intermediate',
      mediaType: 'text/plain',
      byteSize: 12,
      body: 'artifact body',
    });

    expect(jsonOf(result)).toMatchObject({
      accepted: false,
      reason: 'actor_not_authorized',
    });
    expect(artifactSidecar.write).not.toHaveBeenCalled();
  });

  it('pluto_complete_run from lead synthesizes a manager-owned request', async () => {
    const kernel = createKernel();
    const { deps } = createHandlerDeps({ kernel });
    const handlers = makePlutoToolHandlers(deps);

    const result = await handlers.pluto_complete_run(leadSession(), {
      status: 'succeeded',
      summary: 'Done.',
    });

    expect(jsonOf(result)).toEqual({
      accepted: true,
      eventId: uuid('1'),
      sequence: 0,
    });

    const event = firstEvent(kernel);
    expect(event.kind).toBe('run_completed');
    expect(event.actor).toEqual({ kind: 'manager' });
  });

  it('pluto_complete_run rejects non-lead sessions before kernel submit', async () => {
    const submit = vi.fn(() => {
      throw new Error('submit should not be called');
    });
    const { deps } = createHandlerDeps({
      kernel: { submit } as unknown as RunKernelType,
    });
    const handlers = makePlutoToolHandlers(deps);

    const result = await handlers.pluto_complete_run(generatorSession(), {
      status: 'failed',
      summary: 'No permission',
    });

    expect(result).toEqual({
      ok: false,
      error: {
        code: 'PLUTO_TOOL_LEAD_ONLY',
        message: 'complete_run is only available to the lead session.',
      },
    });
    expect(submit).not.toHaveBeenCalled();
  });

  it('pluto_read_state returns prompt viewer content for the active actor', async () => {
    const promptView = { run: { runId: 'run-1' }, tasks: [{ id: 'task-1' }] };
    const { deps, promptViewer } = createHandlerDeps({ promptView });
    const handlers = makePlutoToolHandlers(deps);

    const result = await handlers.pluto_read_state(generatorSession(), {});

    expect(promptViewer.forActor).toHaveBeenCalledWith({ kind: 'role', role: 'generator' });
    expect(jsonOf(result)).toEqual(promptView);
  });

  it('pluto_read_artifact returns body and path', async () => {
    const { deps, artifactSidecar } = createHandlerDeps({
      artifactReadResult: { path: '/tmp/artifact.txt', body: 'artifact body' },
    });
    const handlers = makePlutoToolHandlers(deps);

    const result = await handlers.pluto_read_artifact(generatorSession(), {
      artifactId: uuid('777'),
    });

    expect(artifactSidecar.read).toHaveBeenCalledWith(uuid('777'));
    expect(jsonOf(result)).toEqual({ path: '/tmp/artifact.txt', body: 'artifact body' });
  });

  it('pluto_read_transcript returns transcript text', async () => {
    const { deps, transcriptSidecar } = createHandlerDeps({
      transcriptText: 'line 1\nline 2',
    });
    const handlers = makePlutoToolHandlers(deps);

    const result = await handlers.pluto_read_transcript(generatorSession(), {
      actorKey: 'role:generator',
    });

    expect(transcriptSidecar.read).toHaveBeenCalledWith('role:generator');
    expect(textOf(result)).toBe('line 1\nline 2');
  });

  it('read tools never invoke kernel.submit', async () => {
    const submit = vi.fn(() => {
      throw new Error('submit should not be called');
    });
    const { deps } = createHandlerDeps({
      kernel: { submit } as unknown as RunKernelType,
    });
    const handlers = makePlutoToolHandlers(deps);

    await expect(handlers.pluto_read_state(generatorSession(), {})).resolves.toMatchObject({ ok: true });
    await expect(
      handlers.pluto_read_artifact(generatorSession(), { artifactId: uuid('778') }),
    ).resolves.toMatchObject({ ok: true });
    await expect(
      handlers.pluto_read_transcript(generatorSession(), { actorKey: 'role:generator' }),
    ).resolves.toMatchObject({ ok: true });

    expect(submit).not.toHaveBeenCalled();
  });

  it('allocates a fresh requestId for each mutating call', async () => {
    const kernel = createKernel();
    const { deps } = createHandlerDeps({
      kernel,
      idProvider: sequentialRequestIds([uuid('901'), uuid('902')]),
    });
    const handlers = makePlutoToolHandlers(deps);

    await handlers.pluto_create_task(leadSession(), {
      title: 'Task A',
      ownerActor: { kind: 'role', role: 'generator' },
      dependsOn: [],
    });
    await handlers.pluto_publish_artifact(generatorSession(), {
      kind: 'final',
      mediaType: 'text/plain',
      byteSize: 1,
    });

    expect(kernel.eventLog.read().map((event) => event.requestId)).toEqual([uuid('901'), uuid('902')]);
  });
});
