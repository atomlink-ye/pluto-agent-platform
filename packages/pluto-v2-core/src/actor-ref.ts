import { z } from 'zod';

export const ACTOR_REF_KIND_VALUES = ['manager', 'role', 'system'] as const;
export type ActorRefKind = (typeof ACTOR_REF_KIND_VALUES)[number];

// Canonical built-in roles remain useful for docs and runtime UX, but they are no longer the validation gate.
export const BUILTIN_ROLES = ['lead', 'planner', 'generator', 'evaluator'] as const;
export const ACTOR_ROLE_VALUES = BUILTIN_ROLES;

export const ActorRoleSchema = z.string().max(64).regex(/^[a-z][a-z0-9_-]*$/);

export const ManagerActorRefSchema = z.object({
  kind: z.literal('manager'),
});

export const RoleActorRefSchema = z.object({
  kind: z.literal('role'),
  role: ActorRoleSchema,
});

export const SystemActorRefSchema = z.object({
  kind: z.literal('system'),
});

export const ActorRefSchema = z.discriminatedUnion('kind', [
  ManagerActorRefSchema,
  RoleActorRefSchema,
  SystemActorRefSchema,
]);

export type ActorRole = z.infer<typeof ActorRoleSchema>;

export type ManagerActorRef = z.infer<typeof ManagerActorRefSchema>;
export type RoleActorRef = z.infer<typeof RoleActorRefSchema>;
export type SystemActorRef = z.infer<typeof SystemActorRefSchema>;
export type ActorRef = z.infer<typeof ActorRefSchema>;
