import type { ActorRef } from '@pluto/v2-core/actor-ref';
import type { AuthoredSpec } from '@pluto/v2-core/core/team-context';
import type { RunEvent } from '@pluto/v2-core/run-event';

import type { AgenticMutation } from './agentic-mutation.js';

export interface PaseoRejectionSummary {
  readonly directive: AgenticMutation;
  readonly error: string;
}

export interface PaseoAgenticSchedulerState {
  readonly turnIndex: number;
  readonly maxTurns: number;
  readonly currentActor: ActorRef;
  readonly delegationPointer: ActorRef | null;
  readonly delegationTaskId: string | null;
  readonly kernelRejections: number;
  readonly noProgressTurns: number;
  readonly lastRejection: PaseoRejectionSummary | null;
  readonly maxKernelRejections: number;
  readonly maxNoProgressTurns: number;
}

export interface PaseoAgenticSchedulerSpec extends Pick<AuthoredSpec, 'actors'> {}

export interface PaseoAgenticSchedulerDecision {
  readonly actor: ActorRef;
  readonly delegationPointer: ActorRef | null;
  readonly delegationTaskId: string | null;
  readonly progressed: boolean;
}

export const DEFAULT_MAX_TURNS = 20;
export const DEFAULT_MAX_KERNEL_REJECTIONS = 3;
export const DEFAULT_MAX_NO_PROGRESS_TURNS = 3;
export const HARD_MAX_TURNS = 50;
export const LEAD_ACTOR: ActorRef = { kind: 'role', role: 'lead' };

export function sameActor(left: ActorRef, right: ActorRef): boolean {
  if (left.kind !== right.kind) {
    return false;
  }

  if (left.kind === 'role' && right.kind === 'role') {
    return left.role === right.role;
  }

  return true;
}

export function isLeadActor(actor: ActorRef): boolean {
  return actor.kind === 'role' && actor.role === 'lead';
}

export function leadActorFromSpec(spec: PaseoAgenticSchedulerSpec): ActorRef {
  const leadActor = spec.actors.lead;
  if (leadActor != null && leadActor.kind === 'role' && leadActor.role === 'lead') {
    return LEAD_ACTOR;
  }

  return LEAD_ACTOR;
}

function terminalTaskState(to: string): boolean {
  return to === 'completed' || to === 'cancelled' || to === 'failed';
}

function closesDelegationMailboxMessage(event: RunEvent, leadActor: ActorRef): boolean {
  return event.kind === 'mailbox_message_appended'
    && event.outcome === 'accepted'
    && event.payload.toActor.kind !== 'broadcast'
    && sameActor(event.payload.toActor, leadActor)
    && (event.payload.kind === 'completion' || event.payload.kind === 'final');
}

export function budgetFailureForAgenticScheduler(
  state: Pick<
    PaseoAgenticSchedulerState,
    'turnIndex' | 'maxTurns' | 'kernelRejections' | 'maxKernelRejections' | 'noProgressTurns' | 'maxNoProgressTurns'
  >,
): { status: 'failed'; summary: string } | null {
  if (state.turnIndex >= state.maxTurns) {
    return { status: 'failed', summary: 'maxTurns exhausted' };
  }

  if (state.noProgressTurns > state.maxNoProgressTurns) {
    return { status: 'failed', summary: 'maxNoProgressTurns exhausted' };
  }

  if (state.kernelRejections > state.maxKernelRejections) {
    return { status: 'failed', summary: 'maxKernelRejections exhausted' };
  }

  return null;
}

export const budgetFailureForAgentic = budgetFailureForAgenticScheduler;

export function pickNextAgenticSchedulerActor(args: {
  state: Pick<PaseoAgenticSchedulerState, 'currentActor' | 'delegationPointer' | 'delegationTaskId'>;
  acceptedEvent: RunEvent;
  directive: AgenticMutation;
  leadActor?: ActorRef;
}): PaseoAgenticSchedulerDecision {
  const leadActor = args.leadActor ?? LEAD_ACTOR;
  const currentActor = args.state.currentActor;

  if (isLeadActor(currentActor)) {
    if (
      args.directive.kind === 'create_task'
      && args.directive.payload.ownerActor != null
      && !sameActor(args.directive.payload.ownerActor, leadActor)
    ) {
      return {
        actor: args.directive.payload.ownerActor,
        delegationPointer: args.directive.payload.ownerActor,
        delegationTaskId:
          args.acceptedEvent.kind === 'task_created' && args.acceptedEvent.outcome === 'accepted'
            ? args.acceptedEvent.payload.taskId
            : null,
        progressed: true,
      };
    }

    if (
      args.directive.kind === 'append_mailbox_message'
      && args.directive.payload.toActor.kind === 'role'
      && !sameActor(args.directive.payload.toActor, leadActor)
    ) {
      return {
        actor: args.directive.payload.toActor,
        delegationPointer: args.directive.payload.toActor,
        delegationTaskId: null,
        progressed: true,
      };
    }

    return {
      actor: leadActor,
      delegationPointer: args.state.delegationPointer,
      delegationTaskId: args.state.delegationTaskId,
      progressed: args.acceptedEvent.outcome === 'accepted',
    };
  }

  if (
    args.acceptedEvent.kind === 'task_state_changed'
    && args.acceptedEvent.outcome === 'accepted'
    && args.state.delegationTaskId !== null
    && args.acceptedEvent.payload.taskId === args.state.delegationTaskId
    && terminalTaskState(args.acceptedEvent.payload.to)
  ) {
    return {
      actor: leadActor,
      delegationPointer: null,
      delegationTaskId: null,
      progressed: true,
    };
  }

  if (closesDelegationMailboxMessage(args.acceptedEvent, leadActor)) {
    return {
      actor: leadActor,
      delegationPointer: null,
      delegationTaskId: null,
      progressed: true,
    };
  }

  return {
    actor: currentActor,
    delegationPointer: args.state.delegationPointer ?? currentActor,
    delegationTaskId: args.state.delegationTaskId,
    progressed: args.acceptedEvent.outcome === 'accepted',
  };
}

export const pickNextAgenticActor = pickNextAgenticSchedulerActor;

export function withKernelRejection(
  state: PaseoAgenticSchedulerState,
  rejection: PaseoRejectionSummary,
  leadActor: ActorRef = LEAD_ACTOR,
): PaseoAgenticSchedulerState {
  return {
    ...state,
    currentActor: leadActor,
    delegationPointer: null,
    delegationTaskId: null,
    kernelRejections: state.kernelRejections + 1,
    noProgressTurns: state.noProgressTurns + 1,
    lastRejection: rejection,
  };
}
