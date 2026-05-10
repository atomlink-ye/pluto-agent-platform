import { z } from 'zod';

import {
  ActorRefSchema,
  type ActorRef,
} from '@pluto/v2-core/actor-ref';
import {
  MailboxProjectionMessageSchema,
  TaskProjectionViewStateSchema,
} from '@pluto/v2-core/projections';
import type { ReplayViews } from '@pluto/v2-core/projections/replay';
import {
  ArtifactPublishedPayloadSchema,
  RunCompletedStatusSchema,
  RunEventKindSchema,
  type RunEvent,
} from '@pluto/v2-core/run-event';
import { SCHEMA_VERSION } from '@pluto/v2-core/versioning';

const RuntimeBridgeUnavailableSchema = z.object({
  actor: z.string(),
  reason: z.string(),
  latencyMs: z.number(),
});

const RuntimeTaskCloseoutRejectedSchema = z.object({
  actor: z.string(),
  taskId: z.string(),
  reason: z.string(),
});

const RuntimeWaitTraceSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('wait_armed'),
    actor: z.string(),
    fromSequence: z.number(),
    armedAt: z.string().datetime(),
  }),
  z.object({
    kind: z.literal('wait_unblocked'),
    actor: z.string(),
    eventId: z.string().uuid(),
    sequence: z.number(),
    latencyMs: z.number(),
  }),
  z.object({
    kind: z.literal('wait_timed_out'),
    actor: z.string(),
    timeoutMs: z.number(),
  }),
  z.object({
    kind: z.literal('wait_cancelled'),
    actor: z.string(),
    reason: z.string(),
  }),
]);

export const RuntimeDiagnosticsSchema = z.object({
  bridgeUnavailable: z.array(RuntimeBridgeUnavailableSchema).optional(),
  taskCloseoutRejected: z.array(RuntimeTaskCloseoutRejectedSchema).optional(),
  waitTraces: z.array(RuntimeWaitTraceSchema).optional(),
});

export type RuntimeDiagnostics = z.infer<typeof RuntimeDiagnosticsSchema>;
export type RuntimeWaitTrace = z.infer<typeof RuntimeWaitTraceSchema>;

type RuntimeTraceInput =
  | {
      readonly kind: 'bridge_unavailable';
      readonly actor: string;
      readonly reason: string;
      readonly latencyMs: number;
    }
  | {
      readonly kind: 'task_closeout_rejected';
      readonly actor: string;
      readonly taskId: string;
      readonly reason: string;
    }
  | RuntimeWaitTrace;

type EvidenceCitationView = {
  readonly eventId: string;
  readonly kind: z.infer<typeof RunEventKindSchema>;
  readonly summary: string;
};

type MailboxMessageView = {
  readonly messageId: string;
  readonly fromActor: ActorRef;
  readonly toActor: ActorRef;
  readonly kind: string;
  readonly body: string;
  readonly sequence: number;
};

export const EvidencePacketCitationSchema = z.object({
  eventId: z.string().uuid(),
  kind: RunEventKindSchema,
  text: z.string(),
  observedAt: z.string().datetime(),
});

export const EvidencePacketMailboxMessageSchema = MailboxProjectionMessageSchema.omit({
  eventId: true,
});

export const EvidencePacketShape = z.object({
  schemaVersion: z.literal(SCHEMA_VERSION),
  kind: z.literal('evidence_packet'),
  runId: z.string(),
  status: z.union([RunCompletedStatusSchema, z.literal('in_progress')]),
  summary: z.string().nullable(),
  initiatingActor: ActorRefSchema.nullable().optional(),
  startedAt: z.string().datetime().nullable(),
  completedAt: z.string().datetime().nullable(),
  generatedAt: z.string().datetime(),
  citations: z.array(EvidencePacketCitationSchema),
  tasks: TaskProjectionViewStateSchema.shape.tasks,
  mailboxMessages: z.array(EvidencePacketMailboxMessageSchema),
  artifacts: z.array(ArtifactPublishedPayloadSchema),
  runtimeDiagnostics: RuntimeDiagnosticsSchema.optional(),
});

export type EvidencePacket = Omit<z.infer<typeof EvidencePacketShape>, 'initiatingActor'> & {
  initiatingActor: ActorRef | null;
};

function toRuntimeDiagnostics(
  runtimeTraces: ReadonlyArray<RuntimeTraceInput> | undefined,
): RuntimeDiagnostics | undefined {
  if (runtimeTraces == null || runtimeTraces.length === 0) {
    return undefined;
  }

  return {
    bridgeUnavailable: runtimeTraces
      .filter((trace): trace is Extract<RuntimeTraceInput, { kind: 'bridge_unavailable' }> =>
        trace.kind === 'bridge_unavailable',
      )
      .map((trace) => ({
        actor: trace.actor,
        reason: trace.reason,
        latencyMs: trace.latencyMs,
      })),
    taskCloseoutRejected: runtimeTraces
      .filter((trace): trace is Extract<RuntimeTraceInput, { kind: 'task_closeout_rejected' }> =>
        trace.kind === 'task_closeout_rejected',
      )
      .map((trace) => ({
        actor: trace.actor,
        taskId: trace.taskId,
        reason: trace.reason,
      })),
    waitTraces: runtimeTraces.filter((trace): trace is RuntimeWaitTrace =>
      trace.kind === 'wait_armed'
      || trace.kind === 'wait_unblocked'
      || trace.kind === 'wait_timed_out'
      || trace.kind === 'wait_cancelled',
    ),
  };
}

export const assembleEvidencePacket = (
  views: ReplayViews,
  events: readonly RunEvent[],
  runId: string,
  options?: {
    readonly initiatingActor?: ActorRef | null;
    readonly runtimeTraces?: ReadonlyArray<RuntimeTraceInput>;
  },
): EvidencePacket => {
  const eventById = new Map(events.map((event) => [event.eventId, event] as const));
  const run = views.evidence.run;
  const generatedAt = events.at(-1)?.timestamp ?? run?.completedAt ?? run?.startedAt;

  if (generatedAt == null) {
    throw new Error('Cannot assemble evidence packet without any event timestamp');
  }

  const parsed = EvidencePacketShape.parse({
    schemaVersion: SCHEMA_VERSION,
    kind: 'evidence_packet',
    runId,
    status: run?.status ?? 'in_progress',
    summary: run?.summary ?? null,
    initiatingActor: options?.initiatingActor ?? null,
    startedAt: run?.startedAt ?? null,
    completedAt: run?.completedAt ?? null,
    generatedAt,
    citations: (views.evidence.citations as ReadonlyArray<EvidenceCitationView>).map((citation) => {
      const event = eventById.get(citation.eventId);
      if (!event) {
        throw new Error(`Missing event for citation "${citation.eventId}"`);
      }

      return {
        eventId: citation.eventId,
        kind: citation.kind,
        text: citation.summary,
        observedAt: event.timestamp,
      };
    }),
    tasks: views.task.tasks,
    mailboxMessages: (views.mailbox.messages as ReadonlyArray<MailboxMessageView>).map((message) => ({
      messageId: message.messageId,
      fromActor: message.fromActor,
      toActor: message.toActor,
      kind: message.kind,
      body: message.body,
      sequence: message.sequence,
    })),
    artifacts: events
      .filter((event): event is Extract<RunEvent, { kind: 'artifact_published' }> =>
        event.kind === 'artifact_published',
      )
      .map((event) => ({
        artifactId: event.payload.artifactId,
        kind: event.payload.kind,
        mediaType: event.payload.mediaType,
        byteSize: event.payload.byteSize,
      })),
    runtimeDiagnostics: toRuntimeDiagnostics(options?.runtimeTraces),
  });

  return {
    ...parsed,
    initiatingActor: parsed.initiatingActor ?? null,
  };
};
