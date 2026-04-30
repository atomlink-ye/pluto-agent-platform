import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type {
  WorkSourceBindingRecordV0,
  WorkSourceRecordV0,
} from "@/contracts/integration.js";
import { toIntegrationRecordRefV0 } from "@/contracts/integration.js";
import { IntegrationStore } from "@/integration/integration-store.js";
import {
  adaptSyntheticInboundWorkItem,
  type SyntheticInboundEnvelopeV0,
} from "@/integration/work-source-adapter.js";
import { SecurityStore } from "@/security/security-store.js";

let dataDir: string;

beforeEach(async () => {
  dataDir = await mkdtemp(join(tmpdir(), "pluto-inbound-security-"));
});

afterEach(async () => {
  await rm(dataDir, { recursive: true, force: true });
});

describe("inbound security", () => {
  it("redacts sensitive payload material in the adapted payload summary", async () => {
    const store = new IntegrationStore({ dataDir });
    const { binding } = await seedIntegrationRecords(store);

    const adapted = await adaptSyntheticInboundWorkItem({
      store,
      envelope: inboundEnvelope({
        bindingId: binding.id,
        payload: {
          note: "provider metadata",
          authorization: "Bearer super-secret-token",
          nested: {
            password: "p@ssword",
            details: "token=abc123",
          },
        },
      }),
    });

    expect(adapted.payloadSummary).toContain("[REDACTED]");
    expect(adapted.payloadSummary).not.toContain("super-secret-token");
    expect(adapted.payloadSummary).not.toContain("p@ssword");
    expect(adapted.payloadSummary).not.toContain("abc123");
  });

  it("rejects invalid inbound signatures and missing credential refs", async () => {
    const store = new IntegrationStore({ dataDir });
    const securityStore = new SecurityStore({ dataDir });
    const { binding } = await seedIntegrationRecords(store);

    await expect(
      adaptSyntheticInboundWorkItem({
        store,
        securityStore,
        envelope: inboundEnvelope({
          bindingId: binding.id,
          headers: { "x-provider-signature": "wrong" },
        }),
      }),
    ).rejects.toThrow("invalid signature/header");

    await expect(securityStore.listAuditEvents("workspace-1")).resolves.toEqual([
      expect.objectContaining({
        action: "adapt_synthetic_inbound",
        outcome: "denied",
        reasonCodes: ["invalid_signature_header"],
      }),
    ]);

    await expect(
      adaptSyntheticInboundWorkItem({
        store,
        securityStore,
        envelope: inboundEnvelope({
          bindingId: binding.id,
          credentialRef: null,
        }),
      }),
    ).rejects.toThrow("missing credential ref");

    const auditEvents = await securityStore.listAuditEvents("workspace-1");
    expect(auditEvents).toHaveLength(2);
    expect(auditEvents[1]).toEqual(expect.objectContaining({
      action: "adapt_synthetic_inbound",
      outcome: "denied",
      reasonCodes: ["missing_credential_ref"],
    }));
  });

  it("audits workspace and schema mismatch rejects before failing closed", async () => {
    const store = new IntegrationStore({ dataDir });
    const securityStore = new SecurityStore({ dataDir });
    const { binding, workSource } = await seedIntegrationRecords(store);

    await expect(
      adaptSyntheticInboundWorkItem({
        store,
        securityStore,
        envelope: inboundEnvelope({
          bindingId: binding.id,
          workspaceId: "workspace-2",
        }),
      }),
    ).rejects.toThrow("workspace mismatch");

    await expect(
      adaptSyntheticInboundWorkItem({
        store,
        securityStore,
        envelope: inboundEnvelope({
          bindingId: binding.id,
          providerKind: "github",
        }),
      }),
    ).rejects.toThrow("schema mismatch");

    await expect(
      adaptSyntheticInboundWorkItem({
        store,
        securityStore,
        envelope: inboundEnvelope({
          bindingId: binding.id,
          schemaVersion: 1,
        }) as SyntheticInboundEnvelopeV0 & { schemaVersion: number },
      }),
    ).rejects.toThrow("schema mismatch");

    const auditEvents = await securityStore.listAuditEvents();
    expect(auditEvents).toHaveLength(3);
    expect(auditEvents).toEqual(expect.arrayContaining([
      expect.objectContaining({ workspaceId: "workspace-2", reasonCodes: ["workspace_mismatch"] }),
      expect.objectContaining({ workspaceId: workSource.workspaceId, reasonCodes: ["schema_mismatch"] }),
      expect.objectContaining({ workspaceId: workSource.workspaceId, reasonCodes: ["schema_mismatch"] }),
    ]));
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

function inboundEnvelope(input: {
  bindingId: string;
  workspaceId?: string;
  providerKind?: string;
  schemaVersion?: number;
  headers?: Record<string, string | undefined>;
  credentialRef?: string | null;
  payload?: unknown;
}): SyntheticInboundEnvelopeV0 {
  return {
    schema: "pluto.integration.synthetic-inbound",
    schemaVersion: (input.schemaVersion ?? 0) as 0,
    workspaceId: input.workspaceId ?? "workspace-1",
    providerKind: input.providerKind ?? "linear",
    bindingId: input.bindingId,
    receivedAt: "2026-04-30T01:00:00.000Z",
    headers: input.headers ?? {
      "x-provider-signature": "sig-1",
    },
    security: {
      credentialRef: input.credentialRef === undefined ? "cred-inbound-1" : input.credentialRef,
      signatureHeader: "x-provider-signature",
      expectedSignature: "sig-1",
    },
    item: {
      externalId: "item-1",
      resourceType: "ticket",
      title: "Weekly digest",
      sourceUrl: "https://provider.example.test/items/item-1",
      workspaceId: input.workspaceId ?? "workspace-1",
      documentSeed: {
        documentId: "doc-1",
        versionId: "ver-1",
      },
    },
    payload: input.payload ?? {
      title: "Weekly digest",
    },
  };
}
