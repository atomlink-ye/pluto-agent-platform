import { describe, expect, it } from 'vitest';

import { RunEventSchema } from '../../src/run-event.js';
import { AUTHORITY_MATRIX, TeamContextSchema, initialState, reduce } from '../../src/core/index.js';

const uuid = (suffix: string) => `00000000-0000-4000-8000-${suffix.padStart(12, '0')}`;

const teamContext = TeamContextSchema.parse({
  runId: 'run-1',
  scenarioRef: 'scenario/hello-team',
  runProfileRef: 'fake-smoke',
  declaredActors: [{ kind: 'manager' }, { kind: 'role', role: 'generator' }, { kind: 'system' }],
  initialTasks: [
    { taskId: 'task-1', title: 'Existing task', ownerActor: { kind: 'role', role: 'generator' }, dependsOn: [] },
  ],
  policy: AUTHORITY_MATRIX,
});

function makeBaseAcceptedEvent() {
  return {
    eventId: uuid('1'),
    runId: 'run-1',
    sequence: 0,
    timestamp: '2026-05-07T00:00:00.000Z',
    schemaVersion: '1.0',
    actor: { kind: 'manager' } as const,
    requestId: uuid('11'),
    causationId: null,
    correlationId: null,
    outcome: 'accepted' as const,
  };
}

function withAcceptedRequestKey<T extends object>(value: T, acceptedRequestKey = 'run-1|manager|append_mailbox_message|idem-1') {
  return Object.assign(value, { acceptedRequestKey });
}

function makeRunStartedEvent() {
  return RunEventSchema.parse({
    ...makeBaseAcceptedEvent(),
    eventId: uuid('2'),
    actor: { kind: 'system' },
    requestId: null,
    kind: 'run_started',
    entityRef: { kind: 'run', runId: 'run-1' },
    payload: {
      scenarioRef: 'scenario/hello-team',
      runProfileRef: 'fake-smoke',
      startedAt: '2026-05-07T00:00:00.000Z',
    },
  });
}

describe('reduce', () => {
  it('is replay-equal for a fixed event sequence', () => {
    const events = [
      makeRunStartedEvent(),
      withAcceptedRequestKey(
        RunEventSchema.parse({
          ...makeBaseAcceptedEvent(),
          eventId: uuid('3'),
          sequence: 1,
          kind: 'mailbox_message_appended',
          entityRef: { kind: 'mailbox_message', messageId: 'msg-1' },
          payload: {
            messageId: 'msg-1',
            fromActor: { kind: 'manager' },
            toActor: { kind: 'broadcast' },
            kind: 'plan',
            body: 'Plan the work.',
          },
        }),
      ),
      RunEventSchema.parse({
        ...makeBaseAcceptedEvent(),
        eventId: uuid('4'),
        sequence: 2,
        kind: 'task_state_changed',
        entityRef: { kind: 'task', taskId: 'task-1' },
        payload: {
          taskId: 'task-1',
          from: 'queued',
          to: 'running',
        },
      }),
      RunEventSchema.parse({
        eventId: uuid('5'),
        runId: 'run-1',
        sequence: 3,
        timestamp: '2026-05-07T00:00:03.000Z',
        schemaVersion: '1.0',
        actor: { kind: 'manager' },
        requestId: uuid('12'),
        causationId: uuid('4'),
        correlationId: null,
        entityRef: { kind: 'task', taskId: 'task-1' },
        outcome: 'rejected',
        kind: 'request_rejected',
        payload: {
          rejectionReason: 'state_conflict',
          rejectedRequestId: uuid('12'),
          detail: 'Transition running -> queued is not legal.',
        },
      }),
      RunEventSchema.parse({
        ...makeBaseAcceptedEvent(),
        eventId: uuid('6'),
        sequence: 4,
        kind: 'run_completed',
        entityRef: { kind: 'run', runId: 'run-1' },
        payload: {
          status: 'succeeded',
          completedAt: '2026-05-07T00:00:04.000Z',
          summary: 'Done.',
        },
      }),
    ];

    const liveState = events.reduce(reduce, initialState(teamContext));
    const replayState = events.reduce(reduce, initialState(teamContext));

    expect(replayState).toEqual(liveState);
  });

  it('reduces run_started events to running status', () => {
    const nextState = reduce(initialState(teamContext), makeRunStartedEvent());

    expect(nextState.sequence).toBe(0);
    expect(nextState.status).toBe('running');
  });

  it('reduces run_completed events to completed status', () => {
    const nextState = reduce(
      initialState(teamContext),
      RunEventSchema.parse({
        ...makeBaseAcceptedEvent(),
        kind: 'run_completed',
        entityRef: { kind: 'run', runId: 'run-1' },
        payload: {
          status: 'succeeded',
          completedAt: '2026-05-07T00:00:00.000Z',
          summary: 'Done.',
        },
      }),
    );

    expect(nextState.sequence).toBe(0);
    expect(nextState.status).toBe('completed');
  });

  it('reduces mailbox_message_appended events and records accepted request keys', () => {
    const nextState = reduce(
      initialState(teamContext),
      withAcceptedRequestKey(
        RunEventSchema.parse({
          ...makeBaseAcceptedEvent(),
          kind: 'mailbox_message_appended',
          entityRef: { kind: 'mailbox_message', messageId: 'msg-1' },
          payload: {
            messageId: 'msg-1',
            fromActor: { kind: 'manager' },
            toActor: { kind: 'broadcast' },
            kind: 'plan',
            body: 'Plan the work.',
          },
        }),
      ),
    );

    expect(nextState.sequence).toBe(0);
    expect(nextState.acceptedRequestKeys).toEqual(new Set(['run-1|manager|append_mailbox_message|idem-1']));
  });

  it('reduces task_created events by inserting queued tasks', () => {
    const nextState = reduce(
      initialState(teamContext),
      RunEventSchema.parse({
        ...makeBaseAcceptedEvent(),
        kind: 'task_created',
        entityRef: { kind: 'task', taskId: 'task-2' },
        payload: {
          taskId: 'task-2',
          title: 'Second task',
          ownerActor: { kind: 'role', role: 'generator' },
          dependsOn: ['task-1'],
        },
      }),
    );

    expect(nextState.tasks['task-2']).toEqual({
      state: 'queued',
      ownerActor: { kind: 'role', role: 'generator' },
    });
  });

  it('reduces task_state_changed events by updating task state and preserving ownership', () => {
    const nextState = reduce(
      initialState(teamContext),
      RunEventSchema.parse({
        ...makeBaseAcceptedEvent(),
        kind: 'task_state_changed',
        entityRef: { kind: 'task', taskId: 'task-1' },
        payload: {
          taskId: 'task-1',
          from: 'queued',
          to: 'completed',
        },
      }),
    );

    expect(nextState.tasks['task-1']).toEqual({
      state: 'completed',
      ownerActor: { kind: 'role', role: 'generator' },
    });
  });

  it('reduces artifact_published events without widening run state shape', () => {
    const before = initialState(teamContext);
    const nextState = reduce(
      before,
      RunEventSchema.parse({
        ...makeBaseAcceptedEvent(),
        kind: 'artifact_published',
        entityRef: { kind: 'artifact', artifactId: 'artifact-1' },
        payload: {
          artifactId: 'artifact-1',
          kind: 'final',
          mediaType: 'text/markdown',
          byteSize: 42,
        },
      }),
    );

    expect(nextState.sequence).toBe(0);
    expect(nextState.tasks).toEqual(before.tasks);
  });

  it('reduces request_rejected events as a sequence-only advance', () => {
    const before = initialState(teamContext);
    const nextState = reduce(
      before,
      RunEventSchema.parse({
        eventId: uuid('7'),
        runId: 'run-1',
        sequence: 0,
        timestamp: '2026-05-07T00:00:00.000Z',
        schemaVersion: '1.0',
        actor: { kind: 'manager' },
        requestId: uuid('13'),
        causationId: null,
        correlationId: null,
        entityRef: { kind: 'run', runId: 'run-1' },
        outcome: 'rejected',
        kind: 'request_rejected',
        payload: {
          rejectionReason: 'actor_not_authorized',
          rejectedRequestId: uuid('13'),
          detail: 'No.',
        },
      }),
    );

    expect(nextState.sequence).toBe(0);
    expect(nextState.acceptedRequestKeys).toEqual(before.acceptedRequestKeys);
    expect(nextState.status).toBe(before.status);
  });
});
