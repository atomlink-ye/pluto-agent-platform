import type { InboundWorkItemRecordV0 } from "../contracts/integration.js";
import { toIntegrationRecordRefV0 } from "../contracts/integration.js";
import type { SecurityStore } from "../security/security-store.js";
import type { IntegrationStore } from "./integration-store.js";
import { emitInboundRejectAuditV0 } from "./inbound-audit.js";
import type { AdaptedSyntheticInboundV0 } from "./work-source-adapter.js";

export async function normalizeSyntheticInboundWorkItem(input: {
  store: IntegrationStore;
  adapted: AdaptedSyntheticInboundV0;
  securityStore?: SecurityStore;
  idGen?: () => string;
}): Promise<InboundWorkItemRecordV0> {
  const existing = await input.store.list("inbound_work_item");
  if (existing.some((record) => record.dedupeKey === input.adapted.dedupeKey)) {
    await emitInboundRejectAuditV0({
      securityStore: input.securityStore,
      workspaceId: input.adapted.envelope.workspaceId,
      occurredAt: input.adapted.envelope.receivedAt,
      action: "normalize_synthetic_inbound",
      target: input.adapted.dedupeKey,
      reasonCode: "duplicate_dedupe_key",
      correlationId: `${input.adapted.binding.id}:${input.adapted.dedupeKey}`,
      details: {
        bindingId: input.adapted.binding.id,
        inboundExternalId: input.adapted.providerItemRef.externalId,
        message: "duplicate dedupe key",
      },
    });
    throw new Error("duplicate dedupe key");
  }

  const id = input.idGen?.() ?? `inbound-${input.adapted.dedupeKey.slice(0, 12)}`;
  const status = input.adapted.provenanceRefs.includes("document_seed_deferred")
    ? "document_seed_deferred"
    : "accepted";

  const record: InboundWorkItemRecordV0 = {
    schemaVersion: 0,
    schema: "pluto.integration.inbound-work-item",
    kind: "inbound_work_item",
    id,
    workspaceId: input.adapted.envelope.workspaceId,
    providerKind: input.adapted.envelope.providerKind,
    status,
    summary: `${input.adapted.envelope.item.title} (${input.adapted.envelope.item.resourceType})`,
    createdAt: input.adapted.envelope.receivedAt,
    updatedAt: input.adapted.envelope.receivedAt,
    workSourceRef: toIntegrationRecordRefV0(input.adapted.workSource),
    bindingRef: toIntegrationRecordRefV0(input.adapted.binding),
    providerItemRef: input.adapted.providerItemRef,
    payloadRef: input.adapted.payloadRef,
    relatedRecordRefs: [...input.adapted.provenanceRefs],
    dedupeKey: input.adapted.dedupeKey,
    receivedAt: input.adapted.envelope.receivedAt,
    processedAt: null,
  };

  await input.store.put("inbound_work_item", record);
  return record;
}
