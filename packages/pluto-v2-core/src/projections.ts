import { z } from 'zod';

import { ActorRefSchema } from './actor-ref.js';
import {
  BroadcastActorRefSchema,
  MailboxMessageKindSchema,
  RUN_EVENT_KIND_VALUES,
  RunCompletedStatusSchema,
  RunEventKindSchema,
  TaskStateSchema,
} from './run-event.js';
import type {
  ActorRef,
} from './actor-ref.js';
import type {
  BroadcastActorRef,
  MailboxMessageKind,
  RunCompletedPayload,
  RunEvent,
  RunEventKind,
  RunStartedPayload,
  TaskCreatedPayload,
  TaskState,
  TaskStateChangedPayload,
} from './run-event.js';

export type TaskId = TaskCreatedPayload['taskId'];
export type ProjectionEventId = RunEvent['eventId'];
export type ProjectionSequence = RunEvent['sequence'];
export const ALL_RUN_EVENT_KINDS = RUN_EVENT_KIND_VALUES;

export interface ProjectionContractLike {
  inputKinds: readonly RunEventKind[];
  outOfScopeKinds: readonly RunEventKind[];
}

export interface ProjectionContract<
  TView,
  TInputKinds extends readonly RunEventKind[],
  TOutOfScopeKinds extends readonly RunEventKind[],
> extends ProjectionContractLike {
  view: TView;
  inputKinds: TInputKinds;
  outOfScopeKinds: TOutOfScopeKinds;
}

export type ProjectionInputKind<TProjection extends ProjectionContractLike> =
  TProjection['inputKinds'][number];

export type ProjectionOutOfScopeKind<TProjection extends ProjectionContractLike> =
  TProjection['outOfScopeKinds'][number];

export type ProjectionKindsUnion<TProjection extends ProjectionContractLike> =
  ProjectionInputKind<TProjection> | ProjectionOutOfScopeKind<TProjection>;

export type ProjectionKindsIntersection<TProjection extends ProjectionContractLike> = Extract<
  ProjectionInputKind<TProjection>,
  ProjectionOutOfScopeKind<TProjection>
>;

export type MissingProjectionKinds<TProjection extends ProjectionContractLike> = Exclude<
  RunEventKind,
  ProjectionKindsUnion<TProjection>
>;

export type OverlappingProjectionKinds<TProjection extends ProjectionContractLike> =
  ProjectionKindsIntersection<TProjection>;

export type ProjectionKindCoverageCheck<TProjection extends ProjectionContractLike> = {
  missing: MissingProjectionKinds<TProjection>;
  overlapping: OverlappingProjectionKinds<TProjection>;
};

export type ProjectionKindCoverageIsComplete<TProjection extends ProjectionContractLike> = [
  MissingProjectionKinds<TProjection>,
] extends [never]
  ? true
  : false;

export type ProjectionKindCoverageIsDisjoint<TProjection extends ProjectionContractLike> = [
  OverlappingProjectionKinds<TProjection>,
] extends [never]
  ? true
  : false;

export type ProjectionKindCoverageIsExact<TProjection extends ProjectionContractLike> =
  ProjectionKindCoverageIsComplete<TProjection> extends true
    ? ProjectionKindCoverageIsDisjoint<TProjection> extends true
      ? true
      : false
    : false;

export const TaskProjectionTaskHistoryEntrySchema = z.object({
  from: TaskStateSchema,
  to: TaskStateSchema,
  eventId: z.string().uuid(),
});

export const TaskProjectionTaskSchema = z.object({
  title: z.string(),
  ownerActor: ActorRefSchema.nullable(),
  state: TaskStateSchema,
  dependsOn: z.array(z.string()),
  history: z.array(TaskProjectionTaskHistoryEntrySchema),
});

export const TaskProjectionViewStateSchema = z.object({
  tasks: z.record(TaskProjectionTaskSchema),
});

export const TASK_PROJECTION_INPUT_KINDS = [
  'task_created',
  'task_state_changed',
] as const satisfies readonly RunEventKind[];

export const TASK_PROJECTION_OUT_OF_SCOPE_KINDS = [
  'run_started',
  'run_completed',
  'mailbox_message_appended',
  'artifact_published',
  'request_rejected',
] as const satisfies readonly RunEventKind[];

export type TaskProjectionTaskHistoryEntry = z.infer<typeof TaskProjectionTaskHistoryEntrySchema>;
export type TaskProjectionTask = z.infer<typeof TaskProjectionTaskSchema>;
export type TaskProjectionViewState = z.infer<typeof TaskProjectionViewStateSchema>;

export type TaskProjectionView = ProjectionContract<
  TaskProjectionViewState,
  typeof TASK_PROJECTION_INPUT_KINDS,
  typeof TASK_PROJECTION_OUT_OF_SCOPE_KINDS
>;

export const MailboxProjectionMessageSchema = z.object({
  messageId: z.string(),
  fromActor: ActorRefSchema,
  toActor: z.union([ActorRefSchema, BroadcastActorRefSchema]),
  kind: MailboxMessageKindSchema,
  body: z.string(),
  sequence: z.number().int().nonnegative(),
  eventId: z.string().uuid(),
});

export const MailboxProjectionViewStateSchema = z.object({
  messages: z.array(MailboxProjectionMessageSchema),
});

export const MAILBOX_PROJECTION_INPUT_KINDS = [
  'mailbox_message_appended',
] as const satisfies readonly RunEventKind[];

export const MAILBOX_PROJECTION_OUT_OF_SCOPE_KINDS = [
  'run_started',
  'run_completed',
  'task_created',
  'task_state_changed',
  'artifact_published',
  'request_rejected',
] as const satisfies readonly RunEventKind[];

export type MailboxProjectionMessage = z.infer<typeof MailboxProjectionMessageSchema>;
export type MailboxProjectionViewState = z.infer<typeof MailboxProjectionViewStateSchema>;

export type MailboxProjectionView = ProjectionContract<
  MailboxProjectionViewState,
  typeof MAILBOX_PROJECTION_INPUT_KINDS,
  typeof MAILBOX_PROJECTION_OUT_OF_SCOPE_KINDS
>;

export const EvidenceProjectionRunSchema = z.object({
  runId: z.string(),
  status: RunCompletedStatusSchema,
  startedAt: z.string().datetime(),
  completedAt: z.string().datetime(),
  summary: z.string().nullable(),
});

export const EvidenceProjectionCitationSchema = z.object({
  eventId: z.string().uuid(),
  sequence: z.number().int().nonnegative(),
  kind: RunEventKindSchema,
  summary: z.string(),
});

export const EvidenceProjectionViewStateSchema = z.object({
  run: EvidenceProjectionRunSchema.nullable(),
  citations: z.array(EvidenceProjectionCitationSchema),
});

export const EVIDENCE_PROJECTION_INPUT_KINDS = [
  'run_started',
  'run_completed',
  'mailbox_message_appended',
  'task_created',
  'task_state_changed',
  'artifact_published',
  'request_rejected',
] as const satisfies readonly RunEventKind[];

export const EVIDENCE_PROJECTION_OUT_OF_SCOPE_KINDS = [] as const satisfies readonly RunEventKind[];

export type EvidenceProjectionRun = z.infer<typeof EvidenceProjectionRunSchema>;
export type EvidenceProjectionCitation = z.infer<typeof EvidenceProjectionCitationSchema>;
export type EvidenceProjectionViewState = z.infer<typeof EvidenceProjectionViewStateSchema>;

export type EvidenceProjectionView = ProjectionContract<
  EvidenceProjectionViewState,
  typeof EVIDENCE_PROJECTION_INPUT_KINDS,
  typeof EVIDENCE_PROJECTION_OUT_OF_SCOPE_KINDS
>;

export type TaskProjectionOwnerActor = ActorRef | null;
export type TaskProjectionStateValue = TaskState;
export type MailboxProjectionRecipient = ActorRef | BroadcastActorRef;
export type MailboxProjectionKind = MailboxMessageKind;
export type EvidenceProjectionStatus = RunCompletedPayload['status'];
export type EvidenceProjectionStartedAt = RunStartedPayload['startedAt'];
