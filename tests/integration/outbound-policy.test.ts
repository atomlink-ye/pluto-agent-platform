import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { GovernanceEventStore } from "@/audit/governance-event-store.js";
import { IntegrationStore } from "@/integration/integration-store.js";
import { prepareOutboundWrite } from "@/integration/outbound-writes.js";
import { showOutboundInspection } from "@/integration/projections.js";
import { SecurityStore } from "@/security/security-store.js";

import { approvalObjectRef, createConnector, createGovernanceContext, createOutboundTarget, signingSecret } from "./r6-fixtures.js";

let dataDir: string;

beforeEach(async () => {
  dataDir = await mkdtemp(join(tmpdir(), "pluto-r6-outbound-policy-"));
});

afterEach(async () => {
  await rm(dataDir, { recursive: true, force: true });
});

describe("R6 outbound policy guards", () => {
  it("fails closed on approval, policy, and budget blockers with canonical reasons", async () => {
    const now = "2026-04-30T01:00:00.000Z";
    const store = new IntegrationStore({ dataDir });
    const securityStore = new SecurityStore({ dataDir });
    const governanceEvents = new GovernanceEventStore({ dataDir });
    const outboundTarget = createOutboundTarget(now);
    await store.put("outbound_target", outboundTarget);

    const result = await prepareOutboundWrite({
      store,
      securityStore,
      governanceEvents,
      connector: createConnector({ calls: 0 }),
      governance: createGovernanceContext(now, {
        approvalRefs: [],
      }),
      outboundTarget,
      writeId: "outbound-write-policy-r6",
      sourceRecordRefs: [approvalObjectRef.id],
      payloadBody: '{"release":"r6"}',
      payloadContentType: "application/json",
      operation: "export_result",
      idempotencyKey: "idem-outbound-policy-r6",
      policy: {
        allowed: false,
        reasonCode: "policy_blocked",
        policyRef: "policy://exports/restricted",
        summary: "Policy blocks this export",
      },
      budget: {
        allowed: false,
        reasonCode: "budget_blocked",
        budgetRef: "budget://exports/default",
        summary: "Budget exhausted",
      },
      signingSecret,
    });

    expect(result.duplicate).toBe(false);
    expect(result.record.status).toBe("blocked");
    expect(result.blockerReasons).toEqual(["approval_missing", "budget_blocked", "policy_blocked"]);

    const auditEvents = await securityStore.listAuditEvents();
    expect(auditEvents).toHaveLength(1);
    expect(auditEvents[0]?.reasonCodes).toContain("approval_missing");

    const governanceAudit = await governanceEvents.list({ targetRecordId: result.record.id });
    expect(governanceAudit.map((event) => event.eventType)).toEqual(["integration_decision"]);
    expect(governanceAudit[0]?.reason).toBe("approval_missing");
  });

  it("surfaces a missing scoped permit blocker through the governed outbound decision", async () => {
    const now = "2026-04-30T01:05:00.000Z";
    const store = new IntegrationStore({ dataDir });
    const outboundTarget = createOutboundTarget(now);
    await store.put("outbound_target", outboundTarget);

    const result = await prepareOutboundWrite({
      store,
      connector: createConnector({ calls: 0 }),
      governance: {
        ...createGovernanceContext(now),
        permit: null,
      },
      outboundTarget,
      writeId: "outbound-write-policy-required",
      sourceRecordRefs: [approvalObjectRef.id],
      payloadBody: '{"release":"r6"}',
      payloadContentType: "application/json",
      operation: "export_result",
      idempotencyKey: "idem-policy-required",
      policy: { allowed: true, summary: "policy allowed", policyRef: null },
      budget: { allowed: true, summary: "budget allowed", budgetRef: null },
      signingSecret,
    });

    expect(result.record.status).toBe("blocked");
    expect(result.blockerReasons).toContain("policy_required");
  });

  it("surfaces publisher authorization blockers through the governed outbound decision", async () => {
    const now = "2026-04-30T01:05:00.000Z";
    const store = new IntegrationStore({ dataDir });
    const outboundTarget = createOutboundTarget(now);
    await store.put("outbound_target", outboundTarget);

    const context = createGovernanceContext(now);
    const result = await prepareOutboundWrite({
      store,
      connector: createConnector({ calls: 0 }),
      governance: {
        ...context,
        bindings: [{ ...context.bindings[0]!, role: "viewer", permissions: [] }],
      },
      outboundTarget,
      writeId: "outbound-write-identity-denied",
      sourceRecordRefs: [approvalObjectRef.id],
      payloadBody: '{"release":"r6"}',
      payloadContentType: "application/json",
      operation: "export_result",
      idempotencyKey: "idem-identity-denied",
      policy: { allowed: true, summary: "policy allowed", policyRef: null },
      budget: { allowed: true, summary: "budget allowed", budgetRef: null },
      signingSecret,
    });

    expect(result.record.status).toBe("blocked");
    expect(result.blockerReasons).toContain("identity_denied");
  });

  it("surfaces trust-class approval blockers through the governed outbound decision", async () => {
    const now = "2026-04-30T01:05:00.000Z";
    const store = new IntegrationStore({ dataDir });
    const outboundTarget = createOutboundTarget(now);
    await store.put("outbound_target", outboundTarget);

    const result = await prepareOutboundWrite({
      store,
      connector: createConnector({ calls: 0 }),
      governance: {
        ...createGovernanceContext(now),
        trustBoundary: "human_review_required",
      },
      outboundTarget,
      writeId: "outbound-write-trust-boundary",
      sourceRecordRefs: [approvalObjectRef.id],
      payloadBody: '{"release":"r6"}',
      payloadContentType: "application/json",
      operation: "export_result",
      idempotencyKey: "idem-trust-boundary",
      policy: { allowed: true, summary: "policy allowed", policyRef: null },
      budget: { allowed: true, summary: "budget allowed", budgetRef: null },
      signingSecret,
    });

    expect(result.record.status).toBe("blocked");
    expect(result.blockerReasons).toContain("trust_boundary_required");
  });

  it("surfaces revoked ScopedToolPermit blockers through the governed outbound decision", async () => {
    const now = "2026-04-30T01:05:00.000Z";
    const store = new IntegrationStore({ dataDir });
    const outboundTarget = createOutboundTarget(now);
    await store.put("outbound_target", outboundTarget);

    const context = createGovernanceContext(now);
    const result = await prepareOutboundWrite({
      store,
      connector: createConnector({ calls: 0 }),
      governance: {
        ...context,
        permit: { ...context.permit!, revokedAt: "2026-04-30T01:04:00.000Z" },
      },
      outboundTarget,
      writeId: "outbound-write-permit-revoked",
      sourceRecordRefs: [approvalObjectRef.id],
      payloadBody: '{"release":"r6"}',
      payloadContentType: "application/json",
      operation: "export_result",
      idempotencyKey: "idem-permit-revoked",
      policy: { allowed: true, summary: "policy allowed", policyRef: null },
      budget: { allowed: true, summary: "budget allowed", budgetRef: null },
      signingSecret,
    });

    expect(result.record.status).toBe("blocked");
    expect(result.blockerReasons).toContain("permit_revoked");
  });

  it("keeps outbound inspection projections redacted to the approved surface", async () => {
    const now = "2026-04-30T01:10:00.000Z";
    const store = new IntegrationStore({ dataDir });
    const outboundTarget = createOutboundTarget(now);
    await store.put("outbound_target", outboundTarget);

    const result = await prepareOutboundWrite({
      store,
      connector: createConnector({ calls: 0 }),
      governance: createGovernanceContext(now),
      outboundTarget,
      writeId: "outbound-write-redacted-r6",
      sourceRecordRefs: [approvalObjectRef.id],
      payloadBody: '{"release":"r6","authorization":"secret"}',
      payloadContentType: "application/json",
      operation: "export_result",
      idempotencyKey: "idem-redacted-r6",
      policy: { allowed: true, summary: "policy allowed", policyRef: null },
      budget: { allowed: true, summary: "budget allowed", budgetRef: null },
      signingSecret,
    });

    const projection = await showOutboundInspection(store, result.record.id);

    expect(projection?.payloadRef.summary).toContain("sha256:");
    expect(projection?.payloadRef.summary).not.toContain("authorization");
    expect(projection && "signing" in projection).toBe(false);
    expect(projection && "replayProtectionKey" in projection).toBe(false);
    expect(projection && "decision" in projection).toBe(false);
  });

  it("reuses blocked records for duplicate idempotency keys and appends duplicate governance decisions", async () => {
    const now = "2026-04-30T01:12:00.000Z";
    const store = new IntegrationStore({ dataDir });
    const governanceEvents = new GovernanceEventStore({ dataDir });
    const connectorCalls = { calls: 0 };
    const outboundTarget = createOutboundTarget(now);
    await store.put("outbound_target", outboundTarget);

    const first = await prepareOutboundWrite({
      store,
      governanceEvents,
      connector: createConnector(connectorCalls),
      governance: createGovernanceContext(now, { approvalRefs: [] }),
      outboundTarget,
      writeId: "outbound-write-duplicate-r6",
      sourceRecordRefs: [approvalObjectRef.id],
      payloadBody: '{"release":"r6"}',
      payloadContentType: "application/json",
      operation: "export_result",
      idempotencyKey: "idem-outbound-duplicate-r6",
      policy: {
        allowed: false,
        reasonCode: "policy_blocked",
        policyRef: "policy://exports/restricted",
        summary: "Policy blocks this export",
      },
      budget: {
        allowed: false,
        reasonCode: "budget_blocked",
        budgetRef: "budget://exports/default",
        summary: "Budget exhausted",
      },
      signingSecret,
    });
    const duplicate = await prepareOutboundWrite({
      store,
      governanceEvents,
      connector: createConnector(connectorCalls),
      governance: createGovernanceContext("2026-04-30T01:13:00.000Z", { approvalRefs: [] }),
      outboundTarget,
      writeId: "outbound-write-duplicate-r6-second",
      sourceRecordRefs: [approvalObjectRef.id],
      payloadBody: '{"release":"r6"}',
      payloadContentType: "application/json",
      operation: "export_result",
      idempotencyKey: "idem-outbound-duplicate-r6",
      policy: {
        allowed: false,
        reasonCode: "policy_blocked",
        policyRef: "policy://exports/restricted",
        summary: "Policy blocks this export",
      },
      budget: {
        allowed: false,
        reasonCode: "budget_blocked",
        budgetRef: "budget://exports/default",
        summary: "Budget exhausted",
      },
      signingSecret,
    });

    expect(first.duplicate).toBe(false);
    expect(duplicate.duplicate).toBe(true);
    expect(duplicate.record.id).toBe(first.record.id);
    expect(duplicate.blockerReasons).toEqual(["approval_missing", "budget_blocked", "policy_blocked"]);
    expect(connectorCalls.calls).toBe(0);

    const governanceAudit = await governanceEvents.list({ targetRecordId: first.record.id });
    expect(governanceAudit.map((event) => event.status.after)).toEqual(["blocked", "duplicate"]);
    expect(governanceAudit.map((event) => event.reason)).toEqual(["approval_missing", "approval_missing"]);
  });
});
