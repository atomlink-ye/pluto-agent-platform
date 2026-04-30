import type {
  ActorRefV0,
  DeletionRequestV0,
  StorageRecordV0,
  StorageRefV0,
  TombstoneRecordV0,
} from "../contracts/storage.js";
import { toStorageRefV0 } from "../contracts/storage.js";
import type { StorageStore } from "./storage-store.js";
import { appendLedgerEventV0 } from "./event-ledger.js";
import { canShortenRetentionV0, evaluateRetentionForDeletionV0 } from "./retention.js";

export interface RequestDeletionInputV0 {
  store: StorageStore;
  target: StorageRecordV0;
  requestedBy: ActorRefV0;
  requestedAt: string;
  reason: string;
  deletionRequestId: string;
  tombstoneId?: string;
  approvalRef?: StorageRefV0;
  durableWriteAvailable?: boolean;
  nextRetentionClass?: string;
}

export interface RequestDeletionResultV0 {
  status: "blocked" | "deleted" | "tombstoned";
  reason: string | null;
  deletionRequest: DeletionRequestV0 | null;
  tombstone: TombstoneRecordV0 | null;
}

export async function requestDeletionV0(
  input: RequestDeletionInputV0,
): Promise<RequestDeletionResultV0> {
  const targetRef = toStorageRefV0(input.target);
  const holds = await input.store.list("legal_hold_overlay");
  const policies = await input.store.list("retention_policy");
  const retention = evaluateRetentionForDeletionV0({
    retentionClass: input.target.retentionClass,
    targetRef,
    policies,
    holds,
    now: input.requestedAt,
  });

  if (typeof input.nextRetentionClass === "string") {
    const shortening = canShortenRetentionV0({
      currentClass: input.target.retentionClass,
      nextClass: input.nextRetentionClass,
      targetRef,
      holds,
      now: input.requestedAt,
    });
    if (!shortening.allowed) {
      await appendBlockedDeletionEventV0(input, targetRef, shortening.reason ?? "retention_change_blocked");
      return {
        status: "blocked",
        reason: shortening.reason,
        deletionRequest: null,
        tombstone: null,
      };
    }
  }

  if (retention.blockingReasons.length > 0) {
    const reason = retention.blockingReasons[0] ?? "deletion_blocked";
    await appendBlockedDeletionEventV0(input, targetRef, reason);
    return {
      status: "blocked",
      reason,
      deletionRequest: null,
      tombstone: null,
    };
  }

  if (input.durableWriteAvailable === false) {
    return {
      status: "blocked",
      reason: "durable_write_unavailable",
      deletionRequest: null,
      tombstone: null,
    };
  }

  const deletionRequest = buildDeletionRequestV0(input, targetRef);
  await input.store.put("deletion_request", deletionRequest);

  if (retention.rule.requiresTombstone) {
    const tombstone = buildTombstoneRecordV0(input, targetRef, deletionRequest);
    await input.store.put("tombstone", tombstone);
    await appendLedgerEventV0({
      store: input.store,
      durableWriteAvailable: true,
      event: buildDeletionEventV0({
        target: input.target,
        targetRef,
        eventId: `${input.deletionRequestId}-event`,
        occurredAt: input.requestedAt,
        eventType: "storage.tombstoned",
        detail: {
          deletionRequestId: deletionRequest.id,
          tombstoneId: tombstone.id,
          resultStatus: "succeeded",
        },
      }),
      idempotencyKey: input.deletionRequestId,
      correlationId: deletionRequest.id,
    });
    await input.store.delete(input.target.kind, input.target.id);

    return {
      status: "tombstoned",
      reason: null,
      deletionRequest,
      tombstone,
    };
  }

  await appendLedgerEventV0({
    store: input.store,
    durableWriteAvailable: true,
    event: buildDeletionEventV0({
      target: input.target,
      targetRef,
      eventId: `${input.deletionRequestId}-event`,
      occurredAt: input.requestedAt,
      eventType: "storage.deleted",
      detail: {
        deletionRequestId: deletionRequest.id,
        resultStatus: "succeeded",
      },
    }),
    idempotencyKey: input.deletionRequestId,
    correlationId: deletionRequest.id,
  });
  await input.store.delete(input.target.kind, input.target.id);

  return {
    status: "deleted",
    reason: null,
    deletionRequest,
    tombstone: null,
  };
}

function buildDeletionRequestV0(
  input: RequestDeletionInputV0,
  targetRef: StorageRefV0,
): DeletionRequestV0 {
  return {
    schemaVersion: 0,
    storageVersion: "local-v0",
    kind: "deletion_request",
    id: input.deletionRequestId,
    workspaceId: input.target.workspaceId,
    objectType: input.target.objectType,
    status: "active",
    actorRefs: [input.requestedBy, ...input.target.actorRefs],
    createdAt: input.requestedAt,
    updatedAt: input.requestedAt,
    retentionClass: input.target.retentionClass,
    sensitivityClass: input.target.sensitivityClass,
    summary: `Deletion request for ${input.target.summary}`,
    targetRef,
    requestedBy: input.requestedBy,
    requestedAt: input.requestedAt,
    reason: input.reason,
    approvalRef: input.approvalRef,
    deletionGuarantee: "best-effort-local",
  };
}

function buildTombstoneRecordV0(
  input: RequestDeletionInputV0,
  targetRef: StorageRefV0,
  deletionRequest: DeletionRequestV0,
): TombstoneRecordV0 {
  return {
    schemaVersion: 0,
    storageVersion: "local-v0",
    kind: "tombstone",
    id: input.tombstoneId ?? `${input.deletionRequestId}-tombstone`,
    workspaceId: input.target.workspaceId,
    objectType: input.target.objectType,
    status: "deleted",
    actorRefs: [input.requestedBy, ...input.target.actorRefs],
    createdAt: input.requestedAt,
    updatedAt: input.requestedAt,
    retentionClass: input.target.retentionClass,
    sensitivityClass: input.target.sensitivityClass,
    summary: `Tombstone for ${input.target.summary}`,
    targetRef,
    tombstonedAt: input.requestedAt,
    tombstoneReason: input.reason,
    deletionRequestRef: toStorageRefV0(deletionRequest),
    priorChecksum: "checksum" in input.target ? input.target.checksum : undefined,
  };
}

function buildDeletionEventV0(input: {
  target: StorageRecordV0;
  targetRef: StorageRefV0;
  eventId: string;
  occurredAt: string;
  eventType: string;
  detail: Record<string, unknown>;
}) {
  return {
    schemaVersion: 0 as const,
    storageVersion: "local-v0" as const,
    kind: "event_ledger" as const,
    id: input.eventId,
    workspaceId: input.target.workspaceId,
    objectType: input.target.objectType,
    status: "active",
    actorRefs: input.target.actorRefs,
    createdAt: input.occurredAt,
    updatedAt: input.occurredAt,
    retentionClass: input.target.retentionClass,
    sensitivityClass: input.target.sensitivityClass,
    summary: `${input.eventType} for ${input.target.summary}`,
    eventType: input.eventType,
    subjectRef: input.targetRef,
    occurredAt: input.occurredAt,
    detail: input.detail,
  };
}

async function appendBlockedDeletionEventV0(
  input: RequestDeletionInputV0,
  targetRef: StorageRefV0,
  reason: string,
): Promise<void> {
  await appendLedgerEventV0({
    store: input.store,
    durableWriteAvailable: input.durableWriteAvailable,
    event: buildDeletionEventV0({
      target: input.target,
      targetRef,
      eventId: `${input.deletionRequestId}-blocked`,
      occurredAt: input.requestedAt,
      eventType: "storage.deletion_blocked",
      detail: {
        reason,
        resultStatus: "blocked",
      },
    }),
    idempotencyKey: `${input.deletionRequestId}:blocked`,
    correlationId: input.deletionRequestId,
  });
}
