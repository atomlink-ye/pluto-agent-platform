import { describe, expect, it } from 'vitest';

import { ProtocolRequestSchema } from '../src/index.js';

const uuid = (suffix: string) => `00000000-0000-4000-8000-${suffix.padStart(12, '0')}`;

const base = {
  runId: 'run-1',
  actor: { kind: 'manager' },
  idempotencyKey: null,
  clientTimestamp: '2026-05-07T00:00:00.000Z',
  schemaVersion: '1.0',
} as const;

const requestCases = [
  {
    name: 'append_mailbox_message',
    request: {
      ...base,
      requestId: uuid('1'),
      intent: 'append_mailbox_message',
      payload: {
        fromActor: { kind: 'manager' } as const,
        toActor: { kind: 'role', role: 'planner' } as const,
        kind: 'plan',
        body: 'Please plan the work.',
      },
    },
  },
  {
    name: 'create_task',
    request: {
      ...base,
      requestId: uuid('2'),
      intent: 'create_task',
      payload: {
        title: 'Write tests',
        ownerActor: { kind: 'role', role: 'generator' } as const,
        dependsOn: [],
      },
    },
  },
  {
    name: 'change_task_state',
    request: {
      ...base,
      requestId: uuid('3'),
      intent: 'change_task_state',
      payload: {
        taskId: 'task-1',
        to: 'running',
      },
    },
  },
  {
    name: 'publish_artifact',
    request: {
      ...base,
      requestId: uuid('4'),
      intent: 'publish_artifact',
      payload: {
        kind: 'final',
        mediaType: 'text/markdown',
        byteSize: 100,
      },
    },
  },
  {
    name: 'complete_run',
    request: {
      ...base,
      requestId: uuid('5'),
      intent: 'complete_run',
      payload: {
        status: 'succeeded',
        summary: 'Done.',
      },
    },
  },
] as const;

describe('ProtocolRequestSchema', () => {
  it.each(requestCases)('parses $name requests', ({ request }) => {
    expect(ProtocolRequestSchema.parse(request)).toEqual(request);
  });

  it('rejects unknown_intent inputs', () => {
    expect(() =>
      ProtocolRequestSchema.parse({
        ...requestCases[0].request,
        intent: 'unknown_intent',
      }),
    ).toThrow();
  });

  it('rejects schema_invalid inputs with missing requestId', () => {
    const { requestId: _requestId, ...withoutRequestId } = requestCases[0].request;

    expect(() => ProtocolRequestSchema.parse(withoutRequestId)).toThrow();
  });
});
