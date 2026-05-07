import type { TaskProjectionView } from '../projections.js';
import type { RunEvent } from '../run-event.js';

export type TaskReducerState = {
  view: TaskProjectionView['view'];
};

export const initialTaskState: TaskReducerState = {
  view: {
    tasks: {},
  },
};

export const taskReducer = (
  state: TaskReducerState,
  event: RunEvent,
): TaskReducerState => {
  switch (event.kind) {
    case 'task_created': {
      const { taskId, title, ownerActor, dependsOn } = event.payload;

      if (state.view.tasks[taskId]) {
        return state;
      }

      return {
        view: {
          tasks: {
            ...state.view.tasks,
            [taskId]: {
              title,
              ownerActor,
              state: 'queued',
              dependsOn,
              history: [],
            },
          },
        },
      };
    }

    case 'task_state_changed': {
      const { taskId, from, to } = event.payload;
      const existingTask = state.view.tasks[taskId];

      if (!existingTask) {
        return state;
      }

      if (existingTask.history.some((entry) => entry.eventId === event.eventId)) {
        return state;
      }

      return {
        view: {
          tasks: {
            ...state.view.tasks,
            [taskId]: {
              ...existingTask,
              state: to,
              history: [
                ...existingTask.history,
                {
                  from,
                  to,
                  eventId: event.eventId,
                },
              ],
            },
          },
        },
      };
    }

    case 'run_started':
    case 'run_completed':
    case 'mailbox_message_appended':
    case 'artifact_published':
    case 'request_rejected':
    default:
      return state;
  }
};

export const replayTask = (events: readonly RunEvent[]): TaskProjectionView['view'] =>
  events.reduce(taskReducer, initialTaskState).view;
