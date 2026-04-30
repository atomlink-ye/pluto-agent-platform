import { execFile } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type {
  InboundWorkItemRecordV0,
  OutboundTargetRecordV0,
  OutboundWriteRecordV0,
  WebhookDeliveryAttemptV0,
  WebhookSubscriptionRecordV0,
  WorkSourceBindingRecordV0,
  WorkSourceRecordV0,
} from "@/contracts/integration.js";
import { toIntegrationRecordRefV0 } from "@/contracts/integration.js";
import { IntegrationStore } from "@/integration/integration-store.js";

const exec = promisify(execFile);

let workDir: string;
let dataDir: string;

beforeEach(async () => {
  workDir = await mkdtemp(join(tmpdir(), "pluto-integrations-cli-test-"));
  dataDir = join(workDir, ".pluto");

  const store = new IntegrationStore({ dataDir });
  const workSource = makeWorkSource();
  const binding = makeBinding(workSource);
  const inbound = makeInbound(workSource, binding);
  const outboundTarget = makeOutboundTarget();
  const outboundWrite = makeOutboundWrite(outboundTarget);
  const webhookSubscription = makeWebhookSubscription();
  const webhookAttempt = makeWebhookAttempt(webhookSubscription);

  await store.put("work_source", workSource);
  await store.put("work_source_binding", binding);
  await store.put("inbound_work_item", inbound);
  await store.put("outbound_target", outboundTarget);
  await store.put("outbound_write", outboundWrite);
  await store.put("webhook_subscription", webhookSubscription);
  await store.put("webhook_delivery_attempt", webhookAttempt);
});

afterEach(async () => {
  await rm(workDir, { recursive: true, force: true });
});

async function runIntegrations(args: string[]): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  try {
    const result = await exec("npx", ["tsx", join(process.cwd(), "src/cli/integrations.ts"), ...args], {
      cwd: process.cwd(),
      env: { ...process.env, PLUTO_DATA_DIR: dataDir },
      timeout: 10_000,
    });
    return { stdout: result.stdout, stderr: result.stderr, exitCode: 0 };
  } catch (err: unknown) {
    const error = err as { stdout?: string; stderr?: string; code?: number };
    return { stdout: error.stdout ?? "", stderr: error.stderr ?? "", exitCode: error.code ?? 1 };
  }
}

describe("pnpm integrations", () => {
  it("lists inbound, outbound, and webhooks in text mode", async () => {
    const inbound = await runIntegrations(["inbound", "list"]);
    expect(inbound.exitCode).toBe(0);
    expect(inbound.stdout).toContain("inbound-alpha");

    const outbound = await runIntegrations(["outbound", "list"]);
    expect(outbound.exitCode).toBe(0);
    expect(outbound.stdout).toContain("write-alpha");

    const webhooks = await runIntegrations(["webhooks", "list"]);
    expect(webhooks.exitCode).toBe(0);
    expect(webhooks.stdout).toContain("webhook-alpha");
  });

  it("lists inbound, outbound, and webhooks in JSON mode", async () => {
    const inbound = await runIntegrations(["inbound", "list", "--json"]);
    expect(inbound.exitCode).toBe(0);
    const inboundOutput = JSON.parse(inbound.stdout) as { schemaVersion: number; items: Array<{ inboundRef: { recordId: string } }> };
    expect(inboundOutput.schemaVersion).toBe(0);
    expect(inboundOutput.items.map((item) => item.inboundRef.recordId)).toEqual(["inbound-alpha"]);

    const outbound = await runIntegrations(["outbound", "list", "--json"]);
    expect(outbound.exitCode).toBe(0);
    const outboundOutput = JSON.parse(outbound.stdout) as {
      schemaVersion: number;
      items: Array<{ outboundRef: { recordId: string }; blockerReasons: string[] }>;
    };
    expect(outboundOutput.schemaVersion).toBe(0);
    expect(outboundOutput.items.map((item) => item.outboundRef.recordId)).toEqual(["write-alpha"]);
    expect(outboundOutput.items[0]?.blockerReasons).toEqual([]);
    expect(outbound.stdout).not.toContain("signature-write-alpha");
    expect(outbound.stdout).not.toContain("replay-write-alpha");
    expect(outbound.stdout).not.toContain("local-signing:webhook-signing");

    const webhooks = await runIntegrations(["webhooks", "list", "--json"]);
    expect(webhooks.exitCode).toBe(0);
    const webhookOutput = JSON.parse(webhooks.stdout) as {
      schemaVersion: number;
      items: Array<{ subscriptionRef: { recordId: string }; latestAttemptRef: { recordId: string } | null }>;
    };
    expect(webhookOutput.schemaVersion).toBe(0);
    expect(webhookOutput.items.map((item) => item.subscriptionRef.recordId)).toEqual(["webhook-alpha"]);
    expect(webhookOutput.items[0]?.latestAttemptRef?.recordId).toBe("webhook-attempt-alpha");
  });

  it("shows ref-first inbound, outbound, and webhook JSON projections", async () => {
    const inbound = await runIntegrations(["inbound", "show", "inbound-alpha", "--json"]);
    expect(inbound.exitCode).toBe(0);
    const inboundOutput = JSON.parse(inbound.stdout) as { inboundRef: { recordId: string }; workSourceRef: { recordId: string }; relatedRecordRefs: string[] };
    expect(inboundOutput.inboundRef.recordId).toBe("inbound-alpha");
    expect(inboundOutput.workSourceRef.recordId).toBe("work-source-alpha");
    expect(inboundOutput.relatedRecordRefs).toContain("fire_record:fire-alpha");

    const outbound = await runIntegrations(["outbound", "show", "write-alpha", "--json"]);
    expect(outbound.exitCode).toBe(0);
    const outboundOutput = JSON.parse(outbound.stdout) as { outboundRef: { recordId: string }; sourceRecordRefs: string[]; blockerReasons: string[]; providerWriteRef: string | null };
    expect(outboundOutput.outboundRef.recordId).toBe("write-alpha");
    expect(outboundOutput.sourceRecordRefs).toContain("run:run-alpha");
    expect(outboundOutput.blockerReasons).toEqual([]);
    expect(outboundOutput.providerWriteRef).toBe("provider-write-alpha");
    expect("signing" in outboundOutput).toBe(false);
    expect("replayProtectionKey" in outboundOutput).toBe(false);
    expect("decision" in outboundOutput).toBe(false);
    expect(outbound.stdout).not.toContain("signature-write-alpha");
    expect(outbound.stdout).not.toContain("fingerprint-write-alpha");

    const webhook = await runIntegrations(["webhooks", "show", "webhook-alpha", "--json"]);
    expect(webhook.exitCode).toBe(0);
    const webhookOutput = JSON.parse(webhook.stdout) as { subscriptionRef: { recordId: string }; attempts: Array<{ attemptRef: { recordId: string }; blockerReasons: string[] }> };
    expect(webhookOutput.subscriptionRef.recordId).toBe("webhook-alpha");
    expect(webhookOutput.attempts[0]?.attemptRef.recordId).toBe("webhook-attempt-alpha");
    expect(webhookOutput.attempts[0]?.blockerReasons).toEqual([]);
    expect(webhook.stdout).not.toContain("signature-webhook-alpha");
    expect(webhook.stdout).not.toContain("replay-webhook-alpha");
  });
});

function makeWorkSource(): WorkSourceRecordV0 {
  return {
    schema: "pluto.integration.work-source",
    schemaVersion: 0,
    kind: "work_source",
    id: "work-source-alpha",
    workspaceId: "ws-local-alpha",
    providerKind: "fake-local",
    status: "active",
    summary: "Local source",
    createdAt: "2026-04-30T08:00:00.000Z",
    updatedAt: "2026-04-30T08:00:00.000Z",
    sourceRef: {
      providerKind: "fake-local",
      resourceType: "inbox",
      externalId: "src-1",
      summary: "Local inbox",
    },
    governanceRefs: [],
    capabilityRefs: [],
    lastObservedAt: null,
  };
}

function makeBinding(workSource: WorkSourceRecordV0): WorkSourceBindingRecordV0 {
  return {
    schema: "pluto.integration.work-source-binding",
    schemaVersion: 0,
    kind: "work_source_binding",
    id: "binding-alpha",
    workspaceId: workSource.workspaceId,
    providerKind: workSource.providerKind,
    status: "active",
    summary: "Local binding",
    createdAt: workSource.createdAt,
    updatedAt: workSource.updatedAt,
    workSourceRef: toIntegrationRecordRefV0(workSource),
    targetRef: "scenario-alpha",
    filtersSummary: "all",
    governanceRefs: [],
    cursorRef: null,
    lastSynchronizedAt: null,
  };
}

function makeInbound(workSource: WorkSourceRecordV0, binding: WorkSourceBindingRecordV0): InboundWorkItemRecordV0 {
  return {
    schema: "pluto.integration.inbound-work-item",
    schemaVersion: 0,
    kind: "inbound_work_item",
    id: "inbound-alpha",
    workspaceId: workSource.workspaceId,
    providerKind: workSource.providerKind,
    status: "seeded",
    summary: "Inbound alpha",
    createdAt: "2026-04-30T08:05:00.000Z",
    updatedAt: "2026-04-30T08:10:00.000Z",
    workSourceRef: toIntegrationRecordRefV0(workSource),
    bindingRef: toIntegrationRecordRefV0(binding),
    providerItemRef: {
      providerKind: workSource.providerKind,
      resourceType: "ticket",
      externalId: "item-1",
      summary: "Inbound ticket",
    },
    payloadRef: {
      providerKind: workSource.providerKind,
      refKind: "source_url",
      ref: "file://local/inbound/item-1.json",
      contentType: "application/json",
      summary: "{\"title\":\"Inbound ticket\"}",
    },
    relatedRecordRefs: ["fire_record:fire-alpha", "schedule:schedule-alpha"],
    dedupeKey: "dedupe-alpha",
    receivedAt: "2026-04-30T08:05:00.000Z",
    processedAt: "2026-04-30T08:10:00.000Z",
  };
}

function makeOutboundTarget(): OutboundTargetRecordV0 {
  return {
    schema: "pluto.integration.outbound-target",
    schemaVersion: 0,
    kind: "outbound_target",
    id: "target-alpha",
    workspaceId: "ws-local-alpha",
    providerKind: "fake-local",
    status: "active",
    summary: "Local sink",
    createdAt: "2026-04-30T08:00:00.000Z",
    updatedAt: "2026-04-30T08:00:00.000Z",
    targetRef: {
      providerKind: "fake-local",
      resourceType: "document",
      externalId: "doc-1",
      summary: "Local document",
    },
    governanceRefs: [],
    deliveryMode: "local_write",
    readinessRef: "local-ready",
  };
}

function makeOutboundWrite(outboundTarget: OutboundTargetRecordV0): OutboundWriteRecordV0 {
  return {
    schema: "pluto.integration.outbound-write",
    schemaVersion: 0,
    kind: "outbound_write",
    id: "write-alpha",
    workspaceId: outboundTarget.workspaceId,
    providerKind: outboundTarget.providerKind,
    status: "completed",
    summary: "Write completed",
    createdAt: "2026-04-30T08:15:00.000Z",
    updatedAt: "2026-04-30T08:16:00.000Z",
    outboundTargetRef: toIntegrationRecordRefV0(outboundTarget),
    sourceRecordRefs: ["schedule:schedule-alpha", "fire_record:fire-alpha", "run:run-alpha"],
    payloadRef: {
      providerKind: outboundTarget.providerKind,
      refKind: "signed-digest",
      ref: "sha256:write-alpha",
      contentType: "application/json",
      summary: "projection payload",
    },
    operation: "sync_document",
    idempotencyKey: "write-alpha-idempotency",
    providerWriteRef: "provider-write-alpha",
    attemptedAt: "2026-04-30T08:15:00.000Z",
    completedAt: "2026-04-30T08:16:00.000Z",
    decision: {
      allowed: true,
      blockerReasons: [],
      policyRef: null,
      budgetRef: null,
      permitId: null,
      approvalRefs: [],
      connectorKind: "fake-local",
    },
    signing: {
      algorithm: "hmac-sha256",
      digest: "digest-write-alpha",
      keyRef: "local-signing:webhook-signing",
      keyFingerprint: "fingerprint-write-alpha",
      signedAt: "2026-04-30T08:15:00.000Z",
    },
    replayProtectionKey: "replay-write-alpha",
    connectorKind: "fake-local",
    responseSummary: "ok",
    execution: {
      completedAt: "2026-04-30T08:16:00.000Z",
      metadata: {},
    },
  };
}

function makeWebhookSubscription(): WebhookSubscriptionRecordV0 {
  return {
    schema: "pluto.integration.webhook-subscription",
    schemaVersion: 0,
    kind: "webhook_subscription",
    id: "webhook-alpha",
    workspaceId: "ws-local-alpha",
    providerKind: "fake-local",
    status: "active",
    summary: "Local webhook",
    createdAt: "2026-04-30T08:00:00.000Z",
    updatedAt: "2026-04-30T08:20:00.000Z",
    topic: "run.completed",
    endpointRef: "https://local.example.test/hook",
    deliveryPolicyRef: "policy-local",
    providerSubscriptionRef: null,
    verifiedAt: "2026-04-30T08:02:00.000Z",
  };
}

function makeWebhookAttempt(subscription: WebhookSubscriptionRecordV0): WebhookDeliveryAttemptV0 {
  return {
    schema: "pluto.integration.webhook-delivery-attempt",
    schemaVersion: 0,
    kind: "webhook_delivery_attempt",
    id: "webhook-attempt-alpha",
    workspaceId: subscription.workspaceId,
    providerKind: subscription.providerKind,
    status: "delivered",
    summary: "Delivered",
    createdAt: "2026-04-30T08:21:00.000Z",
    updatedAt: "2026-04-30T08:21:30.000Z",
    subscriptionRef: toIntegrationRecordRefV0(subscription),
    eventRef: {
      providerKind: subscription.providerKind,
      resourceType: "run_event",
      externalId: "run-alpha",
      summary: "Run completed",
    },
    payloadRef: {
      providerKind: subscription.providerKind,
      refKind: "signed-digest",
      ref: "sha256:webhook-alpha",
      contentType: "application/json",
      summary: "webhook payload",
    },
    deliveryRef: "delivery-alpha",
    attemptedAt: "2026-04-30T08:21:00.000Z",
    responseSummary: "200 ok",
    nextAttemptAt: null,
    signing: {
      algorithm: "hmac-sha256",
      digest: "digest-webhook-alpha",
      keyRef: "local-signing:webhook-signing",
      keyFingerprint: "fingerprint-webhook-alpha",
      signedAt: "2026-04-30T08:21:00.000Z",
    },
    replayProtectionKey: "replay-webhook-alpha",
    retry: {
      maxAttempts: 3,
      pauseAfterFailures: 2,
      retryBackoffSeconds: 60,
      attemptNumber: 1,
      paused: false,
      exhausted: false,
    },
    blockerReasons: [],
  };
}
