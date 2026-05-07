import { z } from 'zod';

import {
  EvidenceProjectionViewStateSchema,
  MailboxProjectionViewStateSchema,
  TaskProjectionViewStateSchema,
} from './projections.js';
import { RunEventSchema } from './run-event.js';
import { SupportedSchemaVersionSchema } from './versioning.js';
import type {
  EvidenceProjectionView,
  MailboxProjectionView,
  TaskProjectionView,
} from './projections.js';
import type { RunEvent } from './run-event.js';

export type ReplayFixtureExpectedViews = {
  task?: TaskProjectionView['view'];
  mailbox?: MailboxProjectionView['view'];
  evidence?: EvidenceProjectionView['view'];
};

export interface ReplayFixture {
  name: string;
  description: string;
  schemaVersion: string;
  events: RunEvent[];
  expectedViews: ReplayFixtureExpectedViews;
}

export const ReplayFixtureExpectedViewsSchema = z.object({
  task: TaskProjectionViewStateSchema.optional(),
  mailbox: MailboxProjectionViewStateSchema.optional(),
  evidence: EvidenceProjectionViewStateSchema.optional(),
});

export const ReplayFixtureSchema = z.object({
  name: z.string(),
  description: z.string(),
  schemaVersion: SupportedSchemaVersionSchema,
  events: z.array(RunEventSchema),
  expectedViews: ReplayFixtureExpectedViewsSchema,
});
