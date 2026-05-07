import type { MailboxProjectionView } from '../projections.js';
import type { RunEvent } from '../run-event.js';

export type MailboxReducerState = {
  view: MailboxProjectionView['view'];
  seenMessageIds: ReadonlySet<string>;
};

export const initialMailboxState: MailboxReducerState = {
  view: {
    messages: [],
  },
  seenMessageIds: new Set(),
};

export const mailboxReducer = (
  state: MailboxReducerState,
  event: RunEvent,
): MailboxReducerState => {
  switch (event.kind) {
    case 'mailbox_message_appended': {
      const { messageId, fromActor, toActor, kind, body } = event.payload;

      if (state.seenMessageIds.has(messageId)) {
        return state;
      }

      return {
        view: {
          messages: [
            ...state.view.messages,
            {
              messageId,
              fromActor,
              toActor,
              kind,
              body,
              sequence: event.sequence,
              eventId: event.eventId,
            },
          ],
        },
        seenMessageIds: new Set([...state.seenMessageIds, messageId]),
      };
    }

    case 'run_started':
    case 'run_completed':
    case 'task_created':
    case 'task_state_changed':
    case 'artifact_published':
    case 'request_rejected':
    default:
      return state;
  }
};

export const replayMailbox = (events: readonly RunEvent[]): MailboxProjectionView['view'] =>
  events.reduce(mailboxReducer, initialMailboxState).view;
