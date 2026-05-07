import { describe, expect, it } from 'vitest';

import { AcceptedRunEventSchema, RunEventSchema } from '../src/index.js';

const uuid = (suffix: string) => `00000000-0000-4000-8000-${suffix.padStart(12, '0')}`;

const baseAcceptedEvent = {
  runId: 'run-1',
  timestamp: '2026-05-07T00:00:00.000Z',
  schemaVersion: '1.0',
  actor: { kind: 'manager' },
  requestId: uuid('10'),
  causationId: null,
  correlationId: 'corr-1',
  outcome: 'accepted',
} as const;

const acceptedEventCases = [
  {
    name: 'run_started',
    event: {
      ...baseAcceptedEvent,
      eventId: uuid('1'),
      sequence: 0,
      actor: { kind: 'system' } as const,
      requestId: null,
      kind: 'run_started',
      entityRef: { kind: 'run', runId: 'run-1' } as const,
      payload: {
        scenarioRef: 'scenario/hello-team',
        runProfileRef: 'fake-smoke',
        startedAt: '2026-05-07T00:00:00.000Z',
      },
    },
  },
  {
    name: 'run_completed',
    event: {
      ...baseAcceptedEvent,
      eventId: uuid('2'),
      sequence: 5,
      kind: 'run_completed',
      entityRef: { kind: 'run', runId: 'run-1' } as const,
      payload: {
        status: 'succeeded',
        completedAt: '2026-05-07T00:05:00.000Z',
        summary: 'Run completed.',
      },
    },
  },
  {
    name: 'mailbox_message_appended',
    event: {
      ...baseAcceptedEvent,
      eventId: uuid('3'),
      sequence: 1,
      kind: 'mailbox_message_appended',
      entityRef: { kind: 'mailbox_message', messageId: 'msg-1' } as const,
      payload: {
        messageId: 'msg-1',
        fromActor: { kind: 'manager' } as const,
        toActor: { kind: 'role', role: 'planner' } as const,
        kind: 'plan',
        body: 'Plan body',
      },
    },
  },
  {
    name: 'task_created',
    event: {
      ...baseAcceptedEvent,
      eventId: uuid('4'),
      sequence: 2,
      kind: 'task_created',
      entityRef: { kind: 'task', taskId: 'task-1' } as const,
      payload: {
        taskId: 'task-1',
        title: 'Implement fixture',
        ownerActor: { kind: 'role', role: 'generator' } as const,
        dependsOn: [],
      },
    },
  },
  {
    name: 'task_state_changed',
    event: {
      ...baseAcceptedEvent,
      eventId: uuid('5'),
      sequence: 3,
      kind: 'task_state_changed',
      entityRef: { kind: 'task', taskId: 'task-1' } as const,
      payload: {
        taskId: 'task-1',
        from: 'queued',
        to: 'running',
      },
    },
  },
  {
    name: 'artifact_published',
    event: {
      ...baseAcceptedEvent,
      eventId: uuid('6'),
      sequence: 4,
      kind: 'artifact_published',
      entityRef: { kind: 'artifact', artifactId: 'artifact-1' } as const,
      payload: {
        artifactId: 'artifact-1',
        kind: 'final',
        mediaType: 'text/markdown',
        byteSize: 42,
      },
    },
  },
] as const;

describe('RunEventSchema', () => {
  it.each(acceptedEventCases)('round-trips accepted $name events', ({ event }) => {
    expect(RunEventSchema.parse(event)).toEqual(event);
    expect(AcceptedRunEventSchema.parse(event)).toEqual(event);
  });
});
