import { describe, expect, it } from 'vitest';

import {
  REJECTION_REASON_VALUES,
  RejectedRunEventSchema,
  RunEventSchema,
  type RejectionReason,
} from '../src/index.js';

const uuid = (suffix: string) => `00000000-0000-4000-8000-${suffix.padStart(12, '0')}`;

const requestRejectedEvent = (reason: RejectionReason, index: number) => ({
  eventId: uuid(String(100 + index)),
  runId: 'run-1',
  sequence: index,
  timestamp: '2026-05-07T00:00:00.000Z',
  schemaVersion: '1.0',
  actor: { kind: 'manager' },
  requestId: uuid(String(200 + index)),
  causationId: null,
  correlationId: 'corr-rejected',
  entityRef: { kind: 'run', runId: 'run-1' },
  outcome: 'rejected',
  kind: 'request_rejected',
  payload: {
    rejectionReason: reason,
    rejectedRequestId: uuid(String(300 + index)),
    detail: `Rejected because ${reason}`,
  },
});

describe('request_rejected taxonomy reachability', () => {
  it.each(REJECTION_REASON_VALUES)('parses request_rejected for %s', (reason) => {
    const event = requestRejectedEvent(reason, REJECTION_REASON_VALUES.indexOf(reason));

    expect(RunEventSchema.parse(event)).toEqual(event);
    expect(RejectedRunEventSchema.parse(event)).toEqual(event);
  });
});
