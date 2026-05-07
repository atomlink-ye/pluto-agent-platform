import { z } from 'zod';

export const ENTITY_REF_KIND_VALUES = ['run', 'task', 'mailbox_message', 'artifact'] as const;
export type EntityRefKind = (typeof ENTITY_REF_KIND_VALUES)[number];

export const RunEntityRefSchema = z.object({
  kind: z.literal('run'),
  runId: z.string(),
});

export const TaskEntityRefSchema = z.object({
  kind: z.literal('task'),
  taskId: z.string(),
});

export const MailboxMessageEntityRefSchema = z.object({
  kind: z.literal('mailbox_message'),
  messageId: z.string(),
});

export const ArtifactEntityRefSchema = z.object({
  kind: z.literal('artifact'),
  artifactId: z.string(),
});

export const EntityRefSchema = z.discriminatedUnion('kind', [
  RunEntityRefSchema,
  TaskEntityRefSchema,
  MailboxMessageEntityRefSchema,
  ArtifactEntityRefSchema,
]);

export type RunEntityRef = z.infer<typeof RunEntityRefSchema>;
export type TaskEntityRef = z.infer<typeof TaskEntityRefSchema>;
export type MailboxMessageEntityRef = z.infer<typeof MailboxMessageEntityRefSchema>;
export type ArtifactEntityRef = z.infer<typeof ArtifactEntityRefSchema>;
export type EntityRef = z.infer<typeof EntityRefSchema>;
