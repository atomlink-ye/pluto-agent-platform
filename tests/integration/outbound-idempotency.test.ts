import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { IntegrationStore } from "@/integration/integration-store.js";
import { executeOutboundWrite, prepareOutboundWrite } from "@/integration/outbound-writes.js";

import { createConnector, createGovernanceContext, createOutboundTarget, signingSecret } from "./r6-fixtures.js";

let dataDir: string;

beforeEach(async () => {
  dataDir = await mkdtemp(join(tmpdir(), "pluto-r6-outbound-idempotency-"));
});

afterEach(async () => {
  await rm(dataDir, { recursive: true, force: true });
});

describe("R6 outbound idempotency", () => {
  it("reuses the prior prepared and executed write for duplicate idempotency keys", async () => {
    const now = "2026-04-30T01:10:00.000Z";
    const store = new IntegrationStore({ dataDir });
    const outboundTarget = createOutboundTarget(now);
    await store.put("outbound_target", outboundTarget);
    const counter = { calls: 0, payloadBodies: [] as string[] };
    const connector = createConnector(counter);
    const payloadBody = '{"release":"r6"}';

    const prepared = await prepareOutboundWrite({
      store,
      connector,
      governance: createGovernanceContext(now),
      outboundTarget,
      writeId: "outbound-write-idempotent-r6",
      sourceRecordRefs: ["src-1"],
      payloadBody,
      payloadContentType: "application/json",
      operation: "export_result",
      idempotencyKey: "idem-outbound-idempotent-r6",
      policy: {
        allowed: true,
        policyRef: "policy://exports/default",
        summary: "Allowed",
      },
      budget: {
        allowed: true,
        budgetRef: "budget://exports/default",
        summary: "Available",
      },
      signingSecret,
    });
    const executed = await executeOutboundWrite({
      store,
      connector,
      writeId: prepared.record.id,
      payloadBody,
      now: "2026-04-30T01:10:05.000Z",
    });
    const preparedDuplicate = await prepareOutboundWrite({
      store,
      connector,
      governance: createGovernanceContext("2026-04-30T01:10:06.000Z"),
      outboundTarget,
      writeId: "outbound-write-idempotent-r6-duplicate",
      sourceRecordRefs: ["src-1"],
      payloadBody,
      payloadContentType: "application/json",
      operation: "export_result",
      idempotencyKey: "idem-outbound-idempotent-r6",
      policy: {
        allowed: true,
        policyRef: "policy://exports/default",
        summary: "Allowed",
      },
      budget: {
        allowed: true,
        budgetRef: "budget://exports/default",
        summary: "Available",
      },
      signingSecret,
    });
    const executedDuplicate = await executeOutboundWrite({
      store,
      connector,
      idempotencyKey: "idem-outbound-idempotent-r6",
      payloadBody,
      now: "2026-04-30T01:10:07.000Z",
    });

    expect(prepared.record.status).toBe("prepared");
    expect(executed.executed).toBe(true);
    expect(executed.record.providerWriteRef).toBe("fake-write:outbound-write-idempotent-r6:1");
    expect(preparedDuplicate.duplicate).toBe(true);
    expect(preparedDuplicate.record.id).toBe(prepared.record.id);
    expect(executedDuplicate.duplicate).toBe(true);
    expect(executedDuplicate.executed).toBe(false);
    expect(counter.calls).toBe(1);
    expect(counter.payloadBodies).toEqual([payloadBody]);
  });

  it("rejects execution when the supplied payload body does not match the stored signed digest", async () => {
    const now = "2026-04-30T01:11:00.000Z";
    const store = new IntegrationStore({ dataDir });
    const outboundTarget = createOutboundTarget(now);
    await store.put("outbound_target", outboundTarget);

    const prepared = await prepareOutboundWrite({
      store,
      connector: createConnector({ calls: 0 }),
      governance: createGovernanceContext(now),
      outboundTarget,
      writeId: "outbound-write-mismatch-r6",
      sourceRecordRefs: ["src-1"],
      payloadBody: '{"release":"r6"}',
      payloadContentType: "application/json",
      operation: "export_result",
      idempotencyKey: "idem-outbound-mismatch-r6",
      policy: {
        allowed: true,
        policyRef: "policy://exports/default",
        summary: "Allowed",
      },
      budget: {
        allowed: true,
        budgetRef: "budget://exports/default",
        summary: "Available",
      },
      signingSecret,
    });

    await expect(executeOutboundWrite({
      store,
      connector: createConnector({ calls: 0 }),
      writeId: prepared.record.id,
      payloadBody: '{"release":"tampered"}',
      now: "2026-04-30T01:11:05.000Z",
    })).rejects.toThrow("outbound_payload_mismatch");
  });
});
