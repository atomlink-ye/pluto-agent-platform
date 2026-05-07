import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import {
  ArtifactPublishedEventSchema,
  MailboxMessageAppendedEventSchema,
  MailboxProjectionViewStateSchema,
  ReplayFixtureSchema,
  RequestRejectedEventSchema,
  RunCompletedEventSchema,
  RunStartedEventSchema,
  TaskCreatedEventSchema,
  TaskStateChangedEventSchema,
  initialMailboxState,
  mailboxReducer,
  replayMailbox,
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

const parseMailboxView = (view: unknown) => MailboxProjectionViewStateSchema.parse(view);

const createMailboxMessageEvent = (overrides: Partial<Record<string, unknown>> = {}) =>
  MailboxMessageAppendedEventSchema.parse({
    eventId: '00000000-0000-4000-8000-000000000301',
    runId: 'run-mailbox',
    sequence: 0,
    timestamp: '2026-05-07T11:00:00.000Z',
    schemaVersion: '1.0',
    actor: { kind: 'manager' },
    requestId: '00000000-0000-4000-8000-000000000311',
    causationId: null,
    correlationId: 'corr-mailbox',
    entityRef: { kind: 'mailbox_message', messageId: 'msg-1' },
    outcome: 'accepted',
    kind: 'mailbox_message_appended',
    payload: {
      messageId: 'msg-1',
      fromActor: { kind: 'manager' },
      toActor: { kind: 'broadcast' },
      kind: 'plan',
      body: 'Plan the implementation.',
    },
    ...overrides,
  });

const createRunStartedEvent = () =>
  RunStartedEventSchema.parse({
    eventId: '00000000-0000-4000-8000-000000000302',
    runId: 'run-mailbox',
    sequence: 1,
    timestamp: '2026-05-07T11:01:00.000Z',
    schemaVersion: '1.0',
    actor: { kind: 'system' },
    requestId: null,
    causationId: null,
    correlationId: null,
    entityRef: { kind: 'run', runId: 'run-mailbox' },
    outcome: 'accepted',
    kind: 'run_started',
    payload: {
      scenarioRef: 'scenario/mailbox',
      runProfileRef: 'fake-smoke',
      startedAt: '2026-05-07T11:01:00.000Z',
    },
  });

const createRunCompletedEvent = () =>
  RunCompletedEventSchema.parse({
    eventId: '00000000-0000-4000-8000-000000000303',
    runId: 'run-mailbox',
    sequence: 2,
    timestamp: '2026-05-07T11:02:00.000Z',
    schemaVersion: '1.0',
    actor: { kind: 'manager' },
    requestId: '00000000-0000-4000-8000-000000000313',
    causationId: null,
    correlationId: 'corr-mailbox',
    entityRef: { kind: 'run', runId: 'run-mailbox' },
    outcome: 'accepted',
    kind: 'run_completed',
    payload: {
      status: 'succeeded',
      completedAt: '2026-05-07T11:02:00.000Z',
      summary: 'Done.',
    },
  });

const createTaskCreatedEvent = () =>
  TaskCreatedEventSchema.parse({
    eventId: '00000000-0000-4000-8000-000000000304',
    runId: 'run-mailbox',
    sequence: 3,
    timestamp: '2026-05-07T11:03:00.000Z',
    schemaVersion: '1.0',
    actor: { kind: 'manager' },
    requestId: '00000000-0000-4000-8000-000000000314',
    causationId: null,
    correlationId: 'corr-mailbox',
    entityRef: { kind: 'task', taskId: 'task-1' },
    outcome: 'accepted',
    kind: 'task_created',
    payload: {
      taskId: 'task-1',
      title: 'Task',
      ownerActor: null,
      dependsOn: [],
    },
  });

const createTaskStateChangedEvent = () =>
  TaskStateChangedEventSchema.parse({
    eventId: '00000000-0000-4000-8000-000000000305',
    runId: 'run-mailbox',
    sequence: 4,
    timestamp: '2026-05-07T11:04:00.000Z',
    schemaVersion: '1.0',
    actor: { kind: 'role', role: 'generator' },
    requestId: '00000000-0000-4000-8000-000000000315',
    causationId: null,
    correlationId: 'corr-mailbox',
    entityRef: { kind: 'task', taskId: 'task-1' },
    outcome: 'accepted',
    kind: 'task_state_changed',
    payload: {
      taskId: 'task-1',
      from: 'queued',
      to: 'running',
    },
  });

const createArtifactPublishedEvent = () =>
  ArtifactPublishedEventSchema.parse({
    eventId: '00000000-0000-4000-8000-000000000306',
    runId: 'run-mailbox',
    sequence: 5,
    timestamp: '2026-05-07T11:05:00.000Z',
    schemaVersion: '1.0',
    actor: { kind: 'manager' },
    requestId: '00000000-0000-4000-8000-000000000316',
    causationId: null,
    correlationId: 'corr-mailbox',
    entityRef: { kind: 'artifact', artifactId: 'artifact-1' },
    outcome: 'accepted',
    kind: 'artifact_published',
    payload: {
      artifactId: 'artifact-1',
      kind: 'intermediate',
      mediaType: 'application/json',
      byteSize: 42,
    },
  });

const createRequestRejectedEvent = () =>
  RequestRejectedEventSchema.parse({
    eventId: '00000000-0000-4000-8000-000000000307',
    runId: 'run-mailbox',
    sequence: 6,
    timestamp: '2026-05-07T11:06:00.000Z',
    schemaVersion: '1.0',
    actor: { kind: 'manager' },
    requestId: '00000000-0000-4000-8000-000000000317',
    causationId: null,
    correlationId: 'corr-mailbox',
    entityRef: { kind: 'mailbox_message', messageId: 'msg-2' },
    outcome: 'rejected',
    kind: 'request_rejected',
    payload: {
      rejectionReason: 'schema_invalid',
      rejectedRequestId: '00000000-0000-4000-8000-000000000417',
      detail: 'Rejected.',
    },
  });

describe('mailbox projection', () => {
  it('replays mailbox_message_appended into the mailbox view', () => {
    const view = replayMailbox([createMailboxMessageEvent()]);

    expect(parseMailboxView(view)).toEqual(view);
    expect(view).toEqual({
      messages: [
        {
          messageId: 'msg-1',
          fromActor: { kind: 'manager' },
          toActor: { kind: 'broadcast' },
          kind: 'plan',
          body: 'Plan the implementation.',
          sequence: 0,
          eventId: '00000000-0000-4000-8000-000000000301',
        },
      ],
    });
  });

  it('dedups duplicate mailbox messages by messageId', () => {
    const first = createMailboxMessageEvent();
    const duplicate = createMailboxMessageEvent({
      eventId: '00000000-0000-4000-8000-000000000308',
      sequence: 1,
      requestId: '00000000-0000-4000-8000-000000000318',
      payload: {
        messageId: 'msg-1',
        fromActor: { kind: 'role', role: 'planner' },
        toActor: { kind: 'broadcast' },
        kind: 'task',
        body: 'Should not append.',
      },
    });

    const view = replayMailbox([first, duplicate]);

    expect(parseMailboxView(view)).toEqual(view);
    expect(view.messages).toHaveLength(1);
    expect(view.messages[0]?.body).toBe('Plan the implementation.');
  });

  it('preserves append order and sequence values', () => {
    const first = createMailboxMessageEvent();
    const second = createMailboxMessageEvent({
      eventId: '00000000-0000-4000-8000-000000000309',
      sequence: 7,
      requestId: '00000000-0000-4000-8000-000000000319',
      entityRef: { kind: 'mailbox_message', messageId: 'msg-2' },
      payload: {
        messageId: 'msg-2',
        fromActor: { kind: 'role', role: 'planner' },
        toActor: { kind: 'role', role: 'generator' },
        kind: 'task',
        body: 'Implement it.',
      },
    });

    const view = replayMailbox([first, second]);

    expect(parseMailboxView(view)).toEqual(view);
    expect(view.messages.map((message) => message.messageId)).toEqual(['msg-1', 'msg-2']);
    expect(view.messages.map((message) => message.sequence)).toEqual([0, 7]);
  });

  it('treats out-of-input kinds as no-ops', () => {
    const view = replayMailbox([
      createRunStartedEvent(),
      createRunCompletedEvent(),
      createTaskCreatedEvent(),
      createTaskStateChangedEvent(),
      createArtifactPublishedEvent(),
      createRequestRejectedEvent(),
    ]);

    expect(parseMailboxView(view)).toEqual(view);
    expect(view).toEqual(initialMailboxState.view);
  });

  it('matches reducer folding and the basic-run fixture mailbox view', () => {
    const reduced = basicRunFixture.events.reduce(mailboxReducer, initialMailboxState).view;
    const replayed = replayMailbox(basicRunFixture.events);

    expect(parseMailboxView(replayed)).toEqual(replayed);
    expect(replayed).toEqual(reduced);
    expect(replayed).toEqual(basicRunFixture.expectedViews.mailbox);
  });

  it('returns the initial parseable view for empty input', () => {
    const view = replayMailbox([]);

    expect(parseMailboxView(view)).toEqual(view);
    expect(view).toEqual({ messages: [] });
  });
});
