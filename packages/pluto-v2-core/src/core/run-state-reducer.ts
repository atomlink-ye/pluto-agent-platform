import type { AcceptedRunEvent, RunCompletedStatus, RunEvent } from '../run-event.js';

import type { RunState, RunStateTask, RunStatus } from './run-state.js';

type AcceptedEventWithRequestKey = AcceptedRunEvent & {
  acceptedRequestKey?: string | null;
};

function hasAcceptedRequestKey(event: AcceptedRunEvent): event is AcceptedEventWithRequestKey {
  return 'acceptedRequestKey' in event;
}

function advanceSequence(state: RunState): number {
  return state.sequence + 1;
}

function acceptedRequestKeysFor(
  state: RunState,
  event: AcceptedRunEvent,
): RunState['acceptedRequestKeys'] {
  const nextAcceptedRequestKeys = new Set(state.acceptedRequestKeys);
  const acceptedRequestKey = hasAcceptedRequestKey(event) ? event.acceptedRequestKey : undefined;

  if (typeof acceptedRequestKey === 'string') {
    nextAcceptedRequestKeys.add(acceptedRequestKey);
  }

  return nextAcceptedRequestKeys;
}

function reduceAcceptedEvent(
  state: RunState,
  event: AcceptedRunEvent,
  patch: Partial<Pick<RunState, 'status' | 'tasks'>> = {},
): RunState {
  return {
    ...state,
    ...patch,
    sequence: advanceSequence(state),
    acceptedRequestKeys: acceptedRequestKeysFor(state, event),
  };
}

function reduceRejectedEvent(state: RunState): RunState {
  return {
    ...state,
    sequence: advanceSequence(state),
  };
}

function taskStateFromAcceptedStatus(status: RunCompletedStatus): RunStatus {
  return status === 'succeeded' ? 'completed' : status;
}

function reduceTaskCreated(state: RunState, event: Extract<RunEvent, { kind: 'task_created' }>): RunState {
  const nextTasks = {
    ...state.tasks,
    [event.payload.taskId]: {
      state: 'queued',
      ownerActor: event.payload.ownerActor,
    } satisfies RunStateTask,
  };

  return reduceAcceptedEvent(state, event, { tasks: nextTasks });
}

function reduceTaskStateChanged(
  state: RunState,
  event: Extract<RunEvent, { kind: 'task_state_changed' }>,
): RunState {
  const existingTask = state.tasks[event.payload.taskId];
  const nextTasks = {
    ...state.tasks,
    [event.payload.taskId]: {
      state: event.payload.to,
      ownerActor: existingTask?.ownerActor ?? null,
    } satisfies RunStateTask,
  };

  return reduceAcceptedEvent(state, event, { tasks: nextTasks });
}

export function reduce(state: RunState, event: RunEvent): RunState {
  switch (event.kind) {
    case 'run_started':
      return reduceAcceptedEvent(state, event, { status: 'running' });
    case 'run_completed':
      return reduceAcceptedEvent(state, event, {
        status: taskStateFromAcceptedStatus(event.payload.status),
      });
    case 'mailbox_message_appended':
      return reduceAcceptedEvent(state, event);
    case 'task_created':
      return reduceTaskCreated(state, event);
    case 'task_state_changed':
      return reduceTaskStateChanged(state, event);
    case 'artifact_published':
      return reduceAcceptedEvent(state, event);
    case 'request_rejected':
      return reduceRejectedEvent(state);
  }

  const exhaustiveEvent: never = event;
  return exhaustiveEvent;
}
