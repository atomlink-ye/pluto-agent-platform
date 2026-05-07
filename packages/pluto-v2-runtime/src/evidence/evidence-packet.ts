import { z } from 'zod';

import {
  ArtifactPublishedPayloadSchema,
  MailboxProjectionMessageSchema,
  RunCompletedStatusSchema,
  RunEventKindSchema,
  SCHEMA_VERSION,
  TaskProjectionViewStateSchema,
  type ReplayViews,
  type RunEvent,
} from '@pluto/v2-core';

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
  startedAt: z.string().datetime().nullable(),
  completedAt: z.string().datetime().nullable(),
  generatedAt: z.string().datetime(),
  citations: z.array(EvidencePacketCitationSchema),
  tasks: TaskProjectionViewStateSchema.shape.tasks,
  mailboxMessages: z.array(EvidencePacketMailboxMessageSchema),
  artifacts: z.array(ArtifactPublishedPayloadSchema),
});

export type EvidencePacket = z.infer<typeof EvidencePacketShape>;

export const assembleEvidencePacket = (
  views: ReplayViews,
  events: readonly RunEvent[],
  runId: string,
): EvidencePacket => {
  const eventById = new Map(events.map((event) => [event.eventId, event] as const));
  const run = views.evidence.run;
  const generatedAt = events.at(-1)?.timestamp ?? run?.completedAt ?? run?.startedAt;

  if (generatedAt == null) {
    throw new Error('Cannot assemble evidence packet without any event timestamp');
  }

  return EvidencePacketShape.parse({
    schemaVersion: SCHEMA_VERSION,
    kind: 'evidence_packet',
    runId,
    status: run?.status ?? 'in_progress',
    summary: run?.summary ?? null,
    startedAt: run?.startedAt ?? null,
    completedAt: run?.completedAt ?? null,
    generatedAt,
    citations: views.evidence.citations.map((citation) => {
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
    mailboxMessages: views.mailbox.messages.map((message) => ({
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
  });
};
