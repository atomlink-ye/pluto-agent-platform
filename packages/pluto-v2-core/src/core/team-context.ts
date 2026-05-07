import { z } from 'zod';

import {
  ACTOR_ROLE_VALUES,
  ActorRefSchema,
  ActorRoleSchema,
  ManagerActorRefSchema,
  SystemActorRefSchema,
  type ActorRef,
  type ActorRole,
} from '../actor-ref.js';
import {
  PROTOCOL_REQUEST_INTENT_VALUES,
  type ProtocolRequestIntent,
} from '../protocol-request.js';
import { TASK_STATE_VALUES, type TaskState } from '../run-event.js';

export const ACTOR_KEY_MANAGER = 'manager';
export const ACTOR_KEY_SYSTEM = 'system';
export const ACTOR_KEY_ROLE_PREFIX = 'role:';

export function actorKey(actor: ActorRef): string {
  switch (actor.kind) {
    case 'manager':
      return ACTOR_KEY_MANAGER;
    case 'system':
      return ACTOR_KEY_SYSTEM;
    case 'role':
      return `${ACTOR_KEY_ROLE_PREFIX}${actor.role}`;
  }
}

export function isActorRole(value: string): value is ActorRole {
  return (ACTOR_ROLE_VALUES as readonly string[]).includes(value);
}

export function isTaskState(value: string): value is TaskState {
  return (TASK_STATE_VALUES as readonly string[]).includes(value);
}

export const RoleOwnsTaskActorMatcherSchema = z.object({
  kind: z.literal('role-owns-task'),
  role: z.enum(['generator', 'evaluator']),
});

export const RoleBoundedTransitionsActorMatcherSchema = z.object({
  kind: z.literal('role-bounded-transitions'),
  role: z.literal('planner'),
  transitions: z.tuple([z.literal('blocked'), z.literal('cancelled')]),
});

export const ActorMatcherSchema = z.discriminatedUnion('kind', [
  ManagerActorRefSchema,
  z.object({
    kind: z.literal('role'),
    role: ActorRoleSchema,
  }),
  SystemActorRefSchema,
  RoleOwnsTaskActorMatcherSchema,
  RoleBoundedTransitionsActorMatcherSchema,
]);

export const AuthorityPolicySchema = z
  .object({
    append_mailbox_message: z.array(ActorMatcherSchema),
    create_task: z.array(ActorMatcherSchema),
    change_task_state: z.array(ActorMatcherSchema),
    publish_artifact: z.array(ActorMatcherSchema),
    complete_run: z.array(ActorMatcherSchema),
  })
  .strict();

export const CANONICAL_AUTHORITY_POLICY = {
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
} satisfies AuthorityPolicy;

export const TeamContextInitialTaskSchema = z
  .object({
    taskId: z.string(),
    title: z.string(),
    ownerActor: ActorRefSchema.nullable(),
    dependsOn: z.array(z.string()),
  })
  .strict();

export const TeamContextSchema = z
  .object({
    runId: z.string(),
    scenarioRef: z.string(),
    runProfileRef: z.string(),
    declaredActors: z.array(ActorRefSchema),
    initialTasks: z.array(TeamContextInitialTaskSchema).optional(),
    policy: AuthorityPolicySchema,
  })
  .strict();

const AuthoredRoleActorRefSchema = z.object({
  kind: z.literal('role'),
  role: z.string(),
});

export const AuthoredActorRefSchema = z.discriminatedUnion('kind', [
  ManagerActorRefSchema,
  AuthoredRoleActorRefSchema,
  SystemActorRefSchema,
]);

const AuthoredRoleActorMatcherSchema = z.object({
  kind: z.literal('role'),
  role: z.string(),
});

const AuthoredRoleOwnsTaskActorMatcherSchema = z.object({
  kind: z.literal('role-owns-task'),
  role: z.string(),
});

const AuthoredRoleBoundedTransitionsActorMatcherSchema = z.object({
  kind: z.literal('role-bounded-transitions'),
  role: z.string(),
  transitions: z.array(z.string()),
});

export const AuthoredActorMatcherSchema = z.discriminatedUnion('kind', [
  ManagerActorRefSchema,
  AuthoredRoleActorMatcherSchema,
  SystemActorRefSchema,
  AuthoredRoleOwnsTaskActorMatcherSchema,
  AuthoredRoleBoundedTransitionsActorMatcherSchema,
]);

export const AuthoredInitialTaskSchema = z
  .object({
    taskId: z.string(),
    title: z.string(),
    ownerActor: z.string().nullable().optional(),
    dependsOn: z.array(z.string()).default([]),
  })
  .strict();

export const AuthoredSpecSchema = z
  .object({
    runId: z.string(),
    scenarioRef: z.string(),
    runProfileRef: z.string(),
    actors: z.record(AuthoredActorRefSchema),
    declaredActors: z.array(z.string()),
    initialTasks: z.array(AuthoredInitialTaskSchema).optional(),
    policy: z.record(z.array(AuthoredActorMatcherSchema)).optional(),
  })
  .strict();

export const AUTHORITY_POLICY_INTENT_VALUES = PROTOCOL_REQUEST_INTENT_VALUES;

export type ActorMatcher = z.infer<typeof ActorMatcherSchema>;
export type AuthorityPolicy = z.infer<typeof AuthorityPolicySchema>;
export type TeamContextInitialTask = z.infer<typeof TeamContextInitialTaskSchema>;
export type TeamContext = z.infer<typeof TeamContextSchema>;
export type AuthoredActorRef = z.infer<typeof AuthoredActorRefSchema>;
export type AuthoredActorMatcher = z.infer<typeof AuthoredActorMatcherSchema>;
export type AuthoredInitialTask = z.infer<typeof AuthoredInitialTaskSchema>;
export type AuthoredSpec = z.infer<typeof AuthoredSpecSchema>;
export type AuthorityPolicyIntent = ProtocolRequestIntent;
