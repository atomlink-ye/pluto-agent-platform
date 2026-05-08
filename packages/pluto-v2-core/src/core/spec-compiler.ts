import { z } from 'zod';

import { type ActorRef, type ActorRole } from '../actor-ref.js';
import { type ProtocolRequestIntent } from '../protocol-request.js';
import {
  AUTHORITY_POLICY_INTENT_VALUES,
  AuthoredSpecSchema,
  CANONICAL_AUTHORITY_POLICY,
  TeamContextSchema,
  isActorRole,
  isTaskState,
  type ActorMatcher,
  type AuthoredActorMatcher,
  type AuthoredActorRef,
  type AuthoredSpec,
  type AuthorityPolicy,
  type TeamContext,
} from './team-context.js';

export const SPEC_COMPILE_ERROR_CODE_VALUES = [
  'unknown_actor',
  'duplicate_task',
  'policy_invalid',
  'intent_payload_mismatch',
  'actor_role_unknown',
  'orchestration_invalid',
] as const;

export const SpecCompileErrorCodeSchema = z.enum(SPEC_COMPILE_ERROR_CODE_VALUES);

export const SpecCompileErrorSchema = z.object({
  code: SpecCompileErrorCodeSchema,
  message: z.string(),
  path: z.array(z.union([z.string(), z.number()])).optional(),
});

export class SpecCompileError extends Error {
  readonly code: SpecCompileErrorCode;
  readonly path?: ReadonlyArray<string | number>;

  constructor(code: SpecCompileErrorCode, message: string, path?: ReadonlyArray<string | number>) {
    super(message);
    this.name = 'SpecCompileError';
    this.code = code;
    this.path = path;
  }
}

function fail(
  code: SpecCompileErrorCode,
  message: string,
  path?: ReadonlyArray<string | number>,
): never {
  throw new SpecCompileError(code, message, path);
}

function compileActorRef(name: string, actor: AuthoredActorRef): ActorRef {
  switch (actor.kind) {
    case 'manager':
      return { kind: 'manager' };
    case 'system':
      return { kind: 'system' };
    case 'role':
      if (!isActorRole(actor.role)) {
        fail('actor_role_unknown', `Actor "${name}" uses unknown role "${actor.role}"`, [
          'actors',
          name,
          'role',
        ]);
      }

      return { kind: 'role', role: actor.role };
  }
}

function compileDeclaredActors(
  actorMap: Readonly<Record<string, ActorRef>>,
  declaredActorNames: readonly string[],
): ActorRef[] {
  return declaredActorNames.map((actorName, index) => {
    const actor = actorMap[actorName];
    if (!actor) {
      fail('unknown_actor', `Declared actor "${actorName}" is not defined`, [
        'declaredActors',
        index,
      ]);
    }

    return actor;
  });
}

function compileInitialTasks(
  authored: AuthoredSpec,
  actorMap: Readonly<Record<string, ActorRef>>,
): TeamContext['initialTasks'] {
  const taskIds = new Set<string>();

  return authored.initialTasks?.map((task, index) => {
    if (taskIds.has(task.taskId)) {
      fail('duplicate_task', `Task "${task.taskId}" is declared more than once`, [
        'initialTasks',
        index,
        'taskId',
      ]);
    }

    taskIds.add(task.taskId);

    if (task.ownerActor == null) {
      return {
        taskId: task.taskId,
        title: task.title,
        ownerActor: null,
        dependsOn: [...task.dependsOn],
      };
    }

    const ownerActor = actorMap[task.ownerActor];
    if (!ownerActor) {
      fail('unknown_actor', `Task "${task.taskId}" references unknown owner "${task.ownerActor}"`, [
        'initialTasks',
        index,
        'ownerActor',
      ]);
    }

    return {
      taskId: task.taskId,
      title: task.title,
      ownerActor,
      dependsOn: [...task.dependsOn],
    };
  });
}

function compileRole(role: string, path: ReadonlyArray<string | number>): ActorRole {
  if (!isActorRole(role)) {
    fail('actor_role_unknown', `Unknown role "${role}"`, path);
  }

  return role;
}

function assertTransitions(
  transitions: readonly string[],
  path: ReadonlyArray<string | number>,
): ['blocked', 'cancelled'] {
  if (transitions.length !== 2) {
    fail('intent_payload_mismatch', 'Planner transition matcher must contain exactly two transitions', path);
  }

  const first = transitions[0];
  const second = transitions[1];
  if (first == null || second == null) {
    fail('intent_payload_mismatch', 'Planner transition matcher must contain exactly two transitions', path);
  }

  if (!isTaskState(first) || !isTaskState(second)) {
    fail('intent_payload_mismatch', 'Planner transition matcher contains an unknown task state', path);
  }

  if (first !== 'blocked' || second !== 'cancelled') {
    fail(
      'intent_payload_mismatch',
      'Planner transition matcher must be ["blocked", "cancelled"]',
      path,
    );
  }

  return ['blocked', 'cancelled'];
}

function matcherAllowedForIntent(intent: ProtocolRequestIntent, matcher: ActorMatcher): boolean {
  switch (intent) {
    case 'append_mailbox_message':
      return (
        matcher.kind === 'manager' ||
        matcher.kind === 'system' ||
        (matcher.kind === 'role' &&
          (matcher.role === 'lead' ||
            matcher.role === 'planner' ||
            matcher.role === 'generator' ||
            matcher.role === 'evaluator'))
      );
    case 'create_task':
      return (
        matcher.kind === 'manager' ||
        (matcher.kind === 'role' && (matcher.role === 'lead' || matcher.role === 'planner'))
      );
    case 'change_task_state':
      return (
        matcher.kind === 'manager' ||
        (matcher.kind === 'role' && matcher.role === 'lead') ||
        matcher.kind === 'role-owns-task' ||
        matcher.kind === 'role-bounded-transitions'
      );
    case 'publish_artifact':
      return (
        matcher.kind === 'manager' ||
        (matcher.kind === 'role' && (matcher.role === 'lead' || matcher.role === 'generator'))
      );
    case 'complete_run':
      return matcher.kind === 'manager';
  }
}

function compileMatcher(
  intent: ProtocolRequestIntent,
  matcher: AuthoredActorMatcher,
  path: ReadonlyArray<string | number>,
): ActorMatcher {
  let normalized: ActorMatcher;

  switch (matcher.kind) {
    case 'manager':
      normalized = { kind: 'manager' };
      break;
    case 'system':
      normalized = { kind: 'system' };
      break;
    case 'role': {
      normalized = {
        kind: 'role',
        role: compileRole(matcher.role, [...path, 'role']),
      };
      break;
    }
    case 'role-owns-task': {
      const role = compileRole(matcher.role, [...path, 'role']);
      if (role !== 'generator' && role !== 'evaluator') {
        fail(
          'intent_payload_mismatch',
          `role-owns-task matcher does not support role "${role}"`,
          [...path, 'role'],
        );
      }

      normalized = {
        kind: 'role-owns-task',
        role,
      };
      break;
    }
    case 'role-bounded-transitions': {
      const role = compileRole(matcher.role, [...path, 'role']);
      if (role !== 'planner') {
        fail(
          'intent_payload_mismatch',
          `role-bounded-transitions matcher does not support role "${role}"`,
          [...path, 'role'],
        );
      }

      normalized = {
        kind: 'role-bounded-transitions',
        role,
        transitions: assertTransitions(matcher.transitions, [...path, 'transitions']),
      };
      break;
    }
  }

  if (!matcherAllowedForIntent(intent, normalized)) {
    fail(
      'intent_payload_mismatch',
      `Matcher kind "${normalized.kind}" is not valid for intent "${intent}"`,
      path,
    );
  }

  return normalized;
}

function policiesEqual(left: AuthorityPolicy, right: AuthorityPolicy): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function compilePolicy(policy: AuthoredSpec['policy']): AuthorityPolicy {
  if (!policy) {
    return TeamContextSchema.shape.policy.parse(CANONICAL_AUTHORITY_POLICY);
  }

  const policyKeys = Object.keys(policy);
  if (policyKeys.length !== AUTHORITY_POLICY_INTENT_VALUES.length) {
    fail('policy_invalid', 'Policy must define every protocol intent exactly once', ['policy']);
  }

  for (const key of policyKeys) {
    if (!(AUTHORITY_POLICY_INTENT_VALUES as readonly string[]).includes(key)) {
      fail('policy_invalid', `Policy contains unknown intent "${key}"`, ['policy', key]);
    }
  }

  const normalized = Object.fromEntries(
    AUTHORITY_POLICY_INTENT_VALUES.map((intent) => {
      const authoredMatchers = policy[intent];
      if (!authoredMatchers) {
        fail('policy_invalid', `Policy is missing intent "${intent}"`, ['policy', intent]);
      }

      return [
        intent,
        authoredMatchers.map((matcher, index) =>
          compileMatcher(intent, matcher, ['policy', intent, index]),
        ),
      ];
    }),
  ) as AuthorityPolicy;

  if (!policiesEqual(normalized, CANONICAL_AUTHORITY_POLICY)) {
    fail('policy_invalid', 'Policy does not match the canonical closed authority matrix', ['policy']);
  }

  return TeamContextSchema.shape.policy.parse(normalized);
}

function validateAgenticOrchestration(parsed: AuthoredSpec): void {
  if (parsed.orchestration?.mode !== 'agentic') {
    return;
  }

  if (!parsed.declaredActors.includes('lead')) {
    fail(
      'orchestration_invalid',
      'agentic orchestration requires declaredActors to include "lead"',
      ['declaredActors'],
    );
  }

  const leadActor = parsed.actors.lead;
  if (leadActor == null || leadActor.kind !== 'role' || leadActor.role !== 'lead') {
    fail(
      'orchestration_invalid',
      'agentic orchestration requires actors.lead to be { kind: "role", role: "lead" }',
      ['actors', 'lead'],
    );
  }

  if (!parsed.declaredActors.includes('manager')) {
    fail(
      'orchestration_invalid',
      'agentic orchestration requires declaredActors to include "manager"',
      ['declaredActors'],
    );
  }

  const managerActor = parsed.actors.manager;
  if (managerActor == null || managerActor.kind !== 'manager') {
    fail(
      'orchestration_invalid',
      'agentic orchestration requires actors.manager to be { kind: "manager" }',
      ['actors', 'manager'],
    );
  }

  if (parsed.userTask == null || parsed.userTask.trim().length === 0) {
    fail('orchestration_invalid', 'agentic orchestration requires userTask to be non-empty', ['userTask']);
  }

  if (parsed.playbookRef == null || parsed.playbookRef.trim().length === 0) {
    fail(
      'orchestration_invalid',
      'agentic orchestration requires playbookRef to be a non-empty markdown path',
      ['playbookRef'],
    );
  }

  if (!parsed.playbookRef.trim().toLowerCase().endsWith('.md')) {
    fail(
      'orchestration_invalid',
      'agentic orchestration requires playbookRef to reference a markdown file',
      ['playbookRef'],
    );
  }
}

export function compile(authored: AuthoredSpec): TeamContext {
  const parsed = AuthoredSpecSchema.parse(authored);

  const actorMap = Object.fromEntries(
    Object.entries(parsed.actors).map(([name, actor]) => [name, compileActorRef(name, actor)]),
  ) as Record<string, ActorRef>;

  validateAgenticOrchestration(parsed);

  const declaredActors = compileDeclaredActors(actorMap, parsed.declaredActors);

  return TeamContextSchema.parse({
    runId: parsed.runId,
    scenarioRef: parsed.scenarioRef,
    runProfileRef: parsed.runProfileRef,
    declaredActors,
    initialTasks: compileInitialTasks(parsed, actorMap),
    policy: compilePolicy(parsed.policy),
  });
}

export type SpecCompileErrorCode = z.infer<typeof SpecCompileErrorCodeSchema>;
