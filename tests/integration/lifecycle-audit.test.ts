import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { GovernanceEventStore } from "@/audit/governance-event-store.js";
import { IntegrationStore } from "@/integration/integration-store.js";
import { prepareOutboundWrite } from "@/integration/outbound-writes.js";
import { prepareWebhookDelivery } from "@/integration/webhook-delivery.js";
import { ReviewStore } from "@/review/review-store.js";
import { SecurityStore } from "@/security/security-store.js";

import {
  actorRef,
  approvalObjectRef,
  createConnector,
  createGovernanceContext,
  createOutboundTarget,
  createWebhookSubscription,
  signingSecret,
  workspaceId,
} from "./r6-fixtures.js";

let dataDir: string;

beforeEach(async () => {
  dataDir = await mkdtemp(join(tmpdir(), "pluto-r6-lifecycle-audit-"));
});

afterEach(async () => {
  await rm(dataDir, { recursive: true, force: true });
});

describe("R6 lifecycle audit", () => {
  it("emits install, activate, revoke, approval, and decision path events relevant to outbound/webhook flows", async () => {
    const integrationStore = new IntegrationStore({ dataDir });
    const securityStore = new SecurityStore({ dataDir });
    const governanceEvents = new GovernanceEventStore({ dataDir });
    const reviewStore = new ReviewStore({ dataDir });
    const outboundTarget = createOutboundTarget("2026-04-30T01:30:00.000Z");
    await integrationStore.put("outbound_target", outboundTarget);

    await reviewStore.putApprovalRequest({
      schema: "pluto.review.approval-request",
      schemaVersion: 0,
      id: approvalObjectRef.id,
      workspaceId,
      target: {
        kind: "publish_package",
        documentId: "doc-r6",
        versionId: "ver-r6",
        packageId: "pkg-r6",
      },
      requestedById: actorRef.principalId,
      assigneeIds: [actorRef.principalId],
      status: "requested",
      evidenceRequirements: [],
      diffSnapshot: null,
      createdAt: "2026-04-30T01:30:00.000Z",
      updatedAt: "2026-04-30T01:30:00.000Z",
      requestedAt: "2026-04-30T01:30:00.000Z",
      approvalPolicy: {
        policyId: "policy-r6",
        summary: "Single approver",
      },
      requiredApproverRoles: [{ roleLabel: "publisher", minApprovers: 1 }],
      decisionSummary: {
        latestDecisionId: null,
        latestEvent: null,
        decidedAt: null,
        summary: "Pending",
      },
      blockedReasons: [],
    });
    await reviewStore.putDecision({
      schema: "pluto.review.decision",
      schemaVersion: 0,
      id: "decision-r6-approval",
      requestId: approvalObjectRef.id,
      requestKind: "approval",
      target: {
        kind: "publish_package",
        documentId: "doc-r6",
        versionId: "ver-r6",
        packageId: "pkg-r6",
      },
      event: "approved",
      actorId: actorRef.principalId,
      comment: "Approved for outbound release export",
      delegatedToId: null,
      recordedAt: "2026-04-30T01:31:00.000Z",
    });

    const installSubscription = createWebhookSubscription("2026-04-30T01:32:00.000Z", "pending", null);
    const activateSubscription = createWebhookSubscription("2026-04-30T01:33:00.000Z", "active", "2026-04-30T01:33:00.000Z");
    const revokeSubscription = createWebhookSubscription("2026-04-30T01:34:00.000Z", "revoked", "2026-04-30T01:33:00.000Z");
    await integrationStore.put("webhook_subscription", installSubscription);
    await prepareWebhookDelivery({
      store: integrationStore,
      securityStore,
      governanceEvents,
      governance: createGovernanceContext("2026-04-30T01:32:00.000Z"),
      subscription: installSubscription,
      eventRef: {
        providerKind: "fake-local",
        resourceType: "event",
        externalId: "evt-r6-install",
        summary: "Install event",
      },
      attemptId: "attempt-r6-install",
      payloadBody: '{"install":true}',
      payloadContentType: "application/json",
      signingSecret,
      policy: { allowed: true, policyRef: "policy://webhook/default", summary: "Allowed" },
      budget: { allowed: true, budgetRef: "budget://webhook/default", summary: "Available" },
      maxAttempts: 2,
      pauseAfterFailures: 2,
      retryBackoffSeconds: 60,
    });

    await integrationStore.put("webhook_subscription", activateSubscription);
    await prepareWebhookDelivery({
      store: integrationStore,
      securityStore,
      governanceEvents,
      governance: createGovernanceContext("2026-04-30T01:33:00.000Z"),
      subscription: activateSubscription,
      eventRef: {
        providerKind: "fake-local",
        resourceType: "event",
        externalId: "evt-r6-activate",
        summary: "Activate event",
      },
      attemptId: "attempt-r6-activate",
      payloadBody: '{"activate":true}',
      payloadContentType: "application/json",
      signingSecret,
      policy: { allowed: true, policyRef: "policy://webhook/default", summary: "Allowed" },
      budget: { allowed: true, budgetRef: "budget://webhook/default", summary: "Available" },
      maxAttempts: 2,
      pauseAfterFailures: 2,
      retryBackoffSeconds: 60,
    });

    await integrationStore.put("webhook_subscription", revokeSubscription);
    await prepareWebhookDelivery({
      store: integrationStore,
      securityStore,
      governanceEvents,
      governance: createGovernanceContext("2026-04-30T01:34:00.000Z"),
      subscription: revokeSubscription,
      eventRef: {
        providerKind: "fake-local",
        resourceType: "event",
        externalId: "evt-r6-revoke",
        summary: "Revoke event",
      },
      attemptId: "attempt-r6-revoke",
      payloadBody: '{"revoke":true}',
      payloadContentType: "application/json",
      signingSecret,
      policy: { allowed: true, policyRef: "policy://webhook/default", summary: "Allowed" },
      budget: { allowed: true, budgetRef: "budget://webhook/default", summary: "Available" },
      maxAttempts: 2,
      pauseAfterFailures: 2,
      retryBackoffSeconds: 60,
    });

    await prepareOutboundWrite({
      store: integrationStore,
      securityStore,
      governanceEvents,
      connector: createConnector({ calls: 0 }),
      governance: createGovernanceContext("2026-04-30T01:35:00.000Z"),
      outboundTarget,
      writeId: "outbound-write-audit-r6",
      sourceRecordRefs: [approvalObjectRef.id],
      payloadBody: '{"audit":true}',
      payloadContentType: "application/json",
      operation: "export_result",
      idempotencyKey: "idem-outbound-audit-r6",
      policy: { allowed: true, policyRef: "policy://exports/default", summary: "Allowed" },
      budget: { allowed: true, budgetRef: "budget://exports/default", summary: "Available" },
      signingSecret,
    });

    const events = await governanceEvents.list();
    const eventTypes = events.map((event) => event.eventType);
    expect(eventTypes).toContain("decision_recorded");
    expect(eventTypes).toContain("approval_granted");
    expect(eventTypes).toContain("integration_install");
    expect(eventTypes).toContain("integration_activate");
    expect(eventTypes).toContain("integration_revoke");
    expect(eventTypes).toContain("integration_decision");

    const auditEvents = await securityStore.listAuditEvents();
    expect(auditEvents.some((event) => event.approvalRefs.includes(approvalObjectRef.id))).toBe(true);
  });
});
