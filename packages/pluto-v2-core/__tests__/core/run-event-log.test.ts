import { describe, expect, it } from 'vitest';

import { RunEventSchema } from '../../src/run-event.js';
import {
  CANONICAL_AUTHORITY_POLICY,
  DuplicateAppendError,
  InMemoryEventLogStore,
  SequenceGapError,
  TeamContextSchema,
  initialState,
  reduce,
} from '../../src/core/index.js';

const uuid = (suffix: string) => `00000000-0000-4000-8000-${suffix.padStart(12, '0')}`;

const teamContext = TeamContextSchema.parse({
  runId: 'run-1',
  scenarioRef: 'scenario/hello-team',
  runProfileRef: 'fake-smoke',
  declaredActors: [{ kind: 'manager' }, { kind: 'system' }],
  policy: CANONICAL_AUTHORITY_POLICY,
});

function makeEvent(sequence: number, eventIdSuffix: string) {
  return RunEventSchema.parse({
    eventId: uuid(eventIdSuffix),
    runId: 'run-1',
    sequence,
    timestamp: `2026-05-07T00:00:0${sequence}.000Z`,
    schemaVersion: '1.0',
    actor: sequence === 0 ? { kind: 'system' } : { kind: 'manager' },
    requestId: sequence === 0 ? null : uuid(`1${sequence}`),
    causationId: null,
    correlationId: null,
    entityRef: { kind: 'run', runId: 'run-1' },
    outcome: 'accepted',
    kind: sequence === 0 ? 'run_started' : 'run_completed',
    payload:
      sequence === 0
        ? {
            scenarioRef: 'scenario/hello-team',
            runProfileRef: 'fake-smoke',
            startedAt: '2026-05-07T00:00:00.000Z',
          }
        : {
            status: 'succeeded',
            completedAt: '2026-05-07T00:00:01.000Z',
            summary: 'Done.',
          },
  });
}

describe('InMemoryEventLogStore', () => {
  it('starts empty with head -1', () => {
    expect(new InMemoryEventLogStore().head).toBe(-1);
  });

  it('appends events when event.sequence === head + 1', () => {
    const log = new InMemoryEventLogStore();
    const event = makeEvent(0, '1');

    log.append(event);

    expect(log.head).toBe(0);
    expect(log.hasEventId(event.eventId)).toBe(true);
  });

  it('throws SequenceGapError on out-of-order append', () => {
    const log = new InMemoryEventLogStore();

    expect(() => log.append(makeEvent(1, '2'))).toThrowError(SequenceGapError);
  });

  it('throws DuplicateAppendError on duplicate event ids', () => {
    const log = new InMemoryEventLogStore();
    const first = makeEvent(0, '3');
    const duplicateId = makeEvent(1, '3');

    log.append(first);

    expect(() => log.append(duplicateId)).toThrowError(DuplicateAppendError);
  });

  it('read(0, head + 1) returns the full snapshot', () => {
    const log = new InMemoryEventLogStore();
    const first = makeEvent(0, '4');
    const second = makeEvent(1, '5');

    log.append(first);
    log.append(second);

    expect(log.read(0, log.head + 1)).toEqual([first, second]);
  });

  it('supports bounded reads and replay-equal state reconstruction', () => {
    const log = new InMemoryEventLogStore();
    const first = makeEvent(0, '6');
    const second = makeEvent(1, '7');

    log.append(first);
    log.append(second);

    expect(log.read(1, 2)).toEqual([second]);

    const liveState = reduce(reduce(initialState(teamContext), first), second);
    const replayState = log.read(0, log.head + 1).reduce(reduce, initialState(teamContext));

    expect(replayState).toEqual(liveState);
  });
});
