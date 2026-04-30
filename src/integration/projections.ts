import type {
  InboundWorkItemRecordV0,
  IntegrationRecordRefV0,
  OutboundWriteRecordV0,
  ProviderResourceRefV0,
  WebhookDeliveryAttemptV0,
  WebhookSubscriptionRecordV0,
} from "../contracts/integration.js";
import { toIntegrationRecordRefV0 } from "../contracts/integration.js";
import { IntegrationStore } from "./integration-store.js";

export interface InboundInspectionListItemV0 {
  inboundRef: IntegrationRecordRefV0;
  receivedAt: string;
  status: string;
  providerItemRef: ProviderResourceRefV0;
  workSourceRef: IntegrationRecordRefV0;
  bindingRef: IntegrationRecordRefV0;
  relatedRecordRefs: string[];
}

export interface InboundInspectionDetailV0 {
  schemaVersion: 0;
  inboundRef: IntegrationRecordRefV0;
  receivedAt: string;
  processedAt: string | null;
  status: string;
  dedupeKey: string;
  providerItemRef: ProviderResourceRefV0;
  payloadRef: InboundWorkItemRecordV0["payloadRef"];
  workSourceRef: IntegrationRecordRefV0;
  bindingRef: IntegrationRecordRefV0;
  relatedRecordRefs: string[];
}

export interface OutboundInspectionListItemV0 {
  outboundRef: IntegrationRecordRefV0;
  attemptedAt: string;
  status: string;
  operation: string;
  targetRef: IntegrationRecordRefV0;
  sourceRecordRefs: string[];
  blockerReasons: string[];
}

export interface OutboundInspectionDetailV0 {
  schemaVersion: 0;
  outboundRef: IntegrationRecordRefV0;
  attemptedAt: string;
  completedAt: string | null;
  status: string;
  operation: string;
  idempotencyKey: string;
  targetRef: IntegrationRecordRefV0;
  payloadRef: OutboundWriteRecordV0["payloadRef"];
  providerWriteRef: string | null;
  sourceRecordRefs: string[];
  blockerReasons: string[];
  connectorKind: string | null;
  responseSummary: string | null;
}

export interface WebhookInspectionListItemV0 {
  subscriptionRef: IntegrationRecordRefV0;
  topic: string;
  status: string;
  endpointRef: string;
  verifiedAt: string | null;
  latestAttemptRef: IntegrationRecordRefV0 | null;
  latestAttemptAt: string | null;
}

export interface WebhookInspectionDetailV0 {
  schemaVersion: 0;
  subscriptionRef: IntegrationRecordRefV0;
  topic: string;
  status: string;
  endpointRef: string;
  deliveryPolicyRef: string | null;
  providerSubscriptionRef: string | null;
  verifiedAt: string | null;
  attempts: Array<{
    attemptRef: IntegrationRecordRefV0;
    attemptedAt: string;
    status: string;
    eventRef: ProviderResourceRefV0;
    deliveryRef: string | null;
    nextAttemptAt: string | null;
    blockerReasons: string[];
    responseSummary: string;
  }>;
}

export async function listInboundInspection(store: IntegrationStore): Promise<InboundInspectionListItemV0[]> {
  const records = await store.list("inbound_work_item");
  return records
    .map((record) => ({
      inboundRef: toIntegrationRecordRefV0(record),
      receivedAt: record.receivedAt,
      status: record.status,
      providerItemRef: record.providerItemRef,
      workSourceRef: record.workSourceRef,
      bindingRef: record.bindingRef,
      relatedRecordRefs: [...record.relatedRecordRefs],
    }))
    .sort((left, right) => right.receivedAt.localeCompare(left.receivedAt) || right.inboundRef.recordId.localeCompare(left.inboundRef.recordId));
}

export async function showInboundInspection(
  store: IntegrationStore,
  inboundId: string,
): Promise<InboundInspectionDetailV0 | null> {
  const record = await store.get("inbound_work_item", inboundId);
  if (record === null) {
    return null;
  }

  return {
    schemaVersion: 0,
    inboundRef: toIntegrationRecordRefV0(record),
    receivedAt: record.receivedAt,
    processedAt: record.processedAt,
    status: record.status,
    dedupeKey: record.dedupeKey,
    providerItemRef: record.providerItemRef,
    payloadRef: record.payloadRef,
    workSourceRef: record.workSourceRef,
    bindingRef: record.bindingRef,
    relatedRecordRefs: [...record.relatedRecordRefs],
  };
}

export async function listOutboundInspection(store: IntegrationStore): Promise<OutboundInspectionListItemV0[]> {
  const records = await store.list("outbound_write");
  return records
    .map((record) => ({
      outboundRef: toIntegrationRecordRefV0(record),
      attemptedAt: record.attemptedAt,
      status: record.status,
      operation: record.operation,
      targetRef: record.outboundTargetRef,
      sourceRecordRefs: [...record.sourceRecordRefs],
      blockerReasons: [...record.decision.blockerReasons],
    }))
    .sort((left, right) => right.attemptedAt.localeCompare(left.attemptedAt) || right.outboundRef.recordId.localeCompare(left.outboundRef.recordId));
}

export async function showOutboundInspection(
  store: IntegrationStore,
  writeId: string,
): Promise<OutboundInspectionDetailV0 | null> {
  const record = await store.get("outbound_write", writeId);
  if (record === null) {
    return null;
  }

  return {
    schemaVersion: 0,
    outboundRef: toIntegrationRecordRefV0(record),
    attemptedAt: record.attemptedAt,
    completedAt: record.completedAt,
    status: record.status,
    operation: record.operation,
    idempotencyKey: record.idempotencyKey,
    targetRef: record.outboundTargetRef,
    payloadRef: record.payloadRef,
    providerWriteRef: record.providerWriteRef,
    sourceRecordRefs: [...record.sourceRecordRefs],
    blockerReasons: [...record.decision.blockerReasons],
    connectorKind: record.connectorKind,
    responseSummary: record.responseSummary,
  };
}

export async function listWebhookInspection(store: IntegrationStore): Promise<WebhookInspectionListItemV0[]> {
  const [subscriptions, attempts] = await Promise.all([
    store.list("webhook_subscription"),
    store.list("webhook_delivery_attempt"),
  ]);

  return subscriptions
    .map((subscription) => {
      const latestAttempt = latestAttemptForSubscription(subscription.id, attempts);
      return {
        subscriptionRef: toIntegrationRecordRefV0(subscription),
        topic: subscription.topic,
        status: subscription.status,
        endpointRef: subscription.endpointRef,
        verifiedAt: subscription.verifiedAt,
        latestAttemptRef: latestAttempt ? toIntegrationRecordRefV0(latestAttempt) : null,
        latestAttemptAt: latestAttempt?.attemptedAt ?? null,
      } satisfies WebhookInspectionListItemV0;
    })
    .sort((left, right) => left.subscriptionRef.recordId.localeCompare(right.subscriptionRef.recordId));
}

export async function showWebhookInspection(
  store: IntegrationStore,
  subscriptionId: string,
): Promise<WebhookInspectionDetailV0 | null> {
  const subscription = await store.get("webhook_subscription", subscriptionId);
  if (subscription === null) {
    return null;
  }

  const attempts = (await store.list("webhook_delivery_attempt"))
    .filter((attempt) => attempt.subscriptionRef.recordId === subscription.id)
    .sort((left, right) => right.attemptedAt.localeCompare(left.attemptedAt) || right.id.localeCompare(left.id));

  return {
    schemaVersion: 0,
    subscriptionRef: toIntegrationRecordRefV0(subscription),
    topic: subscription.topic,
    status: subscription.status,
    endpointRef: subscription.endpointRef,
    deliveryPolicyRef: subscription.deliveryPolicyRef,
    providerSubscriptionRef: subscription.providerSubscriptionRef,
    verifiedAt: subscription.verifiedAt,
    attempts: attempts.map((attempt) => ({
      attemptRef: toIntegrationRecordRefV0(attempt),
      attemptedAt: attempt.attemptedAt,
      status: attempt.status,
      eventRef: attempt.eventRef,
      deliveryRef: attempt.deliveryRef,
      nextAttemptAt: attempt.nextAttemptAt,
      blockerReasons: [...attempt.blockerReasons],
      responseSummary: attempt.responseSummary,
    })),
  };
}

function latestAttemptForSubscription(
  subscriptionId: string,
  attempts: WebhookDeliveryAttemptV0[],
): WebhookDeliveryAttemptV0 | null {
  return attempts
    .filter((attempt) => attempt.subscriptionRef.recordId === subscriptionId)
    .sort((left, right) => right.attemptedAt.localeCompare(left.attemptedAt) || right.id.localeCompare(left.id))[0] ?? null;
}
