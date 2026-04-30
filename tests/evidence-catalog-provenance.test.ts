import { describe, expect, it } from "vitest";

import {
  generateEvidencePacket,
  validateEvidencePacketV0,
} from "@/orchestrator/evidence.js";
import type {
  AgentEvent,
  EvidencePacketV0,
  TeamRunResult,
  TeamTask,
} from "@/contracts/types.js";

function makeTask(): TeamTask {
  return {
    id: "evidence-provenance-task",
    title: "Evidence provenance task",
    prompt: "Summarize worker output with provenance pins.",
    workspacePath: "/tmp/pluto-evidence-provenance",
    minWorkers: 2,
  };
}

function makeEvents(runId: string): AgentEvent[] {
  return [
    {
      id: "e1",
      runId,
      ts: "2026-04-30T00:00:00.000Z",
      type: "worker_started",
      roleId: "generator",
      sessionId: "generator-session",
      payload: {
        catalogSelection: {
          entry: { id: "default-generator", version: "0.0.1" },
          workerRole: { id: "generator", version: "0.0.1" },
          skill: { id: "generate-artifact", version: "0.0.1" },
          template: { id: "generator-body", version: "0.0.1" },
          policyPack: { id: "default-guardrails", version: "0.0.1" },
        },
      },
    },
    {
      id: "e2",
      runId,
      ts: "2026-04-30T00:00:01.000Z",
      type: "worker_completed",
      roleId: "generator",
      sessionId: "generator-session",
      payload: {
        output: "Generated artifact body",
        catalogSelection: {
          entry: { id: "default-generator", version: "0.0.1" },
          workerRole: { id: "generator", version: "0.0.1" },
          skill: { id: "generate-artifact", version: "0.0.1" },
          template: { id: "generator-body", version: "0.0.1" },
          policyPack: { id: "default-guardrails", version: "0.0.1" },
        },
      },
    },
  ];
}

function makeResult(runId: string): TeamRunResult {
  return {
    runId,
    status: "completed",
    events: makeEvents(runId),
    artifact: {
      runId,
      markdown: "# Artifact\nGenerated artifact body",
      leadSummary: "Artifact",
      contributions: [
        {
          roleId: "generator",
          sessionId: "generator-session",
          output: "Generated artifact body",
          workerRoleRef: { id: "generator", version: "0.0.1" },
          skillRef: { id: "generate-artifact", version: "0.0.1" },
          templateRef: { id: "generator-body", version: "0.0.1" },
          policyPackRefs: [{ id: "default-guardrails", version: "0.0.1" }],
          catalogEntryRef: { id: "default-generator", version: "0.0.1" },
          extensionInstallRef: null,
        },
      ],
    },
    blockerReason: null,
  };
}

function makeLegacyPacket(): EvidencePacketV0 {
  return {
    schemaVersion: 0,
    runId: "legacy-run",
    taskTitle: "Legacy evidence",
    status: "done",
    blockerReason: null,
    startedAt: "2026-04-30T00:00:00.000Z",
    finishedAt: "2026-04-30T00:00:01.000Z",
    workspace: null,
    workers: [
      {
        role: "planner",
        sessionId: "planner-session",
        contributionSummary: "Legacy summary",
        tokenUsageApprox: null,
        durationMsApprox: null,
      },
    ],
    validation: { outcome: "na", reason: null },
    citedInputs: { taskPrompt: "prompt", workspaceMarkers: [] },
    risks: [],
    openQuestions: [],
    classifierVersion: 0,
    generatedAt: "2026-04-30T00:00:01.000Z",
  };
}

describe("evidence catalog provenance pins", () => {
  it("carries the exact worker provenance pin set into evidence workers", () => {
    const packet = generateEvidencePacket({
      task: makeTask(),
      result: makeResult("run-provenance-1"),
      events: makeEvents("run-provenance-1"),
      startedAt: new Date("2026-04-30T00:00:00.000Z"),
      finishedAt: new Date("2026-04-30T00:00:01.000Z"),
      blockerReason: null,
    });

    expect(validateEvidencePacketV0(packet).ok).toBe(true);
    expect(packet.workers).toEqual([
      {
        role: "generator",
        sessionId: "generator-session",
        contributionSummary: "Generated artifact body",
        tokenUsageApprox: null,
        durationMsApprox: null,
        workerRoleRef: { id: "generator", version: "0.0.1" },
        skillRef: { id: "generate-artifact", version: "0.0.1" },
        templateRef: { id: "generator-body", version: "0.0.1" },
        policyPackRefs: [{ id: "default-guardrails", version: "0.0.1" }],
        catalogEntryRef: { id: "default-generator", version: "0.0.1" },
        extensionInstallRef: null,
      },
    ]);
  });

  it("keeps historical evidence without provenance pins schema-valid", () => {
    expect(validateEvidencePacketV0(makeLegacyPacket()).ok).toBe(true);
  });
});
