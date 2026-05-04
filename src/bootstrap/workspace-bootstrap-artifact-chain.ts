import { writeFile } from "node:fs/promises";
import { join } from "node:path";

import type { PrincipalRefV0, WorkspaceScopedRefV0 } from "../contracts/identity.js";
import { toImmutableEvidencePacketMetadataV0 } from "../contracts/evidence-graph.js";
import type { EvidencePacketV0 } from "../contracts/types.js";
import { buildFirstRunRecords } from "./first-run.js";
import type { BootstrapObjectRefV0 } from "./contracts.js";
import type { LocalWorkspaceBootstrapStores } from "./workspace-bootstrap-records.js";
import {
  SESSION_ID,
  STEP_ADMIN_ID,
  STEP_PRINCIPAL_ID,
  STEP_WORKSPACE_ID,
  checksumFor,
  failureRecordId,
  makeSessionRecord,
  makeStepRecord,
  objectRef,
} from "./workspace-bootstrap-records.js";

export async function putBlockedBootstrapRecords(input: {
  bootstrap: LocalWorkspaceBootstrapStores["bootstrap"];
  now: string;
  workspaceRef: WorkspaceScopedRefV0;
  principalRef: PrincipalRefV0;
  createdObjectRefs: BootstrapObjectRefV0[];
  blockingReason: string;
  resolutionHint: string;
}): Promise<void> {
  await input.bootstrap.putStep(makeStepRecord({
    now: input.now,
    workspaceRef: input.workspaceRef,
    principalRef: input.principalRef,
    stepId: STEP_WORKSPACE_ID,
    title: "Ensure local workspace ref",
    status: "succeeded",
    createdObjectRefs: [input.createdObjectRefs[0]!],
    dependsOnStepIds: [],
  }));
  await input.bootstrap.putStep(makeStepRecord({
    now: input.now,
    workspaceRef: input.workspaceRef,
    principalRef: input.principalRef,
    stepId: STEP_PRINCIPAL_ID,
    title: "Ensure initiating principal ref",
    status: "succeeded",
    createdObjectRefs: [input.createdObjectRefs[1]!],
    dependsOnStepIds: [STEP_WORKSPACE_ID],
  }));
  await input.bootstrap.putStep(makeStepRecord({
    now: input.now,
    workspaceRef: input.workspaceRef,
    principalRef: input.principalRef,
    stepId: STEP_ADMIN_ID,
    title: "Ensure first admin binding",
    status: "blocked",
    createdObjectRefs: [],
    dependsOnStepIds: [STEP_PRINCIPAL_ID],
    blockingReason: input.blockingReason,
    resolutionHint: input.resolutionHint,
    finishedAt: null,
  }));
  await input.bootstrap.putSession(makeSessionRecord({
    now: input.now,
    workspaceRef: input.workspaceRef,
    principalRef: input.principalRef,
    status: "blocked",
    blockingReason: input.blockingReason,
    resolutionHint: input.resolutionHint,
    finishedAt: null,
    createdObjectRefs: input.createdObjectRefs,
  }));
  await input.bootstrap.putFailure({
    schema: "pluto.bootstrap.failure",
    schemaVersion: 0,
    id: failureRecordId(input.workspaceRef.workspaceId),
    sessionId: SESSION_ID,
    stepId: STEP_ADMIN_ID,
    workspaceRef: input.workspaceRef,
    actorRefs: [input.principalRef],
    status: "active",
    blockingReason: input.blockingReason,
    resolutionHint: input.resolutionHint,
    createdObjectRefs: input.createdObjectRefs,
    createdAt: input.now,
    updatedAt: input.now,
    resolvedAt: null,
  });
}

export async function ensureBootstrapArtifactChain(input: {
  stores: LocalWorkspaceBootstrapStores;
  now: string;
  workspaceRef: WorkspaceScopedRefV0;
  principalRef: PrincipalRefV0;
}): Promise<BootstrapObjectRefV0[]> {
  const workspaceId = input.workspaceRef.workspaceId;
  const runId = `bootstrap-${workspaceId}-run-1`;
  const artifactMarkdown = `# Bootstrap artifact\n\nWorkspace ${workspaceId} bootstrap completed.\n`;
  const evidencePacket: EvidencePacketV0 = {
    schemaVersion: 0,
    runId,
    taskTitle: "Bootstrap first artifact",
    status: "done",
    blockerReason: null,
    startedAt: input.now,
    finishedAt: input.now,
    workspace: workspaceId,
    summaryMd: artifactMarkdown,
    results: [],
    artifacts: [{ kind: "report", path: `.pluto/runs/${runId}/artifact.md`, description: "Bootstrap artifact" }],
    workers: [],
    validation: { outcome: "pass", reason: null },
    citedInputs: { taskPrompt: "bootstrap workspace", workspaceMarkers: [] },
    risks: [],
    openQuestions: [],
    classifierVersion: 0,
    generatedAt: input.now,
  };
  const firstRun = buildFirstRunRecords({
    workspaceId,
    ownerId: input.principalRef.principalId,
    documentTitle: "Bootstrap document",
    runId,
    runStatus: "done",
    blockerReason: null,
    finishedAt: input.now,
    evidencePacket,
  });

  await input.stores.governance.put("document", firstRun.document);
  await input.stores.governance.put("version", firstRun.version);
  await input.stores.runs.appendEvent({
    id: `${runId}:started`,
    runId,
    ts: input.now,
    type: "run_started",
    payload: { title: evidencePacket.taskTitle },
  });
  await input.stores.runs.writeArtifact({
    runId,
    markdown: artifactMarkdown,
    leadSummary: "Bootstrap workspace artifact created.",
    contributions: [],
  });
  await input.stores.runs.appendEvent({
    id: `${runId}:completed`,
    runId,
    ts: input.now,
    type: "run_completed",
    payload: {},
  });
  await writeFile(
    join(input.stores.runs.runDir(runId), "evidence.json"),
    `${JSON.stringify(evidencePacket, null, 2)}\n`,
    "utf8",
  );
  const sealedEvidenceId = `sealed-${runId}`;
  await input.stores.evidence.putSealedEvidenceRef({
    id: sealedEvidenceId,
    packetId: `packet-${runId}`,
    runId,
    evidencePath: `.pluto/runs/${runId}/evidence.json`,
    sealChecksum: `sha256:${checksumFor(evidencePacket).digest}`,
    sealedAt: input.now,
    sourceRun: {
      runId,
      status: "done",
      blockerReason: null,
      finishedAt: input.now,
    },
    immutablePacket: { ...toImmutableEvidencePacketMetadataV0(evidencePacket) },
  });

  return [
    objectRef(input.workspaceRef, { workspaceId, kind: "document", id: firstRun.document.id }, "document", input.principalRef, input.now, "Bootstrap document reconciled"),
    objectRef(input.workspaceRef, { workspaceId, kind: "version", id: firstRun.version.id }, "version", input.principalRef, input.now, "Bootstrap version reconciled"),
    objectRef(input.workspaceRef, { workspaceId, kind: "run", id: runId }, "run", input.principalRef, input.now, "Bootstrap run reconciled"),
    objectRef(input.workspaceRef, { workspaceId, kind: "artifact", id: `${runId}:artifact.md` }, "artifact", input.principalRef, input.now, "Bootstrap artifact reconciled"),
    objectRef(input.workspaceRef, { workspaceId, kind: "sealed_evidence", id: sealedEvidenceId }, "sealed_evidence", input.principalRef, input.now, "Bootstrap evidence packet reconciled"),
  ];
}
