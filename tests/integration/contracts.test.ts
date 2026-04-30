import { describe, expect, it } from "vitest";

import {
  toIntegrationRecordRefV0,
  validateInboundWorkItemRecordV0,
  validateOutboundTargetRecordV0,
  validateOutboundWriteRecordV0,
  validateWebhookDeliveryAttemptV0,
  validateWebhookSubscriptionRecordV0,
  validateWorkSourceBindingRecordV0,
  validateWorkSourceRecordV0,
} from "@/contracts/integration.js";

const baseRecord = {
  schemaVersion: 0 as const,
  workspaceId: "workspace-1",
  providerKind: "linear",
  status: "active",
  summary: "Workspace integration summary",
  createdAt: "2026-04-30T00:00:00.000Z",
  updatedAt: "2026-04-30T00:00:01.000Z",
};

const providerRef = {
  providerKind: "linear",
  resourceType: "project",
  externalId: "project-123",
  summary: "Linear project 123",
};

const payloadRef = {
  providerKind: "linear",
  refKind: "provider-envelope",
  ref: "evt-123",
  contentType: "application/json",
  summary: "Provider envelope captured by external bridge",
};

const workSource = {
  ...baseRecord,
  schema: "pluto.integration.work-source" as const,
  kind: "work_source" as const,
  id: "source-1",
  sourceRef: providerRef,
  governanceRefs: ["schedule-1"],
  capabilityRefs: ["issues.read"],
  lastObservedAt: "2026-04-30T00:05:00.000Z",
};

const workSourceRef = toIntegrationRecordRefV0(workSource);

const workSourceBinding = {
  ...baseRecord,
  schema: "pluto.integration.work-source-binding" as const,
  kind: "work_source_binding" as const,
  id: "binding-1",
  workSourceRef,
  targetRef: "governance://schedule/schedule-1",
  filtersSummary: "Only incidents tagged customer-visible",
  governanceRefs: ["schedule-1", "playbook-1"],
  cursorRef: "cursor-1",
  lastSynchronizedAt: "2026-04-30T00:06:00.000Z",
};

const bindingRef = toIntegrationRecordRefV0(workSourceBinding);

describe("integration contracts", () => {
  it("validates governed ref-first records without exposing implementation paths", () => {
    const inboundWorkItem = {
      ...baseRecord,
      schema: "pluto.integration.inbound-work-item" as const,
      kind: "inbound_work_item" as const,
      id: "inbound-1",
      workSourceRef,
      bindingRef,
      providerItemRef: {
        providerKind: "linear",
        resourceType: "issue",
        externalId: "ISSUE-123",
        summary: "Customer-visible outage ticket",
      },
      payloadRef,
      relatedRecordRefs: ["governance://document/doc-1"],
      dedupeKey: "linear:ISSUE-123:v1",
      receivedAt: "2026-04-30T00:07:00.000Z",
      processedAt: null,
    };

    const outboundTarget = {
      ...baseRecord,
      providerKind: "slack",
      schema: "pluto.integration.outbound-target" as const,
      kind: "outbound_target" as const,
      id: "target-1",
      targetRef: {
        providerKind: "slack",
        resourceType: "channel",
        externalId: "C123",
        summary: "Release broadcast channel",
      },
      governanceRefs: ["publish-package-1"],
      deliveryMode: "message",
      readinessRef: "readiness-1",
    };

    const outboundWrite = {
      ...baseRecord,
      providerKind: "slack",
      schema: "pluto.integration.outbound-write" as const,
      kind: "outbound_write" as const,
      id: "write-1",
      outboundTargetRef: toIntegrationRecordRefV0(outboundTarget),
      sourceRecordRefs: ["publish://package/pkg-1"],
      payloadRef: {
        providerKind: "slack",
        refKind: "connector-request",
        ref: "req-123",
        contentType: "application/json",
        summary: "Redacted publish announcement request envelope",
      },
      operation: "create_message",
      idempotencyKey: "slack:broadcast:pkg-1",
      providerWriteRef: "msg-1",
      attemptedAt: "2026-04-30T00:08:00.000Z",
      completedAt: null,
      decision: {
        allowed: true,
        blockerReasons: [],
        policyRef: "policy-1",
        budgetRef: "budget-1",
        permitId: "permit-1",
        approvalRefs: ["approval-1"],
        connectorKind: "local",
      },
      signing: {
        algorithm: "hmac-sha256",
        digest: "digest-1",
        keyRef: "local-signing:webhook-signing",
        keyFingerprint: "fingerprint-1",
        signedAt: "2026-04-30T00:08:00.000Z",
      },
      replayProtectionKey: "replay-1",
      connectorKind: "local",
      responseSummary: null,
      execution: null,
    };

    const webhookSubscription = {
      ...baseRecord,
      providerKind: "github",
      schema: "pluto.integration.webhook-subscription" as const,
      kind: "webhook_subscription" as const,
      id: "sub-1",
      topic: "issues",
      endpointRef: "bridge://webhooks/github/issues",
      deliveryPolicyRef: "policy-1",
      providerSubscriptionRef: "hook-123",
      verifiedAt: "2026-04-30T00:09:00.000Z",
    };

    const webhookDeliveryAttempt = {
      ...baseRecord,
      providerKind: "github",
      schema: "pluto.integration.webhook-delivery-attempt" as const,
      kind: "webhook_delivery_attempt" as const,
      id: "delivery-1",
      subscriptionRef: toIntegrationRecordRefV0(webhookSubscription),
      eventRef: {
        providerKind: "github",
        resourceType: "webhook-event",
        externalId: "delivery-evt-1",
        summary: "Issue webhook delivery event",
      },
      payloadRef: {
        providerKind: "github",
        refKind: "webhook-envelope",
        ref: "delivery-evt-1",
        contentType: "application/json",
        summary: "Webhook event envelope held outside integration records",
      },
      deliveryRef: "attempt-1",
      attemptedAt: "2026-04-30T00:10:00.000Z",
      responseSummary: "Accepted by inbound bridge with 202 response",
      nextAttemptAt: null,
      signing: {
        algorithm: "hmac-sha256",
        digest: "digest-2",
        keyRef: "local-signing:webhook-signing",
        keyFingerprint: "fingerprint-2",
        signedAt: "2026-04-30T00:10:00.000Z",
      },
      replayProtectionKey: "replay-2",
      retry: {
        maxAttempts: 3,
        pauseAfterFailures: 2,
        retryBackoffSeconds: 60,
        attemptNumber: 0,
        paused: false,
        exhausted: false,
      },
      blockerReasons: [],
    };

    expect(validateWorkSourceRecordV0(workSource).ok).toBe(true);
    expect(validateWorkSourceBindingRecordV0(workSourceBinding).ok).toBe(true);
    expect(validateInboundWorkItemRecordV0(inboundWorkItem).ok).toBe(true);
    expect(validateOutboundTargetRecordV0(outboundTarget).ok).toBe(true);
    expect(validateOutboundWriteRecordV0(outboundWrite).ok).toBe(true);
    expect(validateWebhookSubscriptionRecordV0(webhookSubscription).ok).toBe(true);
    expect(validateWebhookDeliveryAttemptV0(webhookDeliveryAttempt).ok).toBe(true);

    const serialized = JSON.stringify({
      workSource,
      workSourceBinding,
      inboundWorkItem,
      outboundTarget,
      outboundWrite,
      webhookSubscription,
      webhookDeliveryAttempt,
      workSourceRef,
      bindingRef,
    });

    expect(serialized).not.toContain(".pluto");
    expect(serialized).not.toContain("rawPayload");
    expect(serialized).not.toContain("providerPayload");
  });

  it("requires schema markers and ref-first linkage fields", () => {
    const wrongSchema = validateOutboundWriteRecordV0({
      ...baseRecord,
      schema: "pluto.integration.other",
      kind: "outbound_write",
      id: "write-1",
      outboundTargetRef: workSourceRef,
      sourceRecordRefs: [],
      payloadRef,
      operation: "upsert",
      idempotencyKey: "idem-1",
      providerWriteRef: null,
      attemptedAt: "2026-04-30T00:08:00.000Z",
      completedAt: null,
      decision: {
        allowed: true,
        blockerReasons: [],
        policyRef: null,
        budgetRef: null,
        permitId: null,
        approvalRefs: [],
        connectorKind: "local",
      },
      signing: {
        algorithm: "hmac-sha256",
        digest: "digest-3",
        keyRef: "local-signing:webhook-signing",
        keyFingerprint: "fingerprint-3",
        signedAt: "2026-04-30T00:08:00.000Z",
      },
      replayProtectionKey: "replay-3",
      connectorKind: "local",
      responseSummary: null,
      execution: null,
    });

    expect(wrongSchema.ok).toBe(false);
    expect(wrongSchema.ok ? [] : wrongSchema.errors).toContain(
      "schema must be pluto.integration.outbound-write",
    );

    const missingRef = validateInboundWorkItemRecordV0({
      ...baseRecord,
      schema: "pluto.integration.inbound-work-item",
      kind: "inbound_work_item",
      id: "inbound-1",
      workSourceRef,
      providerItemRef: providerRef,
      payloadRef,
      relatedRecordRefs: [],
      dedupeKey: "d-1",
      receivedAt: "2026-04-30T00:07:00.000Z",
      processedAt: null,
    });

    expect(missingRef.ok).toBe(false);
    expect(missingRef.ok ? [] : missingRef.errors).toContain(
      "bindingRef must be an integration record ref object",
    );
  });

  it("tolerates additive future fields", () => {
    const result = validateWorkSourceRecordV0({
      ...workSource,
      futureField: { lane: "r5" },
    });

    expect(result.ok).toBe(true);
  });

  it("requires persisted outbound and webhook metadata fields to match the exported contracts", () => {
    const webhookSubscription = {
      ...baseRecord,
      providerKind: "github",
      schema: "pluto.integration.webhook-subscription" as const,
      kind: "webhook_subscription" as const,
      id: "sub-metadata-missing",
      topic: "issues",
      endpointRef: "bridge://webhooks/github/issues",
      deliveryPolicyRef: null,
      providerSubscriptionRef: null,
      verifiedAt: null,
    };

    const invalidOutbound = validateOutboundWriteRecordV0({
      ...baseRecord,
      providerKind: "slack",
      schema: "pluto.integration.outbound-write",
      kind: "outbound_write",
      id: "write-metadata-missing",
      outboundTargetRef: workSourceRef,
      sourceRecordRefs: [],
      payloadRef,
      operation: "upsert",
      idempotencyKey: "idem-metadata-missing",
      providerWriteRef: null,
      attemptedAt: "2026-04-30T00:08:00.000Z",
      completedAt: null,
    });
    expect(invalidOutbound.ok).toBe(false);
    expect(invalidOutbound.ok ? [] : invalidOutbound.errors).toContain("decision must be an object");

    const invalidWebhook = validateWebhookDeliveryAttemptV0({
      ...baseRecord,
      providerKind: "github",
      schema: "pluto.integration.webhook-delivery-attempt",
      kind: "webhook_delivery_attempt",
      id: "delivery-metadata-missing",
      subscriptionRef: toIntegrationRecordRefV0(webhookSubscription),
      eventRef: providerRef,
      payloadRef,
      deliveryRef: null,
      attemptedAt: "2026-04-30T00:10:00.000Z",
      responseSummary: "prepared",
      nextAttemptAt: null,
    });
    expect(invalidWebhook.ok).toBe(false);
    expect(invalidWebhook.ok ? [] : invalidWebhook.errors).toContain("signing must be an object");
  });
});
