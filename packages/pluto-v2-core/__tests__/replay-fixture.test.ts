import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import {
  EvidenceProjectionViewStateSchema,
  MailboxProjectionViewStateSchema,
  ReplayFixtureSchema,
  TaskProjectionViewStateSchema,
} from '../src/index.js';

const fixtureDir = join(
  dirname(fileURLToPath(import.meta.url)),
  '..',
  'test-fixtures',
  'replay',
);

describe('replay fixtures', () => {
  it('parses hand-written replay fixture JSON and expected view schemas', () => {
    const fixtureFiles = readdirSync(fixtureDir).filter((file) => file.endsWith('.json'));

    expect(fixtureFiles.length).toBeGreaterThanOrEqual(1);

    for (const fixtureFile of fixtureFiles) {
      const fixture = JSON.parse(readFileSync(join(fixtureDir, fixtureFile), 'utf8')) as unknown;
      const parsed = ReplayFixtureSchema.parse(fixture);

      expect(parsed.events.length).toBeLessThanOrEqual(20);

      if (parsed.expectedViews.task) {
        expect(TaskProjectionViewStateSchema.parse(parsed.expectedViews.task)).toEqual(
          parsed.expectedViews.task,
        );
      }
      if (parsed.expectedViews.mailbox) {
        expect(MailboxProjectionViewStateSchema.parse(parsed.expectedViews.mailbox)).toEqual(
          parsed.expectedViews.mailbox,
        );
      }
      if (parsed.expectedViews.evidence) {
        expect(EvidenceProjectionViewStateSchema.parse(parsed.expectedViews.evidence)).toEqual(
          parsed.expectedViews.evidence,
        );
      }
    }
  });
});
