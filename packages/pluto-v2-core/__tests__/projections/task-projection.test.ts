import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import {
  ArtifactPublishedEventSchema,
  MailboxMessageAppendedEventSchema,
  ReplayFixtureSchema,
  RequestRejectedEventSchema,
  RunCompletedEventSchema,
  RunStartedEventSchema,
  TaskCreatedEventSchema,
  TaskProjectionViewStateSchema,
  TaskStateChangedEventSchema,
  initialTaskState,
  replayTask,
  taskReducer,
} from '../../src/index.js';

const fixturePath = join(
  dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
  'test-fixtures',
  'replay',
  'basic-run.json',
);

const basicRunFixture = ReplayFixtureSchema.parse(
  JSON.parse(readFileSync(fixturePath, 'utf8')) as unknown,
);

const parseTaskView = (view: unknown) => TaskProjectionViewStateSchema.parse(view);

const createTaskCreatedEvent = (overrides: Partial<Record<string, unknown>> = {}) =>
  TaskCreatedEventSchema.parse({
    eventId: '00000000-0000-4000-8000-000000000201',
    runId: 'run-task',
    sequence: 0,
    timestamp: '2026-05-07T10:00:00.000Z',
    schemaVersion: '1.0',
    actor: { kind: 'manager' },
    requestId: '00000000-0000-4000-8000-000000000211',
    causationId: null,
    correlationId: 'corr-task',
    entityRef: { kind: 'task', taskId: 'task-1' },
    outcome: 'accepted',
    kind: 'task_created',
    payload: {
      taskId: 'task-1',
      title: 'Write replay tests',
      ownerActor: { kind: 'role', role: 'generator' },
      dependsOn: [],
    },
    ...overrides,
  });

const createTaskStateChangedEvent = (overrides: Partial<Record<string, unknown>> = {}) =>
  TaskStateChangedEventSchema.parse({
    eventId: '00000000-0000-4000-8000-000000000202',
    runId: 'run-task',
    sequence: 1,
    timestamp: '2026-05-07T10:01:00.000Z',
    schemaVersion: '1.0',
    actor: { kind: 'role', role: 'generator' },
    requestId: '00000000-0000-4000-8000-000000000212',
    causationId: '00000000-0000-4000-8000-000000000201',
    correlationId: 'corr-task',
    entityRef: { kind: 'task', taskId: 'task-1' },
    outcome: 'accepted',
    kind: 'task_state_changed',
    payload: {
      taskId: 'task-1',
      from: 'queued',
      to: 'completed',
    },
    ...overrides,
  });

const createRunStartedEvent = () =>
  RunStartedEventSchema.parse({
    eventId: '00000000-0000-4000-8000-000000000203',
    runId: 'run-task',
    sequence: 2,
    timestamp: '2026-05-07T10:02:00.000Z',
    schemaVersion: '1.0',
    actor: { kind: 'system' },
    requestId: null,
    causationId: null,
    correlationId: null,
    entityRef: { kind: 'run', runId: 'run-task' },
    outcome: 'accepted',
    kind: 'run_started',
    payload: {
      scenarioRef: 'scenario/task',
      runProfileRef: 'fake-smoke',
      startedAt: '2026-05-07T10:02:00.000Z',
    },
  });

const createRunCompletedEvent = () =>
  RunCompletedEventSchema.parse({
    eventId: '00000000-0000-4000-8000-000000000204',
    runId: 'run-task',
    sequence: 3,
    timestamp: '2026-05-07T10:03:00.000Z',
    schemaVersion: '1.0',
    actor: { kind: 'manager' },
    requestId: '00000000-0000-4000-8000-000000000214',
    causationId: null,
    correlationId: 'corr-task',
    entityRef: { kind: 'run', runId: 'run-task' },
    outcome: 'accepted',
    kind: 'run_completed',
    payload: {
      status: 'succeeded',
      completedAt: '2026-05-07T10:03:00.000Z',
      summary: 'Done.',
    },
  });

const createMailboxMessageEvent = () =>
  MailboxMessageAppendedEventSchema.parse({
    eventId: '00000000-0000-4000-8000-000000000205',
    runId: 'run-task',
    sequence: 4,
    timestamp: '2026-05-07T10:04:00.000Z',
    schemaVersion: '1.0',
    actor: { kind: 'manager' },
    requestId: '00000000-0000-4000-8000-000000000215',
    causationId: null,
    correlationId: 'corr-task',
    entityRef: { kind: 'mailbox_message', messageId: 'msg-1' },
    outcome: 'accepted',
    kind: 'mailbox_message_appended',
    payload: {
      messageId: 'msg-1',
      fromActor: { kind: 'manager' },
      toActor: { kind: 'broadcast' },
      kind: 'plan',
      body: 'Plan it.',
    },
  });

const createArtifactPublishedEvent = () =>
  ArtifactPublishedEventSchema.parse({
    eventId: '00000000-0000-4000-8000-000000000206',
    runId: 'run-task',
    sequence: 5,
    timestamp: '2026-05-07T10:05:00.000Z',
    schemaVersion: '1.0',
    actor: { kind: 'manager' },
    requestId: '00000000-0000-4000-8000-000000000216',
    causationId: null,
    correlationId: 'corr-task',
    entityRef: { kind: 'artifact', artifactId: 'artifact-1' },
    outcome: 'accepted',
    kind: 'artifact_published',
    payload: {
      artifactId: 'artifact-1',
      kind: 'final',
      mediaType: 'text/markdown',
      byteSize: 128,
    },
  });

const createRequestRejectedEvent = () =>
  RequestRejectedEventSchema.parse({
    eventId: '00000000-0000-4000-8000-000000000207',
    runId: 'run-task',
    sequence: 6,
    timestamp: '2026-05-07T10:06:00.000Z',
    schemaVersion: '1.0',
    actor: { kind: 'manager' },
    requestId: '00000000-0000-4000-8000-000000000217',
    causationId: null,
    correlationId: 'corr-task',
    entityRef: { kind: 'task', taskId: 'task-2' },
    outcome: 'rejected',
    kind: 'request_rejected',
    payload: {
      rejectionReason: 'state_conflict',
      rejectedRequestId: '00000000-0000-4000-8000-000000000317',
      detail: 'Rejected.',
    },
  });

describe('task projection', () => {
  it('replays task_created into a queued task view', () => {
    const view = replayTask([createTaskCreatedEvent()]);

    expect(parseTaskView(view)).toEqual(view);
    expect(view).toEqual({
      tasks: {
        'task-1': {
          title: 'Write replay tests',
          ownerActor: { kind: 'role', role: 'generator' },
          state: 'queued',
          dependsOn: [],
          history: [],
        },
      },
    });
  });

  it('dedups duplicate task_created events by taskId', () => {
    const first = createTaskCreatedEvent();
    const duplicate = createTaskCreatedEvent({
      eventId: '00000000-0000-4000-8000-000000000208',
      sequence: 1,
      requestId: '00000000-0000-4000-8000-000000000218',
      payload: {
        taskId: 'task-1',
        title: 'Should not replace',
        ownerActor: null,
        dependsOn: ['task-x'],
      },
    });

    const view = replayTask([first, duplicate]);

    expect(parseTaskView(view)).toEqual(view);
    expect(view.tasks['task-1']).toEqual({
      title: 'Write replay tests',
      ownerActor: { kind: 'role', role: 'generator' },
      state: 'queued',
      dependsOn: [],
      history: [],
    });
  });

  it('updates task state and dedups history entries by eventId', () => {
    const created = createTaskCreatedEvent();
    const changed = createTaskStateChangedEvent();

    const once = replayTask([created, changed]);
    const twice = replayTask([created, changed, changed]);

    expect(parseTaskView(once)).toEqual(once);
    expect(twice).toEqual(once);
    expect(once.tasks['task-1']).toEqual({
      title: 'Write replay tests',
      ownerActor: { kind: 'role', role: 'generator' },
      state: 'completed',
      dependsOn: [],
      history: [
        {
          from: 'queued',
          to: 'completed',
          eventId: '00000000-0000-4000-8000-000000000202',
        },
      ],
    });
  });

  it('treats task_state_changed for an unknown task as a no-op', () => {
    const view = replayTask([createTaskStateChangedEvent()]);

    expect(parseTaskView(view)).toEqual(view);
    expect(view).toEqual(initialTaskState.view);
  });

  it('treats out-of-input kinds as no-ops', () => {
    const events = [
      createRunStartedEvent(),
      createRunCompletedEvent(),
      createMailboxMessageEvent(),
      createArtifactPublishedEvent(),
      createRequestRejectedEvent(),
    ];

    const view = replayTask(events);

    expect(parseTaskView(view)).toEqual(view);
    expect(view).toEqual(initialTaskState.view);
  });

  it('matches reducer folding and the basic-run fixture task view', () => {
    const reduced = basicRunFixture.events.reduce(taskReducer, initialTaskState).view;
    const replayed = replayTask(basicRunFixture.events);

    expect(parseTaskView(replayed)).toEqual(replayed);
    expect(replayed).toEqual(reduced);
    expect(replayed).toEqual(basicRunFixture.expectedViews.task);
  });
});
