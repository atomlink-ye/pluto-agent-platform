import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  assertNoSensitiveIntegrationMaterial,
  validateOutboundWriteRecordV0,
  validateWebhookSubscriptionRecordV0,
} from "@/contracts/integration.js";
import { IntegrationStore } from "@/integration/integration-store.js";

let workDir: string;

beforeEach(async () => {
  workDir = await mkdtemp(join(tmpdir(), "pluto-integration-secret-test-"));
});

afterEach(async () => {
  await rm(workDir, { recursive: true, force: true });
});

const outboundTargetRef = {
  schema: "pluto.integration.ref" as const,
  schemaVersion: 0 as const,
  kind: "outbound_target" as const,
  recordId: "target-1",
  workspaceId: "workspace-1",
  providerKind: "slack",
  summary: "Release channel",
};

describe("integration secret exclusion", () => {
  it("rejects raw payloads, OAuth material, and signing key fields", () => {
    const rawPayload = validateOutboundWriteRecordV0({
      schemaVersion: 0,
      schema: "pluto.integration.outbound-write",
      kind: "outbound_write",
      id: "write-1",
      workspaceId: "workspace-1",
      providerKind: "slack",
      status: "queued",
      summary: "Outbound publish request",
      createdAt: "2026-04-30T00:00:00.000Z",
      updatedAt: "2026-04-30T00:00:01.000Z",
      outboundTargetRef,
      sourceRecordRefs: ["publish://package/pkg-1"],
      payloadRef: {
        providerKind: "slack",
        refKind: "connector-request",
        ref: "req-1",
        contentType: "application/json",
        summary: "Redacted request envelope",
      },
      operation: "create_message",
      idempotencyKey: "idem-1",
      providerWriteRef: null,
      attemptedAt: "2026-04-30T00:02:00.000Z",
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
        digest: "digest-1",
        keyRef: "local-signing:webhook-signing",
        keyFingerprint: "fingerprint-1",
        signedAt: "2026-04-30T00:02:00.000Z",
      },
      replayProtectionKey: "replay-1",
      connectorKind: "local",
      responseSummary: null,
      execution: null,
      rawPayload: { text: "hello" },
    });

    expect(rawPayload.ok).toBe(false);
    expect(rawPayload.ok ? [] : rawPayload.errors.join(" | ")).toContain(
      "sensitive integration material detected in record.rawPayload",
    );

    const oauthMaterial = validateWebhookSubscriptionRecordV0({
      schemaVersion: 0,
      schema: "pluto.integration.webhook-subscription",
      kind: "webhook_subscription",
      id: "sub-1",
      workspaceId: "workspace-1",
      providerKind: "github",
      status: "active",
      summary: "GitHub issue hook",
      createdAt: "2026-04-30T00:00:00.000Z",
      updatedAt: "2026-04-30T00:00:01.000Z",
      topic: "issues",
      endpointRef: "bridge://webhooks/github/issues",
      deliveryPolicyRef: null,
      providerSubscriptionRef: "hook-1",
      verifiedAt: null,
      oauthToken: "Bearer ghp_secret_value",
    });

    expect(oauthMaterial.ok).toBe(false);
    expect(oauthMaterial.ok ? [] : oauthMaterial.errors.join(" | ")).toContain(
      "sensitive integration material detected in record.oauthToken",
    );
  });

  it("fails closed on suspicious string values even under additive fields", () => {
    expect(() => assertNoSensitiveIntegrationMaterial({
      note: "-----BEGIN PRIVATE KEY-----",
    })).toThrow("sensitive integration material detected in value.note");
  });

  it("prevents the store from persisting forbidden integration material", async () => {
    const store = new IntegrationStore({ dataDir: join(workDir, ".pluto") });

    await expect(store.put("outbound_write", {
      schemaVersion: 0,
      schema: "pluto.integration.outbound-write",
      kind: "outbound_write",
      id: "write-secret",
      workspaceId: "workspace-1",
      providerKind: "slack",
      status: "queued",
      summary: "Outbound publish request",
      createdAt: "2026-04-30T00:00:00.000Z",
      updatedAt: "2026-04-30T00:00:01.000Z",
      outboundTargetRef,
      sourceRecordRefs: ["publish://package/pkg-1"],
      payloadRef: {
        providerKind: "slack",
        refKind: "connector-request",
        ref: "req-1",
        contentType: "application/json",
        summary: "Redacted request envelope",
      },
      operation: "create_message",
      idempotencyKey: "idem-secret",
      providerWriteRef: null,
      attemptedAt: "2026-04-30T00:02:00.000Z",
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
        digest: "digest-secret",
        keyRef: "local-signing:webhook-signing",
        keyFingerprint: "fingerprint-secret",
        signedAt: "2026-04-30T00:02:00.000Z",
      },
      replayProtectionKey: "replay-secret",
      connectorKind: "local",
      responseSummary: null,
      execution: null,
      signingSecret: "top-secret",
    } as unknown as Parameters<typeof store.put<"outbound_write">>[1])).rejects.toThrow(
      "Invalid outbound_write record: sensitive integration material detected in record.signingSecret",
    );

    await expect(store.list("outbound_write")).resolves.toEqual([]);
  });
});
