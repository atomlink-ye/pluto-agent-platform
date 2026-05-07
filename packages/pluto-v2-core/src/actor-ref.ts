import { z } from 'zod';

export const ACTOR_REF_KIND_VALUES = ['manager', 'role', 'system'] as const;
export type ActorRefKind = (typeof ACTOR_REF_KIND_VALUES)[number];

export const ACTOR_ROLE_VALUES = ['lead', 'planner', 'generator', 'evaluator'] as const;
export type ActorRole = (typeof ACTOR_ROLE_VALUES)[number];

export const ActorRoleSchema = z.enum(ACTOR_ROLE_VALUES);

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

export type ManagerActorRef = z.infer<typeof ManagerActorRefSchema>;
export type RoleActorRef = z.infer<typeof RoleActorRefSchema>;
export type SystemActorRef = z.infer<typeof SystemActorRefSchema>;
export type ActorRef = z.infer<typeof ActorRefSchema>;
