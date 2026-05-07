import type { RunEvent } from '../run-event.js';

export interface EventLogStore {
  /** Highest sequence stored, or -1 when empty. Sync because in-memory only in S2. */
  readonly head: number;
  /** Append must be called with event.sequence === head + 1, else throws SequenceGapError. */
  append(event: RunEvent): void;
  /** Read events with sequence in [from, to). `to` defaults to head+1. Returns a snapshot. */
  read(from?: number, to?: number): readonly RunEvent[];
  /** Lookup by eventId; throws DuplicateAppendError if the same eventId appears twice in append. */
  hasEventId(eventId: string): boolean;
}

export class SequenceGapError extends Error {
  readonly expectedSequence: number;
  readonly actualSequence: number;

  constructor(expectedSequence: number, actualSequence: number) {
    super(`Expected event sequence ${expectedSequence}, received ${actualSequence}.`);
    this.name = 'SequenceGapError';
    this.expectedSequence = expectedSequence;
    this.actualSequence = actualSequence;
  }
}

export class DuplicateAppendError extends Error {
  readonly eventId: string;

  constructor(eventId: string) {
    super(`Event ${eventId} is already present in the log.`);
    this.name = 'DuplicateAppendError';
    this.eventId = eventId;
  }
}

export class InMemoryEventLogStore implements EventLogStore {
  readonly #events: RunEvent[] = [];
  readonly #eventIds = new Set<string>();

  get head(): number {
    return this.#events.length - 1;
  }

  append(event: RunEvent): void {
    if (this.#eventIds.has(event.eventId)) {
      throw new DuplicateAppendError(event.eventId);
    }

    const expectedSequence = this.head + 1;

    if (event.sequence !== expectedSequence) {
      throw new SequenceGapError(expectedSequence, event.sequence);
    }

    this.#events.push(event);
    this.#eventIds.add(event.eventId);
  }

  read(from = 0, to = this.head + 1): readonly RunEvent[] {
    return this.#events.slice(from, to);
  }

  hasEventId(eventId: string): boolean {
    return this.#eventIds.has(eventId);
  }
}
