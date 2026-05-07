import type { ActorRef } from '../actor-ref.js';
import type { ProtocolRequest, ProtocolRequestIntent } from '../protocol-request.js';
import type { TaskState } from '../run-event.js';
import type { RunState } from './run-state.js';
import { actorKey, type ActorMatcher } from './team-context.js';

type AuthorityState = Pick<RunState, 'declaredActors' | 'tasks'>;
type EntityResolutionState = Pick<RunState, 'tasks'>;
type ChangeTaskStateRequest = Extract<ProtocolRequest, { intent: 'change_task_state' }>;
type CreateTaskRequest = Extract<ProtocolRequest, { intent: 'create_task' }>;

export const AUTHORITY_MATRIX = {
  append_mailbox_message: [
    { kind: 'manager' },
    { kind: 'role', role: 'lead' },
    { kind: 'role', role: 'planner' },
    { kind: 'role', role: 'generator' },
    { kind: 'role', role: 'evaluator' },
    { kind: 'system' },
  ],
  create_task: [
    { kind: 'manager' },
    { kind: 'role', role: 'lead' },
    { kind: 'role', role: 'planner' },
  ],
  change_task_state: [
    { kind: 'manager' },
    { kind: 'role', role: 'lead' },
    { kind: 'role-owns-task', role: 'generator' },
    { kind: 'role-owns-task', role: 'evaluator' },
    {
      kind: 'role-bounded-transitions',
      role: 'planner',
      transitions: ['blocked', 'cancelled'],
    },
  ],
  publish_artifact: [
    { kind: 'role', role: 'generator' },
    { kind: 'role', role: 'lead' },
    { kind: 'manager' },
  ],
  complete_run: [{ kind: 'manager' }],
} as const satisfies Readonly<Record<ProtocolRequestIntent, readonly ActorMatcher[]>>;

export const TRANSITION_GRAPH = {
  queued: ['running', 'blocked', 'completed', 'failed', 'cancelled'],
  running: ['completed', 'blocked', 'failed', 'cancelled'],
  blocked: ['running', 'completed', 'failed', 'cancelled'],
  completed: [],
  failed: [],
  cancelled: [],
} as const satisfies Readonly<Record<TaskState, readonly TaskState[]>>;

function hasTask(state: EntityResolutionState, taskId: string): boolean {
  return Object.prototype.hasOwnProperty.call(state.tasks, taskId);
}

function sameActor(left: ActorRef, right: ActorRef): boolean {
  return actorKey(left) === actorKey(right);
}

function actorMatchesRole(actor: ActorRef, role: 'lead' | 'planner' | 'generator' | 'evaluator'): boolean {
  return actor.kind === 'role' && actor.role === role;
}

function roleOwnsTaskAuthorized(
  state: AuthorityState,
  actor: ActorRef,
  request: ChangeTaskStateRequest,
  role: 'generator' | 'evaluator',
): boolean {
  if (!actorMatchesRole(actor, role)) {
    return false;
  }

  const task = state.tasks[request.payload.taskId];
  if (!task) {
    return true;
  }

  if (task.ownerActor === null) {
    return false;
  }

  return sameActor(task.ownerActor, actor);
}

function roleBoundedTransitionAuthorized(
  actor: ActorRef,
  request: ChangeTaskStateRequest,
  matcher: Extract<ActorMatcher, { kind: 'role-bounded-transitions' }>,
): boolean {
  const transitions = matcher.transitions as readonly TaskState[];

  return actorMatchesRole(actor, matcher.role) && transitions.includes(request.payload.to);
}

function matcherMatches(state: AuthorityState, request: ProtocolRequest, matcher: ActorMatcher): boolean {
  switch (matcher.kind) {
    case 'manager':
      return request.actor.kind === 'manager';
    case 'system':
      return request.actor.kind === 'system';
    case 'role':
      return actorMatchesRole(request.actor, matcher.role);
    case 'role-owns-task':
      return request.intent === 'change_task_state'
        ? roleOwnsTaskAuthorized(state, request.actor, request, matcher.role)
        : false;
    case 'role-bounded-transitions':
      return request.intent === 'change_task_state'
        ? roleBoundedTransitionAuthorized(request.actor, request, matcher)
        : false;
  }
}

export function actorAuthorizedForIntent(state: AuthorityState, request: ProtocolRequest): boolean {
  if (!state.declaredActors.has(actorKey(request.actor))) {
    return false;
  }

  return AUTHORITY_MATRIX[request.intent].some((matcher) => matcherMatches(state, request, matcher));
}

export function transitionLegal(from: TaskState, to: TaskState): boolean {
  const legalTransitions = TRANSITION_GRAPH[from] as readonly TaskState[];

  return legalTransitions.includes(to);
}

export function composeRequestKey(
  runId: string,
  actor: ActorRef,
  intent: ProtocolRequestIntent,
  idempotencyKey: string | null,
): string | null {
  if (idempotencyKey === null) {
    return null;
  }

  return `${runId}|${actorKey(actor)}|${intent}|${idempotencyKey}`;
}

function createTaskEntityResolvable(state: EntityResolutionState, request: CreateTaskRequest): boolean {
  return request.payload.dependsOn.every((taskId) => hasTask(state, taskId));
}

export function entityResolvable(state: EntityResolutionState, request: ProtocolRequest): boolean {
  switch (request.intent) {
    case 'change_task_state':
      return hasTask(state, request.payload.taskId);
    case 'create_task':
      return createTaskEntityResolvable(state, request);
    case 'append_mailbox_message':
    case 'publish_artifact':
    case 'complete_run':
      return true;
  }
}
