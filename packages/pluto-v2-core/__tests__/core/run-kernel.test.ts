import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import type { ReplayFixture, RequestRejectedEvent, RunEvent } from '../../src/index.js';
import {
  CANONICAL_AUTHORITY_POLICY,
  InMemoryEventLogStore,
  RunKernel,
  RunStateSchema,
  TeamContextSchema,
  counterIdProvider,
  fixedClockProvider,
  initialState,
  reduce,
} from '../../src/core/index.js';
import { SCHEMA_VERSION } from '../../src/versioning.js';

const uuid = (suffix: string) => `00000000-0000-4000-8000-${suffix.padStart(12, '0')}`;

function createTeamContext(
  initialTasks: Array<{
    taskId: string;
    title: string;
    ownerActor: { kind: 'role'; role: 'generator' | 'evaluator' } | null;
    dependsOn: string[];
  }> = [],
) {
  return TeamContextSchema.parse({
    runId: 'run-1',
    scenarioRef: 'scenario/hello-team',
    runProfileRef: 'fake-smoke',
    declaredActors: [
      { kind: 'manager' },
      { kind: 'role', role: 'lead' },
      { kind: 'role', role: 'planner' },
      { kind: 'role', role: 'generator' },
      { kind: 'role', role: 'evaluator' },
      { kind: 'system' },
      ],
      initialTasks,
      policy: CANONICAL_AUTHORITY_POLICY,
    });
}

function createKernel(initial = initialState(createTeamContext())) {
  return new RunKernel({
    initialState: initial,
    eventLog: new InMemoryEventLogStore(),
    idProvider: counterIdProvider(1),
    clockProvider: fixedClockProvider('2026-05-07T00:00:00.000Z'),
  });
}

function stripForFixtureComparison(event: RunEvent & { acceptedRequestKey?: string | null }) {
  const { acceptedRequestKey: _acceptedRequestKey, causationId: _causationId, ...rest } = event;
  return rest;
}

function expectRejectedEvent(event: RunEvent): RequestRejectedEvent {
  expect(event.kind).toBe('request_rejected');

  if (event.kind !== 'request_rejected') {
    throw new Error(`Expected request_rejected event, got ${event.kind}`);
  }

  return event;
}

function sequentialIdProvider(values: readonly string[]) {
  let index = 0;

  return {
    next() {
      const value = values[index];
      if (value === undefined) {
        throw new Error(`Missing id value at index ${index}`);
      }

      index += 1;
      return value;
    },
  };
}

function sequentialClockProvider(values: readonly string[]) {
  let index = 0;

  return {
    nowIso() {
      const value = values[index];
      if (value === undefined) {
        throw new Error(`Missing clock value at index ${index}`);
      }

      index += 1;
      return value;
    },
  };
}

describe('RunKernel', () => {
  it('accepts append_mailbox_message requests with deterministic providers', () => {
    const kernel = createKernel();

    const { event } = kernel.submit(
      {
        requestId: uuid('101'),
        runId: 'run-1',
        actor: { kind: 'manager' },
        intent: 'append_mailbox_message',
        payload: {
          fromActor: { kind: 'manager' },
          toActor: { kind: 'broadcast' },
          kind: 'plan',
          body: 'Plan the work.',
        },
        idempotencyKey: 'idem-1',
        clientTimestamp: '2026-05-07T00:00:00.000Z',
        schemaVersion: SCHEMA_VERSION,
      },
      { correlationId: 'corr-1' },
    );

    expect(event).toEqual({
      eventId: uuid('1'),
      runId: 'run-1',
      sequence: 0,
      timestamp: '2026-05-07T00:00:00.000Z',
      schemaVersion: '1.0',
      actor: { kind: 'manager' },
      requestId: uuid('101'),
      causationId: null,
      correlationId: 'corr-1',
      entityRef: { kind: 'mailbox_message', messageId: uuid('2') },
      outcome: 'accepted',
      kind: 'mailbox_message_appended',
      payload: {
        messageId: uuid('2'),
        fromActor: { kind: 'manager' },
        toActor: { kind: 'broadcast' },
        kind: 'plan',
        body: 'Plan the work.',
      },
      acceptedRequestKey: 'run-1|manager|append_mailbox_message|idem-1',
    });
  });

  it('seeds run_started as the first event and updates state to running', () => {
    const kernel = createKernel();

    const { event } = kernel.seedRunStarted(
      {
        scenarioRef: 'scenario/hello-team',
        runProfileRef: 'fake-smoke',
        startedAt: '2026-05-07T00:00:00.000Z',
      },
      { correlationId: 'corr-seed' },
    );

    expect(event).toEqual({
      eventId: uuid('1'),
      runId: 'run-1',
      sequence: 0,
      timestamp: '2026-05-07T00:00:00.000Z',
      schemaVersion: '1.0',
      actor: { kind: 'system' },
      requestId: null,
      causationId: null,
      correlationId: 'corr-seed',
      entityRef: { kind: 'run', runId: 'run-1' },
      outcome: 'accepted',
      kind: 'run_started',
      payload: {
        scenarioRef: 'scenario/hello-team',
        runProfileRef: 'fake-smoke',
        startedAt: '2026-05-07T00:00:00.000Z',
      },
    });
    expect(kernel.state.status).toBe('running');
    expect(kernel.state.sequence).toBe(0);
    expect(kernel.eventLog.read()).toEqual([event]);
  });

  it('rejects seeding run_started after the event log is non-empty', () => {
    const kernel = createKernel();

    kernel.seedRunStarted({
      scenarioRef: 'scenario/hello-team',
      runProfileRef: 'fake-smoke',
      startedAt: '2026-05-07T00:00:00.000Z',
    });

    expect(() =>
      kernel.seedRunStarted({
        scenarioRef: 'scenario/hello-team',
        runProfileRef: 'fake-smoke',
        startedAt: '2026-05-07T00:00:00.000Z',
      }),
    ).toThrow(/empty event log/);
  });

  it('accepts create_task requests with deterministic providers', () => {
    const kernel = createKernel();

    const { event } = kernel.submit({
      requestId: uuid('102'),
      runId: 'run-1',
      actor: { kind: 'manager' },
      intent: 'create_task',
      payload: {
        title: 'Write tests',
        ownerActor: { kind: 'role', role: 'generator' },
        dependsOn: [],
      },
      idempotencyKey: null,
      clientTimestamp: '2026-05-07T00:00:00.000Z',
      schemaVersion: SCHEMA_VERSION,
    });

    expect(event).toEqual({
      eventId: uuid('1'),
      runId: 'run-1',
      sequence: 0,
      timestamp: '2026-05-07T00:00:00.000Z',
      schemaVersion: '1.0',
      actor: { kind: 'manager' },
      requestId: uuid('102'),
      causationId: null,
      correlationId: null,
      entityRef: { kind: 'task', taskId: uuid('2') },
      outcome: 'accepted',
      kind: 'task_created',
      payload: {
        taskId: uuid('2'),
        title: 'Write tests',
        ownerActor: { kind: 'role', role: 'generator' },
        dependsOn: [],
      },
      acceptedRequestKey: null,
    });
  });

  it('accepts change_task_state requests with deterministic providers', () => {
    const kernel = createKernel(
      initialState(
        createTeamContext([
          { taskId: 'task-1', title: 'Owned task', ownerActor: { kind: 'role', role: 'generator' }, dependsOn: [] },
        ]),
      ),
    );

    const { event } = kernel.submit({
      requestId: uuid('103'),
      runId: 'run-1',
      actor: { kind: 'role', role: 'generator' },
      intent: 'change_task_state',
      payload: {
        taskId: 'task-1',
        to: 'running',
      },
      idempotencyKey: null,
      clientTimestamp: '2026-05-07T00:00:00.000Z',
      schemaVersion: SCHEMA_VERSION,
    });

    expect(event).toEqual({
      eventId: uuid('1'),
      runId: 'run-1',
      sequence: 0,
      timestamp: '2026-05-07T00:00:00.000Z',
      schemaVersion: '1.0',
      actor: { kind: 'role', role: 'generator' },
      requestId: uuid('103'),
      causationId: null,
      correlationId: null,
      entityRef: { kind: 'task', taskId: 'task-1' },
      outcome: 'accepted',
      kind: 'task_state_changed',
      payload: {
        taskId: 'task-1',
        from: 'queued',
        to: 'running',
      },
      acceptedRequestKey: null,
    });
  });

  it('accepts publish_artifact requests with deterministic providers', () => {
    const kernel = createKernel();

    const { event } = kernel.submit({
      requestId: uuid('104'),
      runId: 'run-1',
      actor: { kind: 'role', role: 'generator' },
      intent: 'publish_artifact',
      payload: {
        kind: 'final',
        mediaType: 'text/markdown',
        byteSize: 99,
      },
      idempotencyKey: null,
      clientTimestamp: '2026-05-07T00:00:00.000Z',
      schemaVersion: SCHEMA_VERSION,
    });

    expect(event).toEqual({
      eventId: uuid('1'),
      runId: 'run-1',
      sequence: 0,
      timestamp: '2026-05-07T00:00:00.000Z',
      schemaVersion: '1.0',
      actor: { kind: 'role', role: 'generator' },
      requestId: uuid('104'),
      causationId: null,
      correlationId: null,
      entityRef: { kind: 'artifact', artifactId: uuid('2') },
      outcome: 'accepted',
      kind: 'artifact_published',
      payload: {
        artifactId: uuid('2'),
        kind: 'final',
        mediaType: 'text/markdown',
        byteSize: 99,
      },
      acceptedRequestKey: null,
    });
  });

  it('accepts complete_run requests with deterministic providers', () => {
    const kernel = createKernel();

    const { event } = kernel.submit({
      requestId: uuid('105'),
      runId: 'run-1',
      actor: { kind: 'manager' },
      intent: 'complete_run',
      payload: {
        status: 'succeeded',
        summary: 'Done.',
      },
      idempotencyKey: null,
      clientTimestamp: '2026-05-07T00:00:00.000Z',
      schemaVersion: SCHEMA_VERSION,
    });

    expect(event).toEqual({
      eventId: uuid('1'),
      runId: 'run-1',
      sequence: 0,
      timestamp: '2026-05-07T00:00:00.000Z',
      schemaVersion: '1.0',
      actor: { kind: 'manager' },
      requestId: uuid('105'),
      causationId: null,
      correlationId: null,
      entityRef: { kind: 'run', runId: 'run-1' },
      outcome: 'accepted',
      kind: 'run_completed',
      payload: {
        status: 'succeeded',
        completedAt: '2026-05-07T00:00:00.000Z',
        summary: 'Done.',
      },
      acceptedRequestKey: null,
    });
  });

  it('rejects actor_not_authorized requests', () => {
    const kernel = createKernel();
    const { event } = kernel.submit({
      requestId: uuid('201'),
      runId: 'run-1',
      actor: { kind: 'role', role: 'lead' },
      intent: 'complete_run',
      payload: { status: 'succeeded', summary: 'Nope.' },
      idempotencyKey: null,
      clientTimestamp: '2026-05-07T00:00:00.000Z',
      schemaVersion: SCHEMA_VERSION,
    });

    const rejectedEvent = expectRejectedEvent(event);

    expect(rejectedEvent.payload.rejectionReason).toBe('actor_not_authorized');
  });

  it('rejects entity_unknown requests', () => {
    const kernel = createKernel();
    const { event } = kernel.submit({
      requestId: uuid('202'),
      runId: 'run-1',
      actor: { kind: 'manager' },
      intent: 'change_task_state',
      payload: { taskId: 'missing-task', to: 'running' },
      idempotencyKey: null,
      clientTimestamp: '2026-05-07T00:00:00.000Z',
      schemaVersion: SCHEMA_VERSION,
    });

    const rejectedEvent = expectRejectedEvent(event);

    expect(rejectedEvent.payload.rejectionReason).toBe('entity_unknown');
  });

  it('rejects state_conflict requests', () => {
    const state = RunStateSchema.parse({
      runId: 'run-1',
      sequence: -1,
      status: 'initialized',
      tasks: { 'task-1': { state: 'completed', ownerActor: { kind: 'role', role: 'generator' } } },
      acceptedRequestKeys: new Set<string>(),
      declaredActors: new Set(['manager', 'role:generator']),
      policy: CANONICAL_AUTHORITY_POLICY,
    });
    const kernel = createKernel(state);
    const { event } = kernel.submit({
      requestId: uuid('203'),
      runId: 'run-1',
      actor: { kind: 'manager' },
      intent: 'change_task_state',
      payload: { taskId: 'task-1', to: 'running' },
      idempotencyKey: null,
      clientTimestamp: '2026-05-07T00:00:00.000Z',
      schemaVersion: SCHEMA_VERSION,
    });

    const rejectedEvent = expectRejectedEvent(event);

    expect(rejectedEvent.payload.rejectionReason).toBe('state_conflict');
  });

  it('rejects idempotency_replay requests', () => {
    const state = RunStateSchema.parse({
      runId: 'run-1',
      sequence: -1,
      status: 'initialized',
      tasks: {},
      acceptedRequestKeys: new Set(['run-1|manager|append_mailbox_message|idem-1']),
      declaredActors: new Set(['manager']),
      policy: CANONICAL_AUTHORITY_POLICY,
    });
    const kernel = createKernel(state);
    const { event } = kernel.submit({
      requestId: uuid('204'),
      runId: 'run-1',
      actor: { kind: 'manager' },
      intent: 'append_mailbox_message',
      payload: {
        fromActor: { kind: 'manager' },
        toActor: { kind: 'broadcast' },
        kind: 'plan',
        body: 'Again.',
      },
      idempotencyKey: 'idem-1',
      clientTimestamp: '2026-05-07T00:00:00.000Z',
      schemaVersion: SCHEMA_VERSION,
    });

    const rejectedEvent = expectRejectedEvent(event);

    expect(rejectedEvent.payload.rejectionReason).toBe('idempotency_replay');
  });

  it('rejects malformed input as schema_invalid', () => {
    const kernel = createKernel();
    const { event } = kernel.submit({ garbage: true });

    const rejectedEvent = expectRejectedEvent(event);

    expect(rejectedEvent.payload.rejectionReason).toBe('schema_invalid');
    expect(rejectedEvent.payload.detail).toContain('Rejected request <unknown>:');
  });

  it('rejects unknown intents as intent_unknown', () => {
    const kernel = createKernel();
    const { event } = kernel.submit({
      requestId: uuid('206'),
      runId: 'run-1',
      actor: { kind: 'manager' },
      intent: 'unknown_intent',
      payload: {},
      idempotencyKey: null,
      clientTimestamp: '2026-05-07T00:00:00.000Z',
      schemaVersion: SCHEMA_VERSION,
    });

    const rejectedEvent = expectRejectedEvent(event);

    expect(rejectedEvent.payload.rejectionReason).toBe('intent_unknown');
  });

  it('continues after malformed input and accepts subsequent valid requests', () => {
    const kernel = createKernel();
    const first = kernel.submit({ garbage: true }).event;
    const second = kernel.submit({
      requestId: uuid('301'),
      runId: 'run-1',
      actor: { kind: 'manager' },
      intent: 'create_task',
      payload: {
        title: 'Valid after garbage',
        ownerActor: null,
        dependsOn: [],
      },
      idempotencyKey: null,
      clientTimestamp: '2026-05-07T00:00:00.000Z',
      schemaVersion: SCHEMA_VERSION,
    }).event;

    const rejectedEvent = expectRejectedEvent(first);

    expect(rejectedEvent.payload.rejectionReason).toBe('schema_invalid');
    expect(second.kind).toBe('task_created');
    expect(second.sequence).toBe(1);
  });

  it('matches the basic-run fixture request sequence compatibility contract', () => {
    const fixture = JSON.parse(
      readFileSync(new URL('../../test-fixtures/replay/basic-run.json', import.meta.url), 'utf8'),
    ) as ReplayFixture;
    const runStarted = fixture.events[0] as Extract<RunEvent, { kind: 'run_started' }>;
    const mailboxEvent = fixture.events[1] as Extract<RunEvent, { kind: 'mailbox_message_appended' }>;
    const taskCreatedEvent = fixture.events[2] as Extract<RunEvent, { kind: 'task_created' }>;
    const taskStateChangedEvent = fixture.events[3] as Extract<RunEvent, { kind: 'task_state_changed' }>;
    const runCompletedEvent = fixture.events[4] as Extract<RunEvent, { kind: 'run_completed' }>;

    const eventLog = new InMemoryEventLogStore();
    eventLog.append(runStarted);

    const kernel = new RunKernel({
      initialState: reduce(initialState(createTeamContext()), runStarted),
      eventLog,
      idProvider: sequentialIdProvider([
        mailboxEvent.eventId,
        mailboxEvent.payload.messageId,
        taskCreatedEvent.eventId,
        taskCreatedEvent.payload.taskId,
        taskStateChangedEvent.eventId,
        runCompletedEvent.eventId,
      ]),
      clockProvider: sequentialClockProvider([
        mailboxEvent.timestamp,
        taskCreatedEvent.timestamp,
        taskStateChangedEvent.timestamp,
        runCompletedEvent.timestamp,
      ]),
    });

    const actual = [
      kernel.submit(
        {
          requestId: mailboxEvent.requestId,
          runId: mailboxEvent.runId,
          actor: mailboxEvent.actor,
          intent: 'append_mailbox_message',
          payload: {
            fromActor: mailboxEvent.payload.fromActor,
            toActor: mailboxEvent.payload.toActor,
            kind: mailboxEvent.payload.kind,
            body: mailboxEvent.payload.body,
          },
          idempotencyKey: null,
          clientTimestamp: mailboxEvent.timestamp,
          schemaVersion: fixture.schemaVersion,
        },
        { correlationId: 'corr-1' },
      ).event,
      kernel.submit(
        {
          requestId: taskCreatedEvent.requestId,
          runId: taskCreatedEvent.runId,
          actor: taskCreatedEvent.actor,
          intent: 'create_task',
          payload: {
            title: taskCreatedEvent.payload.title,
            ownerActor: taskCreatedEvent.payload.ownerActor,
            dependsOn: taskCreatedEvent.payload.dependsOn,
          },
          idempotencyKey: null,
          clientTimestamp: taskCreatedEvent.timestamp,
          schemaVersion: fixture.schemaVersion,
        },
        { correlationId: 'corr-1' },
      ).event,
      kernel.submit(
        {
          requestId: taskStateChangedEvent.requestId,
          runId: taskStateChangedEvent.runId,
          actor: taskStateChangedEvent.actor,
          intent: 'change_task_state',
          payload: {
            taskId: taskStateChangedEvent.payload.taskId,
            to: taskStateChangedEvent.payload.to,
          },
          idempotencyKey: null,
          clientTimestamp: taskStateChangedEvent.timestamp,
          schemaVersion: fixture.schemaVersion,
        },
        { correlationId: 'corr-1' },
      ).event,
      kernel.submit(
        {
          requestId: runCompletedEvent.requestId,
          runId: runCompletedEvent.runId,
          actor: runCompletedEvent.actor,
          intent: 'complete_run',
          payload: {
            status: runCompletedEvent.payload.status,
            summary: runCompletedEvent.payload.summary,
          },
          idempotencyKey: null,
          clientTimestamp: runCompletedEvent.timestamp,
          schemaVersion: fixture.schemaVersion,
        },
        { correlationId: 'corr-1' },
      ).event,
    ];

    expect(actual.map(stripForFixtureComparison)).toEqual(
      [mailboxEvent, taskCreatedEvent, taskStateChangedEvent, runCompletedEvent].map((event) =>
        stripForFixtureComparison(event as RunEvent & { acceptedRequestKey?: string | null }),
      ),
    );
  });
});
