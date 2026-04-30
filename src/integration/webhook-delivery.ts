import type { WebhookDeliveryAttemptV0, WebhookSubscriptionRecordV0 } from "../contracts/integration.js";
import { toIntegrationRecordRefV0 } from "../contracts/integration.js";
import type { ProviderResourceRefV0 } from "../contracts/integration.js";
import type { GovernanceEventRecordV0 } from "../audit/governance-events.js";
import { GovernanceEventStore } from "../audit/governance-event-store.js";
import { IntegrationStore } from "./integration-store.js";
import { SecurityStore } from "../security/security-store.js";
import { buildReplayProtectionKeyV0, createLocalSignatureEnvelopeV0, type LocalSigningSecretV0 } from "./local-signing.js";
import {
  type GovernedIntegrationActionContextV0,
  type OutboundBudgetGateV0,
  type OutboundPolicyGateV0,
  OUTBOUND_BLOCKER_REASONS_V0,
  prepareOutboundWrite,
} from "./outbound-writes.js";

export interface PrepareWebhookDeliveryInputV0 {
  store: IntegrationStore;
  securityStore?: SecurityStore;
  governanceEvents?: GovernanceEventStore;
  governance: GovernedIntegrationActionContextV0;
  subscription: WebhookSubscriptionRecordV0;
  eventRef: ProviderResourceRefV0;
  attemptId: string;
  payloadBody: string;
  payloadContentType: string;
  signingSecret: LocalSigningSecretV0;
  policy: OutboundPolicyGateV0;
  budget: OutboundBudgetGateV0;
  maxAttempts: number;
  pauseAfterFailures: number;
  retryBackoffSeconds: number;
}

export interface PrepareWebhookDeliveryResultV0 {
  duplicate: boolean;
  attempt: WebhookDeliveryAttemptV0;
  blockerReasons: string[];
}

export interface RecordWebhookAttemptInputV0 {
  store: IntegrationStore;
  governanceEvents?: GovernanceEventStore;
  attemptId: string;
  now: string;
  delivered: boolean;
  responseSummary: string;
}

export async function prepareWebhookDelivery(input: PrepareWebhookDeliveryInputV0): Promise<PrepareWebhookDeliveryResultV0> {
  await emitSubscriptionLifecycleEventV0(input.governanceEvents, input.subscription, input.governance.actorRef.principalId);

  const signature = createLocalSignatureEnvelopeV0({
    payload: {
      workspaceId: input.governance.workspaceId,
      providerKind: input.subscription.providerKind,
      purpose: `webhook:${input.subscription.topic}`,
      contentType: input.payloadContentType,
      body: input.payloadBody,
    },
    secret: input.signingSecret,
    signedAt: input.governance.now,
  });
  const replayProtectionKey = buildReplayProtectionKeyV0([
    input.subscription.id,
    input.eventRef.externalId,
    signature.digest,
  ]);
  const existing = await findWebhookAttemptByReplayProtectionKeyV0(input.store, replayProtectionKey);
  if (existing !== null) {
    return { duplicate: true, attempt: existing, blockerReasons: readAttemptBlockerReasonsV0(existing) };
  }

  const boundaryPreparation = await prepareOutboundWrite({
    store: input.store,
    securityStore: input.securityStore,
    governanceEvents: input.governanceEvents,
    connector: {
      kind: "local",
      async executeWrite() {
        throw new Error("webhook_delivery_prepare_only");
      },
    },
    governance: input.governance,
    outboundTarget: {
      schema: "pluto.integration.outbound-target",
      schemaVersion: 0,
      kind: "outbound_target",
      id: `outbound-target:${input.subscription.id}`,
      workspaceId: input.subscription.workspaceId,
      providerKind: input.subscription.providerKind,
      status: input.subscription.status,
      summary: input.subscription.summary,
      createdAt: input.subscription.createdAt,
      updatedAt: input.subscription.updatedAt,
      targetRef: {
        providerKind: input.subscription.providerKind,
        resourceType: "webhook_endpoint",
        externalId: input.subscription.endpointRef,
        summary: input.subscription.summary,
      },
      governanceRefs: [],
      deliveryMode: "webhook",
      readinessRef: input.subscription.deliveryPolicyRef,
    },
    writeId: `webhook-guard:${input.attemptId}`,
    sourceRecordRefs: [input.subscription.id],
    payloadBody: input.payloadBody,
    payloadContentType: input.payloadContentType,
    operation: `deliver:${input.subscription.topic}`,
    idempotencyKey: `${input.subscription.id}:${input.eventRef.externalId}`,
    policy: input.policy,
    budget: input.budget,
    signingSecret: input.signingSecret,
  });

  const blockerReasons = normalizeWebhookBlockerReasonsV0(boundaryPreparation.blockerReasons, input.subscription);
  const attempt: WebhookDeliveryAttemptV0 = {
    schema: "pluto.integration.webhook-delivery-attempt",
    schemaVersion: 0,
    kind: "webhook_delivery_attempt",
    id: input.attemptId,
    workspaceId: input.subscription.workspaceId,
    providerKind: input.subscription.providerKind,
    status: blockerReasons.length === 0 ? "prepared" : "blocked",
    summary: blockerReasons.length === 0
      ? `Prepared webhook delivery for ${input.subscription.topic}`
      : `Blocked webhook delivery for ${input.subscription.topic}`,
    createdAt: input.governance.now,
    updatedAt: input.governance.now,
    subscriptionRef: toIntegrationRecordRefV0(input.subscription),
    eventRef: input.eventRef,
    payloadRef: {
      providerKind: input.subscription.providerKind,
      refKind: "signed-digest",
      ref: signature.digestRef,
      contentType: input.payloadContentType,
      summary: `${input.subscription.topic} payload ${signature.digestRef}`,
    },
    deliveryRef: null,
    attemptedAt: input.governance.now,
    responseSummary: blockerReasons.length === 0 ? "prepared" : blockerReasons.join(","),
    nextAttemptAt: blockerReasons.length === 0 ? input.governance.now : null,
    signing: {
      algorithm: signature.algorithm,
      digest: signature.digest,
      keyRef: signature.keyRef,
      keyFingerprint: signature.keyFingerprint,
      signedAt: signature.signedAt,
    },
    replayProtectionKey,
    retry: {
      maxAttempts: input.maxAttempts,
      pauseAfterFailures: input.pauseAfterFailures,
      retryBackoffSeconds: input.retryBackoffSeconds,
      attemptNumber: 0,
      paused: blockerReasons.includes("subscription_revoked") || blockerReasons.includes("subscription_paused"),
      exhausted: false,
    },
    blockerReasons,
  };
  await input.store.put("webhook_delivery_attempt", attempt);
  await appendWebhookDecisionEventV0(
    input.governanceEvents,
    input.governance.now,
    input.governance.actorRef.principalId,
    attempt.id,
    attempt.workspaceId,
    blockerReasons.length === 0 ? "prepared" : "blocked",
    blockerReasons,
  );

  return {
    duplicate: false,
    attempt,
    blockerReasons,
  };
}

export async function recordWebhookAttempt(input: RecordWebhookAttemptInputV0): Promise<WebhookDeliveryAttemptV0> {
  const attempt = await input.store.get("webhook_delivery_attempt", input.attemptId);
  if (attempt === null) {
    throw new Error("webhook_delivery_attempt_not_found");
  }

  const retry = readRetryStateV0(attempt);
  const nextAttemptNumber = retry.attemptNumber + 1;
  const shouldPause = !input.delivered && nextAttemptNumber >= retry.pauseAfterFailures;
  const maxAttemptsReached = !input.delivered && nextAttemptNumber >= retry.maxAttempts;
  const nextAttemptAt = input.delivered || shouldPause || maxAttemptsReached
    ? null
    : new Date(Date.parse(input.now) + retry.retryBackoffSeconds * 1000).toISOString();

  const updated: WebhookDeliveryAttemptV0 = {
    ...attempt,
    status: input.delivered ? "delivered" : shouldPause ? "paused" : maxAttemptsReached ? "exhausted" : "retrying",
    summary: input.responseSummary,
    updatedAt: input.now,
    responseSummary: input.responseSummary,
    nextAttemptAt,
    deliveryRef: input.delivered ? `local-delivery:${attempt.id}:${nextAttemptNumber}` : attempt.deliveryRef,
    retry: {
      ...retry,
      attemptNumber: nextAttemptNumber,
      paused: shouldPause,
      exhausted: maxAttemptsReached,
    },
  };
  await input.store.put("webhook_delivery_attempt", updated);

  if (shouldPause || maxAttemptsReached) {
    const subscription = await input.store.get("webhook_subscription", attempt.subscriptionRef.recordId);
    if (subscription !== null) {
      await input.store.put("webhook_subscription", {
        ...subscription,
        status: shouldPause ? "paused" : "exhausted",
        updatedAt: input.now,
        summary: shouldPause ? `Paused after delivery failures for ${subscription.topic}` : `Retry budget exhausted for ${subscription.topic}`,
      });
    }
  }

  await appendWebhookDecisionEventV0(
    input.governanceEvents,
    input.now,
    "system",
    updated.id,
    updated.workspaceId,
    updated.status,
    updated.status === "delivered" ? [] : [updated.status === "paused" ? "delivery_paused" : updated.status],
  );

  return updated;
}

export async function findWebhookAttemptByReplayProtectionKeyV0(
  store: IntegrationStore,
  replayProtectionKey: string,
): Promise<WebhookDeliveryAttemptV0 | null> {
  const attempts = await store.list("webhook_delivery_attempt");
  return attempts.find((attempt) => attempt.replayProtectionKey === replayProtectionKey) ?? null;
}

function normalizeWebhookBlockerReasonsV0(blockerReasons: readonly string[], subscription: WebhookSubscriptionRecordV0): string[] {
  const reasons = new Set(blockerReasons);
  if (subscription.status === "revoked") {
    reasons.add("subscription_revoked");
  }
  if (subscription.status === "paused") {
    reasons.add("subscription_paused");
  }
  return [...reasons].filter((reason) => reason.length > 0).sort((left, right) => left.localeCompare(right));
}

async function emitSubscriptionLifecycleEventV0(
  governanceEvents: GovernanceEventStore | undefined,
  subscription: WebhookSubscriptionRecordV0,
  actorId: string,
): Promise<GovernanceEventRecordV0 | null> {
  if (!governanceEvents) {
    return null;
  }

  const eventType = subscription.status === "revoked"
    ? "integration_revoke"
    : subscription.verifiedAt !== null || subscription.status === "active"
      ? "integration_activate"
      : "integration_install";
  const existing = await governanceEvents.list({ targetRecordId: subscription.id });
  if (existing.some((event) => event.eventType === eventType)) {
    return null;
  }

  return governanceEvents.append({
    schema: "pluto.audit.governance-event",
    schemaVersion: 0,
    eventId: `${subscription.updatedAt}:${eventType}:${subscription.id}`,
    eventType,
    actor: { principalId: actorId },
    target: {
      kind: "webhook_subscription",
      recordId: subscription.id,
      workspaceId: subscription.workspaceId,
      targetId: subscription.id,
    },
    status: {
      before: null,
      after: subscription.status,
      summary: `Webhook subscription ${subscription.id} ${subscription.status}`,
    },
    evidenceRefs: [subscription.endpointRef],
    reason: subscription.deliveryPolicyRef,
    createdAt: subscription.updatedAt,
    source: {
      command: "integration.prepareWebhookDelivery",
      ref: subscription.id,
    },
  });
}

async function appendWebhookDecisionEventV0(
  governanceEvents: GovernanceEventStore | undefined,
  createdAt: string,
  actorId: string,
  recordId: string,
  workspaceId: string,
  outcome: string,
  blockerReasons: readonly string[],
): Promise<GovernanceEventRecordV0 | null> {
  if (!governanceEvents) {
    return null;
  }

  return governanceEvents.append({
    schema: "pluto.audit.governance-event",
    schemaVersion: 0,
    eventId: `${createdAt}:integration_webhook_decision:${recordId}`,
    eventType: "integration_decision",
    actor: { principalId: actorId },
    target: {
      kind: "webhook_delivery_attempt",
      recordId,
      workspaceId,
      targetId: recordId,
    },
    status: {
      before: null,
      after: outcome,
      summary: `Webhook delivery ${recordId} ${outcome}`,
    },
    evidenceRefs: [...blockerReasons],
    reason: blockerReasons[0] ?? null,
    createdAt,
    source: {
      command: "integration.recordWebhookAttempt",
      ref: recordId,
    },
  });
}

function readAttemptBlockerReasonsV0(attempt: WebhookDeliveryAttemptV0): string[] {
  return [...attempt.blockerReasons];
}

function readRetryStateV0(attempt: WebhookDeliveryAttemptV0): {
  maxAttempts: number;
  pauseAfterFailures: number;
  retryBackoffSeconds: number;
  attemptNumber: number;
  paused: boolean;
  exhausted: boolean;
} {
  return {
    maxAttempts: attempt.retry.maxAttempts,
    pauseAfterFailures: attempt.retry.pauseAfterFailures,
    retryBackoffSeconds: attempt.retry.retryBackoffSeconds,
    attemptNumber: attempt.retry.attemptNumber,
    paused: attempt.retry.paused,
    exhausted: attempt.retry.exhausted,
  };
}
