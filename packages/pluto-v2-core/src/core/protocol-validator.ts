import type { AuthorityValidationOutcome, RejectionReason } from '../authority-outcome.js';
import type { ProtocolRequest } from '../protocol-request.js';
import type { TaskState } from '../run-event.js';

import {
  actorAuthorizedForIntent,
  composeRequestKey,
  entityResolvable,
  transitionLegal,
} from './authority.js';
import type { RunState } from './run-state.js';

export type ValidationResult = AuthorityValidationOutcome;

export interface ValidationContext {
  expectedTaskState?: TaskState;
}

function reject(reason: RejectionReason, detail: string): ValidationResult {
  return { ok: false, reason, detail };
}

function missingDependencyIds(state: RunState, request: Extract<ProtocolRequest, { intent: 'create_task' }>): string[] {
  return request.payload.dependsOn.filter(
    (taskId) => !Object.prototype.hasOwnProperty.call(state.tasks, taskId),
  );
}

function entityUnknownDetail(state: RunState, request: ProtocolRequest, ctx?: ValidationContext): string {
  switch (request.intent) {
    case 'change_task_state': {
      const task = state.tasks[request.payload.taskId];

      if (!task) {
        return `Task ${request.payload.taskId} is unknown.`;
      }

      if (ctx?.expectedTaskState !== undefined && task.state !== ctx.expectedTaskState) {
        return `Task ${request.payload.taskId} is ${task.state}, expected ${ctx.expectedTaskState}.`;
      }

      return `Task ${request.payload.taskId} could not be resolved.`;
    }
    case 'create_task': {
      const missingTaskIds = missingDependencyIds(state, request);
      return `Task dependencies are unknown: ${missingTaskIds.join(', ')}.`;
    }
    case 'append_mailbox_message':
    case 'publish_artifact':
    case 'complete_run':
      return `Entity for ${request.intent} could not be resolved.`;
  }
}

function stateConflictDetail(state: RunState, request: Extract<ProtocolRequest, { intent: 'change_task_state' }>): string {
  const currentTaskState = state.tasks[request.payload.taskId]?.state;
  return `Transition ${currentTaskState ?? '<unknown>'} -> ${request.payload.to} is not legal for task ${request.payload.taskId}.`;
}

export function validate(
  state: RunState,
  request: ProtocolRequest,
  ctx?: ValidationContext,
): ValidationResult {
  if (!actorAuthorizedForIntent(state, request)) {
    return reject('actor_not_authorized', `Actor is not authorized for ${request.intent}.`);
  }

  if (!entityResolvable(state, request)) {
    return reject('entity_unknown', entityUnknownDetail(state, request, ctx));
  }

  if (request.intent === 'change_task_state') {
    const task = state.tasks[request.payload.taskId];

    if (!task) {
      return reject('entity_unknown', entityUnknownDetail(state, request, ctx));
    }

    if (ctx?.expectedTaskState !== undefined && task.state !== ctx.expectedTaskState) {
      return reject('entity_unknown', entityUnknownDetail(state, request, ctx));
    }

    if (!transitionLegal(task.state, request.payload.to)) {
      return reject('state_conflict', stateConflictDetail(state, request));
    }
  }

  const requestKey = composeRequestKey(state.runId, request.actor, request.intent, request.idempotencyKey);

  if (requestKey !== null && state.acceptedRequestKeys.has(requestKey)) {
    return reject('idempotency_replay', `Request key ${requestKey} was already accepted.`);
  }

  return { ok: true };
}
