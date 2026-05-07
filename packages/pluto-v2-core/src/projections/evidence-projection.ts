import type { EvidenceProjectionView } from '../projections.js';
import type { RunEvent } from '../run-event.js';

export type EvidenceReducerState = {
  view: EvidenceProjectionView['view'];
  pendingStartedAt: string | null;
  seenEventIds: ReadonlySet<string>;
};

export const initialEvidenceState: EvidenceReducerState = {
  view: { run: null, citations: [] },
  pendingStartedAt: null,
  seenEventIds: new Set(),
};

const RUN_STARTED_SUMMARY = 'Run started.';
const RUN_COMPLETED_SUMMARY = 'Run completed.';

const appendCitation = (
  state: EvidenceReducerState,
  event: RunEvent,
  summary: string,
): EvidenceReducerState => ({
  ...state,
  view: {
    ...state.view,
    citations: [
      ...state.view.citations,
      {
        eventId: event.eventId,
        sequence: event.sequence,
        kind: event.kind,
        summary,
      },
    ],
  },
  seenEventIds: new Set([...state.seenEventIds, event.eventId]),
});

export const evidenceReducer = (
  state: EvidenceReducerState,
  event: RunEvent,
): EvidenceReducerState => {
  switch (event.kind) {
    case 'run_started': {
      if (state.seenEventIds.has(event.eventId)) {
        return state;
      }

      const nextState = appendCitation(state, event, RUN_STARTED_SUMMARY);
      return {
        ...nextState,
        pendingStartedAt: event.payload.startedAt,
      };
    }

    case 'run_completed': {
      if (state.seenEventIds.has(event.eventId)) {
        return state;
      }

      const nextState = appendCitation(state, event, RUN_COMPLETED_SUMMARY);
      return {
        ...nextState,
        view: {
          ...nextState.view,
          run: {
            runId: event.runId,
            status: event.payload.status,
            startedAt: state.pendingStartedAt!,
            completedAt: event.payload.completedAt,
            summary: event.payload.summary,
          },
        },
        pendingStartedAt: null,
      };
    }

    case 'mailbox_message_appended':
    case 'task_created':
    case 'task_state_changed':
    case 'artifact_published':
    case 'request_rejected':
    default:
      return state;
  }
};

export const replayEvidence = (events: readonly RunEvent[]): EvidenceProjectionView['view'] =>
  events.reduce(evidenceReducer, initialEvidenceState).view;
