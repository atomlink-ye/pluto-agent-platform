import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type {
  WorkSourceBindingRecordV0,
  WorkSourceRecordV0,
} from "@/contracts/integration.js";
import { toIntegrationRecordRefV0 } from "@/contracts/integration.js";
import type { ScheduleRecordV0 } from "@/contracts/governance.js";
import { GovernanceStore } from "@/governance/governance-store.js";
import { normalizeSyntheticInboundWorkItem } from "@/integration/inbound-normalizer.js";
import { IntegrationStore } from "@/integration/integration-store.js";
import {
  adaptSyntheticInboundWorkItem,
  type SyntheticInboundEnvelopeV0,
} from "@/integration/work-source-adapter.js";
import { bridgeInboundToManualScheduleFire } from "@/schedule/inbound-bridge.js";
import { ScheduleStore } from "@/schedule/schedule-store.js";

let dataDir: string;

beforeEach(async () => {
  dataDir = await mkdtemp(join(tmpdir(), "pluto-inbound-document-provenance-"));
});

afterEach(async () => {
  await rm(dataDir, { recursive: true, force: true });
});

describe("inbound document provenance", () => {
  it("captures document and version refs when document seeds are present", async () => {
    const store = new IntegrationStore({ dataDir });
    const { binding } = await seedIntegrationRecords(store);

    const adapted = await adaptSyntheticInboundWorkItem({
      store,
      envelope: inboundEnvelope({ bindingId: binding.id }),
    });
    const record = await normalizeSyntheticInboundWorkItem({
      store,
      adapted,
      idGen: () => "inbound-item-1",
    });

    expect(adapted.provenanceRefs).toContain("document:doc-1");
    expect(adapted.provenanceRefs).toContain("version:ver-1");
    expect(record.status).toBe("accepted");
    expect(record.relatedRecordRefs).toContain("document:doc-1");
    expect(record.relatedRecordRefs).toContain("version:ver-1");
    expect(record.relatedRecordRefs).not.toContain("document_seed_deferred");
  });

  it("preserves deferred document provenance through schedule bridging", async () => {
    const integrationStore = new IntegrationStore({ dataDir });
    const governanceStore = new GovernanceStore({ dataDir });
    const scheduleStore = new ScheduleStore({ dataDir });
    const { binding } = await seedIntegrationRecords(integrationStore);
    await governanceStore.put("schedule", scheduleRecord());
    await seedScheduleSubscription(scheduleStore);

    const adapted = await adaptSyntheticInboundWorkItem({
      store: integrationStore,
      envelope: inboundEnvelope({
        bindingId: binding.id,
        documentSeed: null,
        externalId: "item-2",
        sourceUrl: "https://provider.example.test/items/item-2",
      }),
    });
    const inbound = await normalizeSyntheticInboundWorkItem({
      store: integrationStore,
      adapted,
      idGen: () => "inbound-item-2",
    });

    const result = await bridgeInboundToManualScheduleFire({
      integrationStore,
      governanceStore,
      scheduleStore,
      inboundWorkItemId: inbound.id,
      scheduleId: "schedule-1",
      bridgedAt: "2026-04-30T02:00:00.000Z",
      actorId: "agent:r5-bridge",
      compatibility: {
        runtimeCapabilityAvailable: true,
        approvalSatisfied: true,
        policyAllowed: true,
        budgetAllowed: true,
        outboundWritesAllowed: true,
      },
    });

    expect(inbound.status).toBe("document_seed_deferred");
    expect(inbound.relatedRecordRefs).toContain("document_seed_deferred");
    expect(result.manualFireSeed.auditHistory).toContain("document_seed_deferred");

    const bridgedInbound = await integrationStore.get("inbound_work_item", inbound.id);
    expect(bridgedInbound?.status).toBe("document_seed_deferred");
    expect(bridgedInbound?.relatedRecordRefs).toContain("document_seed_deferred");
    expect(bridgedInbound?.relatedRecordRefs).toContain(`fire_record:${result.fireRecord.id}`);
    expect(bridgedInbound?.relatedRecordRefs).toContain("schedule:schedule-1");
  });
});

async function seedIntegrationRecords(store: IntegrationStore): Promise<{
  workSource: WorkSourceRecordV0;
  binding: WorkSourceBindingRecordV0;
}> {
  const workSource: WorkSourceRecordV0 = {
    schemaVersion: 0,
    schema: "pluto.integration.work-source",
    kind: "work_source",
    id: "work-source-1",
    workspaceId: "workspace-1",
    providerKind: "linear",
    status: "active",
    summary: "Linear inbound source",
    createdAt: "2026-04-30T00:00:00.000Z",
    updatedAt: "2026-04-30T00:00:00.000Z",
    sourceRef: {
      providerKind: "linear",
      resourceType: "team",
      externalId: "team-1",
      summary: "Team 1",
    },
    governanceRefs: ["schedule:schedule-1"],
    capabilityRefs: ["ingest:ticket"],
    lastObservedAt: null,
  };
  const binding: WorkSourceBindingRecordV0 = {
    schemaVersion: 0,
    schema: "pluto.integration.work-source-binding",
    kind: "work_source_binding",
    id: "binding-1",
    workspaceId: "workspace-1",
    providerKind: "linear",
    status: "active",
    summary: "Linear to schedule binding",
    createdAt: "2026-04-30T00:00:00.000Z",
    updatedAt: "2026-04-30T00:00:00.000Z",
    workSourceRef: toIntegrationRecordRefV0(workSource),
    targetRef: "schedule:schedule-1",
    filtersSummary: "resource=ticket",
    governanceRefs: ["schedule:schedule-1"],
    cursorRef: null,
    lastSynchronizedAt: null,
  };

  await store.put("work_source", workSource);
  await store.put("work_source_binding", binding);

  return { workSource, binding };
}

async function seedScheduleSubscription(store: ScheduleStore): Promise<void> {
  await store.put("subscription", {
    schemaVersion: 0,
    kind: "subscription",
    id: "subscription-1",
    workspaceId: "workspace-1",
    scheduleId: "schedule-1",
    createdAt: "2026-04-30T00:00:00.000Z",
    updatedAt: "2026-04-30T00:00:00.000Z",
    status: "active",
    subscriberKind: "run_queue",
    subscriberId: "queue-1",
  });
}

function scheduleRecord(): ScheduleRecordV0 {
  return {
    schemaVersion: 0,
    kind: "schedule",
    id: "schedule-1",
    workspaceId: "workspace-1",
    createdAt: "2026-04-30T00:00:00.000Z",
    updatedAt: "2026-04-30T00:00:00.000Z",
    status: "active",
    playbookId: "playbook-1",
    scenarioId: "scenario-1",
    ownerId: "owner-1",
    cadence: "0 9 * * 1",
  };
}

function inboundEnvelope(input: {
  bindingId: string;
  documentSeed?: { documentId: string; versionId: string | null } | null;
  externalId?: string;
  sourceUrl?: string;
}): SyntheticInboundEnvelopeV0 {
  return {
    schema: "pluto.integration.synthetic-inbound",
    schemaVersion: 0,
    workspaceId: "workspace-1",
    providerKind: "linear",
    bindingId: input.bindingId,
    receivedAt: "2026-04-30T01:00:00.000Z",
    headers: {
      "x-provider-signature": "sig-1",
    },
    security: {
      credentialRef: "cred-inbound-1",
      signatureHeader: "x-provider-signature",
      expectedSignature: "sig-1",
    },
    item: {
      externalId: input.externalId ?? "item-1",
      resourceType: "ticket",
      title: "Weekly digest",
      sourceUrl: input.sourceUrl ?? "https://provider.example.test/items/item-1",
      workspaceId: "workspace-1",
      documentSeed: input.documentSeed === undefined
        ? {
          documentId: "doc-1",
          versionId: "ver-1",
        }
        : input.documentSeed,
    },
    payload: {
      title: "Weekly digest",
      state: "open",
    },
  };
}
