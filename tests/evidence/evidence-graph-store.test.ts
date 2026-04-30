import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { toImmutableEvidencePacketMetadataV0 } from "@/contracts/evidence-graph.js";
import type { EvidencePacketV0 } from "@/contracts/types.js";
import { EvidenceGraphStore, evidenceGraphDir } from "@/evidence/evidence-graph.js";

function makePacket(): EvidencePacketV0 {
  return {
    schemaVersion: 0,
    runId: "run-r3-1",
    taskTitle: "Evidence graph test",
    status: "done",
    blockerReason: null,
    startedAt: "2026-04-30T00:00:00.000Z",
    finishedAt: "2026-04-30T00:00:02.000Z",
    workspace: null,
    workers: [
      {
        role: "planner",
        sessionId: "planner-session",
        contributionSummary: "Summarized planning output",
        tokenUsageApprox: 12,
        durationMsApprox: 345,
      },
    ],
    validation: { outcome: "pass", reason: null },
    citedInputs: { taskPrompt: "prompt", workspaceMarkers: ["src/index.ts"] },
    risks: [],
    openQuestions: [],
    classifierVersion: 0,
    generatedAt: "2026-04-30T00:00:03.000Z",
  };
}

describe("EvidenceGraphStore", () => {
  let dataDir: string;

  afterEach(async () => {
    if (dataDir) {
      await rm(dataDir, { recursive: true, force: true });
    }
  });

  it("round-trips sealed evidence refs, citations, and provenance edges through the store facade", async () => {
    dataDir = await mkdtemp(join(tmpdir(), "pluto-evidence-graph-store-"));
    const store = new EvidenceGraphStore({ dataDir });
    const packet = makePacket();

    const sealedPath = await store.putSealedEvidenceRef({
      id: "sealed-1",
      packetId: "packet-1",
      runId: packet.runId,
      evidencePath: ".pluto/runs/run-r3-1/evidence.json",
      sealChecksum: "sha256:sealed-1",
      sealedAt: "2026-04-30T00:00:04.000Z",
      sourceRun: {
        runId: packet.runId,
        status: "done",
        blockerReason: null,
        finishedAt: packet.finishedAt,
        providerSessionId: "hidden",
      },
      validationSummary: {
        outcome: packet.validation.outcome,
        reason: packet.validation.reason,
        transcript: "not persisted",
      },
      redactionSummary: {
        redactedAt: "2026-04-30T00:00:03.500Z",
        fieldsRedacted: 2,
        summary: "Removed session identifiers before sealing.",
        credentials: "not persisted",
      },
      immutablePacket: {
        ...toImmutableEvidencePacketMetadataV0(packet),
        runtimePayload: { should: "not persist" },
      },
    });

    await store.putCitationRef({
      id: "citation-1",
      citationKind: "worker_contribution",
      sealedEvidenceId: "sealed-1",
      locator: "workers[0]",
      summary: "Planner contribution summary",
    });

    await store.putProvenanceEdge({
      id: "edge-1",
      edgeKind: "worker_contribution",
      from: { kind: "sealed_evidence", id: "sealed-1", transcript: "not persisted" },
      to: { kind: "citation", id: "citation-1", callback: { url: "https://internal.invalid" } },
      summary: "Citation derived from sealed worker summary",
      createdAt: "2026-04-30T00:00:05.000Z",
    });

    await expect(store.getSealedEvidenceRef("sealed-1")).resolves.toEqual({
      schemaVersion: 0,
      kind: "sealed_evidence",
      id: "sealed-1",
      packetId: "packet-1",
      runId: "run-r3-1",
      evidencePath: ".pluto/runs/run-r3-1/evidence.json",
      sealChecksum: "sha256:sealed-1",
      sealedAt: "2026-04-30T00:00:04.000Z",
      sourceRun: {
        runId: "run-r3-1",
        status: "succeeded",
        blockerReason: null,
        finishedAt: "2026-04-30T00:00:02.000Z",
      },
      validationSummary: { outcome: "pass", reason: null },
      redactionSummary: {
        redactedAt: "2026-04-30T00:00:03.500Z",
        fieldsRedacted: 2,
        summary: "Removed session identifiers before sealing.",
      },
      immutablePacket: toImmutableEvidencePacketMetadataV0(packet),
    });

    await expect(store.getCitationRef("citation-1")).resolves.toEqual({
      schemaVersion: 0,
      kind: "citation",
      id: "citation-1",
      citationKind: "worker_contribution",
      sealedEvidenceId: "sealed-1",
      locator: "workers[0]",
      summary: "Planner contribution summary",
    });

    await expect(store.getProvenanceEdge("edge-1")).resolves.toEqual({
      schemaVersion: 0,
      kind: "provenance_edge",
      id: "edge-1",
      edgeKind: "worker_contribution",
      from: { kind: "sealed_evidence", id: "sealed-1" },
      to: { kind: "citation", id: "citation-1" },
      summary: "Citation derived from sealed worker summary",
      createdAt: "2026-04-30T00:00:05.000Z",
    });

    await expect(store.listSealedEvidenceRefs()).resolves.toHaveLength(1);
    await expect(store.listCitationRefs()).resolves.toHaveLength(1);
    await expect(store.listProvenanceEdges()).resolves.toHaveLength(1);

    const storedJson = await readFile(join(evidenceGraphDir(dataDir, "sealed_evidence"), "sealed-1.json"), "utf8");
    expect(storedJson).not.toContain("providerSessionId");
    expect(storedJson).not.toContain("runtimePayload");
    expect(sealedPath).toBe(join(evidenceGraphDir(dataDir, "sealed_evidence"), "sealed-1.json"));
  });
});
