import type { EventLogStore } from '../core/run-event-log.js';
import type {
  EvidenceProjectionView,
  MailboxProjectionView,
  TaskProjectionView,
} from '../projections.js';
import type { RunEvent } from '../run-event.js';
import { replayEvidence } from './evidence-projection.js';
import { replayMailbox } from './mailbox-projection.js';
import { replayTask } from './task-projection.js';

export type ReplayViews = {
  task: TaskProjectionView['view'];
  mailbox: MailboxProjectionView['view'];
  evidence: EvidenceProjectionView['view'];
};

export const replayAll = (events: readonly RunEvent[]): ReplayViews => ({
  task: replayTask(events),
  mailbox: replayMailbox(events),
  evidence: replayEvidence(events),
});

export const replayFromStore = (store: EventLogStore): ReplayViews => replayAll(store.read());
