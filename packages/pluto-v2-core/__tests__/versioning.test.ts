import { describe, expect, it } from 'vitest';

import { RunEventSchema } from '../src/index.js';

const knownKindEvent = {
  eventId: '00000000-0000-4000-8000-000000000001',
  runId: 'run-1',
  sequence: 0,
  timestamp: '2026-05-07T00:00:00.000Z',
  schemaVersion: '1.1',
  actor: { kind: 'system' },
  requestId: null,
  causationId: null,
  correlationId: null,
  entityRef: { kind: 'run', runId: 'run-1' },
  outcome: 'accepted',
  kind: 'run_started',
  payload: {
    scenarioRef: 'scenario/hello-team',
    runProfileRef: 'fake-smoke',
    startedAt: '2026-05-07T00:00:00.000Z',
  },
};

describe('schema versioning policy', () => {
  it('parses future 1.x additive optional fields under a known event kind', () => {
    const parsed = RunEventSchema.parse({
      ...knownKindEvent,
      payload: {
        ...knownKindEvent.payload,
        futureOptionalPayloadField: 'allowed-by-1.x-policy',
      },
    });

    expect(parsed).toEqual(knownKindEvent);
    expect(parsed.payload).not.toHaveProperty('futureOptionalPayloadField');
  });

  it('rejects future 1.x event kinds because enum additions require a major bump', () => {
    expect(() =>
      RunEventSchema.parse({
        ...knownKindEvent,
        kind: 'approval_emitted',
      }),
    ).toThrow();
  });

  it('rejects schemaVersion 2.0 without a migrator', () => {
    expect(() =>
      RunEventSchema.parse({
        ...knownKindEvent,
        schemaVersion: '2.0',
      }),
    ).toThrow();
  });
});
