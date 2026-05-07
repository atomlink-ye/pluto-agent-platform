import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import {
  EvidenceProjectionViewStateSchema,
  InMemoryEventLogStore,
  MailboxProjectionViewStateSchema,
  ReplayFixtureSchema,
  TaskProjectionViewStateSchema,
  replayAll,
  replayFromStore,
  type EventLogStore,
  type RunEvent,
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

const parseReplayViews = (views: ReturnType<typeof replayAll>) => {
  expect(TaskProjectionViewStateSchema.parse(views.task)).toEqual(views.task);
  expect(MailboxProjectionViewStateSchema.parse(views.mailbox)).toEqual(views.mailbox);
  expect(EvidenceProjectionViewStateSchema.parse(views.evidence)).toEqual(views.evidence);
};

describe('replayFromStore', () => {
  it('calls store.read() and replays those events', () => {
    let readCount = 0;

    const store: EventLogStore = {
      head: basicRunFixture.events.length - 1,
      append: () => {
        throw new Error('append should not be called');
      },
      read: () => {
        readCount += 1;
        return basicRunFixture.events as readonly RunEvent[];
      },
      hasEventId: () => false,
    };

    const views = replayFromStore(store);

    parseReplayViews(views);
    expect(readCount).toBe(1);
    expect(views).toEqual(replayAll(basicRunFixture.events));
  });

  it('matches replayAll after an InMemoryEventLogStore round-trip', () => {
    const store = new InMemoryEventLogStore();

    for (const event of basicRunFixture.events) {
      store.append(event);
    }

    const fromStore = replayFromStore(store);
    const fromArray = replayAll(basicRunFixture.events);

    parseReplayViews(fromStore);
    expect(fromStore).toEqual(fromArray);
  });

  it('returns the same initial views as replayAll for an empty store', () => {
    const store = new InMemoryEventLogStore();

    const fromStore = replayFromStore(store);
    const fromArray = replayAll([]);

    parseReplayViews(fromStore);
    expect(fromStore).toEqual(fromArray);
  });
});
