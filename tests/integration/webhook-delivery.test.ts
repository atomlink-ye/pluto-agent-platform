import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { IntegrationStore } from "@/integration/integration-store.js";
import { prepareWebhookDelivery, recordWebhookAttempt } from "@/integration/webhook-delivery.js";

import { createGovernanceContext, createWebhookSubscription, signingSecret } from "./r6-fixtures.js";

let dataDir: string;

beforeEach(async () => {
  dataDir = await mkdtemp(join(tmpdir(), "pluto-r6-webhook-delivery-"));
});

afterEach(async () => {
  await rm(dataDir, { recursive: true, force: true });
});

describe("R6 webhook delivery", () => {
  it("records signed digest metadata, replay protection, bounded retries, and pauses after repeated failures", async () => {
    const store = new IntegrationStore({ dataDir });
    const now = "2026-04-30T01:20:00.000Z";
    const subscription = createWebhookSubscription(now, "active", now);
    await store.put("webhook_subscription", subscription);

    const prepared = await prepareWebhookDelivery({
      store,
      governance: createGovernanceContext(now),
      subscription,
      eventRef: {
        providerKind: "fake-local",
        resourceType: "event",
        externalId: "evt-r6-1",
        summary: "Release published",
      },
      attemptId: "webhook-attempt-r6",
      payloadBody: '{"release":"r6"}',
      payloadContentType: "application/json",
      signingSecret,
      policy: {
        allowed: true,
        policyRef: "policy://webhook/default",
        summary: "Allowed",
      },
      budget: {
        allowed: true,
        budgetRef: "budget://webhook/default",
        summary: "Available",
      },
      maxAttempts: 3,
      pauseAfterFailures: 2,
      retryBackoffSeconds: 60,
    });
    const duplicate = await prepareWebhookDelivery({
      store,
      governance: createGovernanceContext("2026-04-30T01:20:01.000Z"),
      subscription,
      eventRef: {
        providerKind: "fake-local",
        resourceType: "event",
        externalId: "evt-r6-1",
        summary: "Release published",
      },
      attemptId: "webhook-attempt-r6-duplicate",
      payloadBody: '{"release":"r6"}',
      payloadContentType: "application/json",
      signingSecret,
      policy: {
        allowed: true,
        policyRef: "policy://webhook/default",
        summary: "Allowed",
      },
      budget: {
        allowed: true,
        budgetRef: "budget://webhook/default",
        summary: "Available",
      },
      maxAttempts: 3,
      pauseAfterFailures: 2,
      retryBackoffSeconds: 60,
    });
    const firstFailure = await recordWebhookAttempt({
      store,
      attemptId: prepared.attempt.id,
      now: "2026-04-30T01:21:00.000Z",
      delivered: false,
      responseSummary: "503 upstream unavailable",
    });
    const secondFailure = await recordWebhookAttempt({
      store,
      attemptId: prepared.attempt.id,
      now: "2026-04-30T01:22:00.000Z",
      delivered: false,
      responseSummary: "503 upstream unavailable again",
    });
    const updatedSubscription = await store.get("webhook_subscription", subscription.id);

    expect(prepared.attempt.status).toBe("prepared");
    expect(prepared.attempt.signing.digest).toHaveLength(64);
    expect(prepared.attempt.retry.exhausted).toBe(false);
    expect(JSON.stringify(prepared.attempt)).not.toContain(signingSecret.keyMaterial);
    expect(duplicate.duplicate).toBe(true);
    expect(duplicate.attempt.id).toBe(prepared.attempt.id);
    expect(firstFailure.status).toBe("retrying");
    expect(firstFailure.nextAttemptAt).toBe("2026-04-30T01:22:00.000Z");
    expect(secondFailure.status).toBe("paused");
    expect(secondFailure.nextAttemptAt).toBeNull();
    expect(updatedSubscription?.status).toBe("paused");
  });
});
