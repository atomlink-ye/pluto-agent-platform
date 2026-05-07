import { z } from 'zod';

export const REJECTION_REASON_VALUES = [
  'actor_not_authorized',
  'entity_unknown',
  'state_conflict',
  'schema_invalid',
  'idempotency_replay',
  'intent_unknown',
] as const;

export type RejectionReason = (typeof REJECTION_REASON_VALUES)[number];

export const RejectionReasonSchema = z.enum(REJECTION_REASON_VALUES);

export const AuthorityValidationAcceptedSchema = z.object({
  ok: z.literal(true),
});

export const AuthorityValidationRejectedSchema = z.object({
  ok: z.literal(false),
  reason: RejectionReasonSchema,
  detail: z.string(),
});

export const AuthorityValidationOutcomeSchema = z.discriminatedUnion('ok', [
  AuthorityValidationAcceptedSchema,
  AuthorityValidationRejectedSchema,
]);

export type AuthorityValidationAccepted = z.infer<typeof AuthorityValidationAcceptedSchema>;
export type AuthorityValidationRejected = z.infer<typeof AuthorityValidationRejectedSchema>;
export type AuthorityValidationOutcome = z.infer<typeof AuthorityValidationOutcomeSchema>;
