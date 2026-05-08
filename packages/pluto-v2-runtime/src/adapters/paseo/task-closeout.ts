import type { ActorRef, RunEvent, RunState, TaskState } from '@pluto/v2-core';

import type { AgenticMutation } from './agentic-mutation.js';
import { sameActor } from './agentic-scheduler.js';

const TERMINAL_TASK_STATES = new Set<TaskState>(['completed', 'cancelled', 'failed']);

export interface DelegatedTaskCloseoutPlan {
  readonly actor: ActorRef;
  readonly taskId: string;
}

export function planDelegatedTaskCloseout(args: {
  actor: ActorRef;
  acceptedEvent: RunEvent;
  directive: AgenticMutation;
  leadActor: ActorRef;
  delegationPointer: ActorRef | null;
  delegationTaskId: string | null;
  runState: RunState;
}): DelegatedTaskCloseoutPlan | null {
  if (args.directive.kind !== 'append_mailbox_message') {
    return null;
  }

  if (
    args.acceptedEvent.kind !== 'mailbox_message_appended'
    || args.acceptedEvent.outcome !== 'accepted'
    || args.directive.payload.kind !== 'completion' && args.directive.payload.kind !== 'final'
    || args.directive.payload.toActor.kind === 'broadcast'
    || !sameActor(args.directive.payload.toActor, args.leadActor)
    || args.delegationPointer == null
    || !sameActor(args.delegationPointer, args.actor)
    || args.delegationTaskId == null
  ) {
    return null;
  }

  const task = args.runState.tasks[args.delegationTaskId];
  if (task == null || TERMINAL_TASK_STATES.has(task.state)) {
    return null;
  }

  return {
    actor: args.actor,
    taskId: args.delegationTaskId,
  };
}
