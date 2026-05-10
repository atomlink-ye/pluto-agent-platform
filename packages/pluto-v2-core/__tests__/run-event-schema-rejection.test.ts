import { describe, expect, it } from 'vitest';

import { RunEventSchema } from '../src/index.js';

const validTaskCreated = {
  eventId: '00000000-0000-4000-8000-000000000001',
  runId: 'run-1',
  sequence: 0,
  timestamp: '2026-05-07T00:00:00.000Z',
  schemaVersion: '1.0',
  actor: { kind: 'manager' },
  requestId: '00000000-0000-4000-8000-000000000002',
  causationId: null,
  correlationId: null,
  entityRef: { kind: 'task', taskId: 'task-1' },
  outcome: 'accepted',
  kind: 'task_created',
  payload: {
    taskId: 'task-1',
    title: 'Implement contracts',
    ownerActor: null,
    dependsOn: [],
  },
};

const validRequestRejected = {
  eventId: '00000000-0000-4000-8000-000000000011',
  runId: 'run-1',
  sequence: 1,
  timestamp: '2026-05-07T00:01:00.000Z',
  schemaVersion: '1.0',
  actor: { kind: 'manager' },
  requestId: '00000000-0000-4000-8000-000000000012',
  causationId: null,
  correlationId: null,
  entityRef: { kind: 'run', runId: 'run-1' },
  outcome: 'rejected',
  kind: 'request_rejected',
  payload: {
    rejectionReason: 'schema_invalid',
    rejectedRequestId: '00000000-0000-4000-8000-000000000013',
    detail: 'invalid request payload',
  },
} as const;

describe('RunEventSchema structural rejection', () => {
  it('rejects a missing required field (runId)', () => {
    const { runId: _runId, ...withoutRunId } = validTaskCreated;

    expect(() => RunEventSchema.parse(withoutRunId)).toThrow();
  });

  it('rejects invalid-format actor roles', () => {
    expect(() =>
      RunEventSchema.parse({
        ...validTaskCreated,
        actor: { kind: 'role', role: 'Admin' },
      }),
    ).toThrow();
  });

  it('rejects out-of-enum entityRef kinds', () => {
    expect(() =>
      RunEventSchema.parse({
        ...validTaskCreated,
        entityRef: { kind: 'approval', approvalId: 'approval-1' },
      }),
    ).toThrow();
  });

  it('rejects mismatched outcome/kind discriminators', () => {
    expect(() =>
      RunEventSchema.parse({
        ...validTaskCreated,
        outcome: 'rejected',
        kind: 'mailbox_message_appended',
      }),
    ).toThrow();
  });

  it('rejects out-of-enum RunEvent kinds', () => {
    expect(() =>
      RunEventSchema.parse({
        ...validTaskCreated,
        kind: 'approval_emitted',
      }),
    ).toThrow();
  });

  it('rejects out-of-enum rejection reasons', () => {
    expect(() =>
      RunEventSchema.parse({
        ...validRequestRejected,
        payload: {
          ...validRequestRejected.payload,
          rejectionReason: 'budget_exceeded',
        },
      }),
    ).toThrow();
  });
});
