import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type {
  WorkSourceBindingRecordV0,
  WorkSourceRecordV0,
} from "@/contracts/integration.js";
import { toIntegrationRecordRefV0 } from "@/contracts/integration.js";
import { normalizeSyntheticInboundWorkItem } from "@/integration/inbound-normalizer.js";
import { IntegrationStore } from "@/integration/integration-store.js";
import {
  adaptSyntheticInboundWorkItem,
  type SyntheticInboundEnvelopeV0,
} from "@/integration/work-source-adapter.js";
import { SecurityStore } from "@/security/security-store.js";

let dataDir: string;

beforeEach(async () => {
  dataDir = await mkdtemp(join(tmpdir(), "pluto-inbound-normalization-"));
});

afterEach(async () => {
  await rm(dataDir, { recursive: true, force: true });
});

describe("inbound normalization", () => {
  it("normalizes a validated inbound envelope into an accepted work item", async () => {
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

    expect(record.id).toBe("inbound-item-1");
    expect(record.status).toBe("accepted");
    expect(record.summary).toBe("Weekly digest (ticket)");
    expect(record.relatedRecordRefs).toEqual([
      "source_url:https://provider.example.test/items/item-1",
      "credential_ref:cred-inbound-1",
      "signature_header:x-provider-signature",
      `binding:${binding.id}`,
      "document:doc-1",
      "version:ver-1",
    ]);
    expect(await store.get("inbound_work_item", record.id)).toEqual(record);
  });

  it("rejects duplicate dedupe keys for the same inbound item", async () => {
    const store = new IntegrationStore({ dataDir });
    const securityStore = new SecurityStore({ dataDir });
    const { binding } = await seedIntegrationRecords(store);
    const adapted = await adaptSyntheticInboundWorkItem({
      store,
      envelope: inboundEnvelope({ bindingId: binding.id }),
    });

    await normalizeSyntheticInboundWorkItem({
      store,
      adapted,
      idGen: () => "inbound-item-1",
    });

    await expect(
      normalizeSyntheticInboundWorkItem({
        store,
        adapted,
        securityStore,
        idGen: () => "inbound-item-2",
      }),
    ).rejects.toThrow("duplicate dedupe key");

    await expect(securityStore.listAuditEvents("workspace-1")).resolves.toEqual([
      expect.objectContaining({
        action: "normalize_synthetic_inbound",
        outcome: "denied",
        reasonCodes: ["duplicate_dedupe_key"],
      }),
    ]);
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

function inboundEnvelope(input: { bindingId: string }): SyntheticInboundEnvelopeV0 {
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
      externalId: "item-1",
      resourceType: "ticket",
      title: "Weekly digest",
      sourceUrl: "https://provider.example.test/items/item-1",
      workspaceId: "workspace-1",
      documentSeed: {
        documentId: "doc-1",
        versionId: "ver-1",
      },
    },
    payload: {
      title: "Weekly digest",
      state: "open",
    },
  };
}
