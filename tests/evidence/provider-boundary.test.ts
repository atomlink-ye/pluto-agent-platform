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
    runId: "run-provider-boundary-1",
    taskTitle: "Boundary evidence",
    status: "done",
    blockerReason: null,
    startedAt: "2026-04-30T00:00:00.000Z",
    finishedAt: "2026-04-30T00:00:01.000Z",
    workspace: null,
    workers: [
      {
        role: "lead",
        sessionId: "lead-session",
        contributionSummary: "Reference-only lead summary",
        tokenUsageApprox: null,
        durationMsApprox: null,
      },
    ],
    validation: { outcome: "pass", reason: null },
    citedInputs: { taskPrompt: "prompt", workspaceMarkers: [] },
    risks: [],
    openQuestions: [],
    classifierVersion: 0,
    generatedAt: "2026-04-30T00:00:02.000Z",
    orchestration: {
      playbookId: "playbook-neutral-1",
      orchestrationSource: "teamlead_direct",
      transcript: {
        kind: "shared_channel",
        path: ".pluto/runs/run-provider-boundary-1/coordination-transcript.jsonl",
        roomRef: "coordination-room-1",
      },
    },
  };
}

describe("evidence graph provider boundary", () => {
  let dataDir: string;

  afterEach(async () => {
    if (dataDir) {
      await rm(dataDir, { recursive: true, force: true });
    }
  });

  it("persists refs and summaries only, never raw transcripts, session payloads, credentials, or callbacks", async () => {
    dataDir = await mkdtemp(join(tmpdir(), "pluto-evidence-boundary-"));
    const store = new EvidenceGraphStore({ dataDir });
    const packet = makePacket();

    await store.putSealedEvidenceRef({
      id: "sealed-boundary-1",
      runId: packet.runId,
      evidencePath: ".pluto/runs/run-provider-boundary-1/evidence.json",
      sealChecksum: "sha256:boundary",
      sealedAt: "2026-04-30T00:00:03.000Z",
      sourceRun: {
        runId: packet.runId,
        status: "done",
        blockerReason: null,
        finishedAt: packet.finishedAt,
        providerSessionPayload: { transcript: "raw transcript" },
      },
      validationSummary: {
        outcome: "pass",
        reason: null,
        callbackPayload: { url: "https://internal.invalid/callback" },
      },
      redactionSummary: {
        redactedAt: "2026-04-30T00:00:02.500Z",
        fieldsRedacted: 3,
        summary: "Removed provider callback and credentials.",
        apiKey: "secret-key",
      },
      immutablePacket: {
        ...toImmutableEvidencePacketMetadataV0(packet),
        transcript: "should never persist",
      },
      credentials: { token: "secret" },
    } as Parameters<typeof store.putSealedEvidenceRef>[0]);

    await store.putCitationRef({
      id: "citation-boundary-1",
      citationKind: "generated_artifact",
      sealedEvidenceId: "sealed-boundary-1",
      locator: "artifact.md#L1-L3",
      summary: "Generated artifact summary only",
      transcript: "raw model transcript",
    } as Parameters<typeof store.putCitationRef>[0]);

    await store.putProvenanceEdge({
      id: "edge-boundary-1",
      edgeKind: "generated_artifact",
      from: {
        kind: "sealed_evidence",
        id: "sealed-boundary-1",
        providerSessionPayload: { transcript: "raw transcript" },
      },
      to: {
        kind: "citation",
        id: "citation-boundary-1",
        callback: { url: "https://internal.invalid/callback" },
      },
      summary: "Artifact citation derived from sealed evidence",
      createdAt: "2026-04-30T00:00:04.000Z",
      cookies: "session=secret",
    } as Parameters<typeof store.putProvenanceEdge>[0]);

    const sealedRaw = await readFile(join(evidenceGraphDir(dataDir, "sealed_evidence"), "sealed-boundary-1.json"), "utf8");
    const citationRaw = await readFile(join(evidenceGraphDir(dataDir, "citation"), "citation-boundary-1.json"), "utf8");
    const edgeRaw = await readFile(join(evidenceGraphDir(dataDir, "provenance_edge"), "edge-boundary-1.json"), "utf8");
    const combined = `${sealedRaw}\n${citationRaw}\n${edgeRaw}`;

    expect(combined).not.toContain("raw transcript");
    expect(combined).not.toContain("providerSessionPayload");
    expect(combined).not.toContain("callbackPayload");
    expect(combined).not.toContain("https://internal.invalid/callback");
    expect(combined).not.toContain("secret-key");
    expect(combined).not.toContain("session=secret");
    expect(combined).not.toContain('"credentials"');
    expect(combined).not.toContain("paseo_chat");

    expect(JSON.parse(sealedRaw)).toEqual({
      schemaVersion: 0,
      kind: "sealed_evidence",
      id: "sealed-boundary-1",
      packetId: "sealed-boundary-1",
      runId: "run-provider-boundary-1",
      evidencePath: ".pluto/runs/run-provider-boundary-1/evidence.json",
      sealChecksum: "sha256:boundary",
      sealedAt: "2026-04-30T00:00:03.000Z",
      sourceRun: {
        runId: "run-provider-boundary-1",
        status: "succeeded",
        blockerReason: null,
        finishedAt: "2026-04-30T00:00:01.000Z",
      },
      validationSummary: { outcome: "pass", reason: null },
      redactionSummary: {
        redactedAt: "2026-04-30T00:00:02.500Z",
        fieldsRedacted: 3,
        summary: "Removed provider callback and credentials.",
      },
      immutablePacket: toImmutableEvidencePacketMetadataV0(packet),
    });
  });
});
