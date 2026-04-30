import type { InboundWorkItemRecordV0 } from "../contracts/integration.js";
import type { IntegrationStore } from "./integration-store.js";

export async function claimInboundWorkItem(input: {
  store: IntegrationStore;
  inboundWorkItemId: string;
  actorId: string;
  claimedAt: string;
}): Promise<InboundWorkItemRecordV0> {
  const record = await requireInboundWorkItem(input.store, input.inboundWorkItemId);
  return persistPatchedInboundWorkItem(input.store, record, {
    status: "claimed",
    updatedAt: input.claimedAt,
    relatedRecordRefs: appendUnique(record.relatedRecordRefs, `claim:${input.actorId}:${input.claimedAt}`),
  });
}

export async function linkInboundWorkItem(input: {
  store: IntegrationStore;
  inboundWorkItemId: string;
  actorId: string;
  linkedAt: string;
  relatedRecordRef: string;
  status?: string;
  processedAt?: string | null;
}): Promise<InboundWorkItemRecordV0> {
  const record = await requireInboundWorkItem(input.store, input.inboundWorkItemId);
  return persistPatchedInboundWorkItem(input.store, record, {
    status: input.status ?? record.status,
    updatedAt: input.linkedAt,
    processedAt: input.processedAt ?? record.processedAt,
    relatedRecordRefs: appendUnique(
      appendUnique(record.relatedRecordRefs, input.relatedRecordRef),
      `link:${input.actorId}:${input.linkedAt}:${input.relatedRecordRef}`,
    ),
  });
}

export async function abandonInboundWorkItem(input: {
  store: IntegrationStore;
  inboundWorkItemId: string;
  actorId: string;
  reason: string;
  abandonedAt: string;
}): Promise<InboundWorkItemRecordV0> {
  const record = await requireInboundWorkItem(input.store, input.inboundWorkItemId);
  const reason = input.reason.replace(/\s+/g, "_").slice(0, 80);
  return persistPatchedInboundWorkItem(input.store, record, {
    status: "abandoned",
    processedAt: input.abandonedAt,
    updatedAt: input.abandonedAt,
    relatedRecordRefs: appendUnique(record.relatedRecordRefs, `abandon:${input.actorId}:${input.abandonedAt}:${reason}`),
  });
}

async function requireInboundWorkItem(store: IntegrationStore, id: string): Promise<InboundWorkItemRecordV0> {
  const record = await store.get("inbound_work_item", id);
  if (record === null) {
    throw new Error(`inbound work item not found: ${id}`);
  }
  return record;
}

async function persistPatchedInboundWorkItem(
  store: IntegrationStore,
  record: InboundWorkItemRecordV0,
  patch: Partial<InboundWorkItemRecordV0>,
): Promise<InboundWorkItemRecordV0> {
  const updated: InboundWorkItemRecordV0 = { ...record, ...patch };
  await store.put("inbound_work_item", updated);
  return updated;
}

function appendUnique(values: string[], next: string): string[] {
  return values.includes(next) ? values : [...values, next];
}
