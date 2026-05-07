import { describe, expect, it } from 'vitest';

import { ProtocolRequestSchema } from '../../src/protocol-request.js';
import { SCHEMA_VERSION } from '../../src/versioning.js';
import {
  AUTHORITY_MATRIX,
  RunKernel,
  TeamContextSchema,
  composeRequestKey,
  fixedClockProvider,
  counterIdProvider,
  initialState,
  validate,
} from '../../src/core/index.js';

const uuid = (suffix: string) => `00000000-0000-4000-8000-${suffix.padStart(12, '0')}`;

const baseTeamContext = TeamContextSchema.parse({
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
  initialTasks: [
    { taskId: 'task-owned-generator', title: 'Generator task', ownerActor: { kind: 'role', role: 'generator' }, dependsOn: [] },
    { taskId: 'task-completed', title: 'Completed task', ownerActor: { kind: 'role', role: 'generator' }, dependsOn: [] },
  ],
  policy: AUTHORITY_MATRIX,
});

const baseState = (() => {
  const state = initialState(baseTeamContext);
  state.tasks['task-completed'] = { state: 'completed', ownerActor: { kind: 'role', role: 'generator' } };
  return state;
})();

const requestBase = {
  runId: 'run-1',
  idempotencyKey: null,
  clientTimestamp: '2026-05-07T00:00:00.000Z',
  schemaVersion: SCHEMA_VERSION,
} as const;

function createKernel() {
  return new RunKernel({
    initialState: initialState(baseTeamContext),
    idProvider: counterIdProvider(1),
    clockProvider: fixedClockProvider('2026-05-07T00:00:00.000Z'),
  });
}

describe('validate', () => {
  it('accepts append_mailbox_message requests', () => {
    const request = ProtocolRequestSchema.parse({
      ...requestBase,
      requestId: uuid('1'),
      actor: { kind: 'role', role: 'planner' },
      intent: 'append_mailbox_message',
      payload: {
        fromActor: { kind: 'role', role: 'planner' },
        toActor: { kind: 'broadcast' },
        kind: 'plan',
        body: 'Plan the work.',
      },
    });

    expect(validate(baseState, request)).toEqual({ ok: true });
  });

  it('accepts create_task requests', () => {
    const request = ProtocolRequestSchema.parse({
      ...requestBase,
      requestId: uuid('2'),
      actor: { kind: 'manager' },
      intent: 'create_task',
      payload: {
        title: 'New task',
        ownerActor: { kind: 'role', role: 'generator' },
        dependsOn: [],
      },
    });

    expect(validate(baseState, request)).toEqual({ ok: true });
  });

  it('accepts change_task_state requests', () => {
    const request = ProtocolRequestSchema.parse({
      ...requestBase,
      requestId: uuid('3'),
      actor: { kind: 'role', role: 'generator' },
      intent: 'change_task_state',
      payload: {
        taskId: 'task-owned-generator',
        to: 'running',
      },
    });

    expect(validate(baseState, request)).toEqual({ ok: true });
  });

  it('accepts publish_artifact requests', () => {
    const request = ProtocolRequestSchema.parse({
      ...requestBase,
      requestId: uuid('4'),
      actor: { kind: 'role', role: 'generator' },
      intent: 'publish_artifact',
      payload: {
        kind: 'final',
        mediaType: 'text/markdown',
        byteSize: 64,
      },
    });

    expect(validate(baseState, request)).toEqual({ ok: true });
  });

  it('accepts complete_run requests', () => {
    const request = ProtocolRequestSchema.parse({
      ...requestBase,
      requestId: uuid('5'),
      actor: { kind: 'manager' },
      intent: 'complete_run',
      payload: {
        status: 'succeeded',
        summary: 'Done.',
      },
    });

    expect(validate(baseState, request)).toEqual({ ok: true });
  });

  it('rejects actor_not_authorized requests', () => {
    const request = ProtocolRequestSchema.parse({
      ...requestBase,
      requestId: uuid('6'),
      actor: { kind: 'role', role: 'evaluator' },
      intent: 'create_task',
      payload: {
        title: 'Not allowed',
        ownerActor: null,
        dependsOn: [],
      },
    });

    expect(validate(baseState, request)).toEqual({
      ok: false,
      reason: 'actor_not_authorized',
      detail: 'Actor is not authorized for create_task.',
    });
  });

  it('rejects entity_unknown requests', () => {
    const request = ProtocolRequestSchema.parse({
      ...requestBase,
      requestId: uuid('7'),
      actor: { kind: 'manager' },
      intent: 'create_task',
      payload: {
        title: 'Task with missing dependency',
        ownerActor: null,
        dependsOn: ['missing-task'],
      },
    });

    expect(validate(baseState, request)).toEqual({
      ok: false,
      reason: 'entity_unknown',
      detail: 'Task dependencies are unknown: missing-task.',
    });
  });

  it('rejects state_conflict requests', () => {
    const request = ProtocolRequestSchema.parse({
      ...requestBase,
      requestId: uuid('8'),
      actor: { kind: 'manager' },
      intent: 'change_task_state',
      payload: {
        taskId: 'task-completed',
        to: 'running',
      },
    });

    expect(validate(baseState, request)).toEqual({
      ok: false,
      reason: 'state_conflict',
      detail: 'Transition completed -> running is not legal for task task-completed.',
    });
  });

  it('rejects idempotency_replay requests', () => {
    const request = ProtocolRequestSchema.parse({
      ...requestBase,
      requestId: uuid('9'),
      actor: { kind: 'manager' },
      intent: 'append_mailbox_message',
      idempotencyKey: 'idem-1',
      payload: {
        fromActor: { kind: 'manager' },
        toActor: { kind: 'broadcast' },
        kind: 'plan',
        body: 'Repeat plan.',
      },
    });
    const replayState = {
      ...baseState,
      acceptedRequestKeys: new Set([
        composeRequestKey('run-1', { kind: 'manager' }, 'append_mailbox_message', 'idem-1')!,
      ]),
    };

    expect(validate(replayState, request)).toEqual({
      ok: false,
      reason: 'idempotency_replay',
      detail: 'Request key run-1|manager|append_mailbox_message|idem-1 was already accepted.',
    });
  });

  it('rejects schema_invalid input at the parse boundary before validate runs', () => {
    const event = createKernel().submit({ garbage: true }).event;

    expect(event.kind).toBe('request_rejected');
    if (event.kind !== 'request_rejected') {
      throw new Error(`Expected request_rejected event, received ${event.kind}.`);
    }
    expect(event.payload.rejectionReason).toBe('schema_invalid');
  });

  it('rejects intent_unknown input at the parse boundary before validate runs', () => {
    const event = createKernel().submit({
      requestId: uuid('10'),
      runId: 'run-1',
      actor: { kind: 'manager' },
      intent: 'unknown_intent',
      payload: {},
      idempotencyKey: null,
      clientTimestamp: '2026-05-07T00:00:00.000Z',
      schemaVersion: '1.0',
    }).event;

    expect(event.kind).toBe('request_rejected');
    if (event.kind !== 'request_rejected') {
      throw new Error(`Expected request_rejected event, received ${event.kind}.`);
    }
    expect(event.payload.rejectionReason).toBe('intent_unknown');
  });

  it('prefers actor_not_authorized over state_conflict when both apply', () => {
    const request = ProtocolRequestSchema.parse({
      ...requestBase,
      requestId: uuid('11'),
      actor: { kind: 'role', role: 'evaluator' },
      intent: 'change_task_state',
      payload: {
        taskId: 'task-completed',
        to: 'running',
      },
    });

    expect(validate(baseState, request)).toEqual({
      ok: false,
      reason: 'actor_not_authorized',
      detail: 'Actor is not authorized for change_task_state.',
    });
  });
});
