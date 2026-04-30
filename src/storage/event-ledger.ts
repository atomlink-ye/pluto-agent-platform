import type { EventLedgerEntryV0, StorageRefV0 } from "../contracts/storage.js";
import { toStorageRefV0 } from "../contracts/storage.js";
import type { StorageStore } from "./storage-store.js";
import { isSameStorageRefV0 } from "./retention.js";

export const STORAGE_EVENT_RESULT_STATUSES_V0 = [
  "queued",
  "running",
  "blocked",
  "failed",
  "succeeded",
] as const;

export type StorageEventResultStatusV0 = typeof STORAGE_EVENT_RESULT_STATUSES_V0[number];
export type StorageEventResultStatusLikeV0 = StorageEventResultStatusV0 | "done" | (string & {});

export interface AppendLedgerEventInputV0 {
  store: StorageStore;
  event: EventLedgerEntryV0;
  idempotencyKey?: string;
  correlationId?: string;
  durableWriteAvailable?: boolean;
}

export interface AppendLedgerEventResultV0 {
  status: StorageEventResultStatusV0;
  durable: boolean;
  duplicate: boolean;
  record: EventLedgerEntryV0 | null;
  ref: StorageRefV0 | null;
  reason: string | null;
}

const STORAGE_EVENT_RESULT_STATUS_SET = new Set<string>(STORAGE_EVENT_RESULT_STATUSES_V0);

export function normalizeStorageEventResultStatusV0(
  value: unknown,
): StorageEventResultStatusLikeV0 | null {
  if (typeof value !== "string") return null;
  if (value === "done") return "succeeded";
  if (STORAGE_EVENT_RESULT_STATUS_SET.has(value)) {
    return value as StorageEventResultStatusV0;
  }

  return value;
}

export async function appendLedgerEventV0(
  input: AppendLedgerEventInputV0,
): Promise<AppendLedgerEventResultV0> {
  const duplicate = await findDuplicateLedgerEventV0({
    store: input.store,
    workspaceId: input.event.workspaceId,
    subjectRef: input.event.subjectRef,
    eventType: input.event.eventType,
    idempotencyKey: input.idempotencyKey,
    correlationId: input.correlationId,
  });

  if (duplicate !== null) {
    return {
      status: "succeeded",
      durable: true,
      duplicate: true,
      record: duplicate,
      ref: toStorageRefV0(duplicate),
      reason: null,
    };
  }

  if (input.durableWriteAvailable === false) {
    return {
      status: "blocked",
      durable: false,
      duplicate: false,
      record: null,
      ref: null,
      reason: "durable_write_unavailable",
    };
  }

  const record = withEventIdentity(input.event, input.idempotencyKey, input.correlationId);
  await input.store.put("event_ledger", record);

  return {
    status: "succeeded",
    durable: true,
    duplicate: false,
    record,
    ref: toStorageRefV0(record),
    reason: null,
  };
}

export async function findDuplicateLedgerEventV0(input: {
  store: StorageStore;
  workspaceId: string;
  subjectRef: StorageRefV0;
  eventType: string;
  idempotencyKey?: string;
  correlationId?: string;
}): Promise<EventLedgerEntryV0 | null> {
  if (!input.idempotencyKey && !input.correlationId) {
    return null;
  }

  const records = await input.store.list("event_ledger");
  return records.find((record) => {
    if (record.workspaceId !== input.workspaceId) {
      return false;
    }

    if (record.eventType !== input.eventType || !isSameStorageRefV0(record.subjectRef, input.subjectRef)) {
      return false;
    }

    const detail = record.detail as Record<string, unknown>;
    return (
      (typeof input.idempotencyKey === "string" && detail["idempotencyKey"] === input.idempotencyKey)
      || (typeof input.correlationId === "string" && detail["correlationId"] === input.correlationId)
    );
  }) ?? null;
}

function withEventIdentity(
  event: EventLedgerEntryV0,
  idempotencyKey?: string,
  correlationId?: string,
): EventLedgerEntryV0 {
  const detail: Record<string, unknown> = { ...event.detail };
  if (idempotencyKey) {
    detail["idempotencyKey"] = idempotencyKey;
  }

  if (correlationId) {
    detail["correlationId"] = correlationId;
  }

  return {
    ...event,
    detail,
  };
}
