import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import {
  EvidenceProjectionViewStateSchema,
  MailboxProjectionViewStateSchema,
  ReplayFixtureSchema,
  TaskProjectionViewStateSchema,
  replayAll,
} from '../../src/index.js';

/*
run_started => task no-op, mailbox no-op, evidence citation "Run started." + pendingStartedAt
run_completed => task no-op, mailbox no-op, evidence citation "Run completed." + populate view.run + reset pendingStartedAt
mailbox_message_appended => task no-op, mailbox append dedup by messageId, evidence no-op
task_created => task insert queued dedup by taskId, mailbox no-op, evidence no-op
task_state_changed => task update + history dedup by eventId, mailbox no-op, evidence no-op
artifact_published => all no-op except evidence still no-op
request_rejected => all no-op
*/

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

const sortDeep = (value: unknown): unknown => {
  if (Array.isArray(value)) {
    return value.map(sortDeep);
  }

  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, nested]) => [key, sortDeep(nested)]),
    );
  }

  return value;
};

const stableJson = (value: unknown) => JSON.stringify(sortDeep(value));

describe('replayAll', () => {
  it('returns initial views for empty input and produced views parse through S1 schemas', () => {
    const views = replayAll([]);

    expect(TaskProjectionViewStateSchema.parse(views.task)).toEqual(views.task);
    expect(MailboxProjectionViewStateSchema.parse(views.mailbox)).toEqual(views.mailbox);
    expect(EvidenceProjectionViewStateSchema.parse(views.evidence)).toEqual(views.evidence);
    expect(views).toEqual({
      task: { tasks: {} },
      mailbox: { messages: [] },
      evidence: { run: null, citations: [] },
    });
  });

  it('matches the basic-run fixture expectedViews by direct deep-equal AND stable byte-equal JSON', () => {
    const views = replayAll(basicRunFixture.events);

    expect(views).toEqual(basicRunFixture.expectedViews);
    expect(stableJson(views)).toBe(stableJson(basicRunFixture.expectedViews));
  });

  it('is deterministic across repeated stable JSON serializations', () => {
    const first = stableJson(replayAll(basicRunFixture.events));
    const second = stableJson(replayAll(basicRunFixture.events));

    expect(first).toBe(second);
  });
});
