import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";

import type { BootstrapObjectRefV0, BootstrapSessionV0 } from "./contracts.js";
import type { PrincipalRefV0, WorkspaceScopedRefV0 } from "../contracts/identity.js";
import { GovernanceStore } from "../governance/governance-store.js";
import { EvidenceGraphStore } from "../evidence/evidence-graph.js";
import { RunStore } from "../orchestrator/run-store.js";
import { IdentityStore } from "../identity/identity-store.js";
import type { SampleInstallRecordV0 } from "./sample-install.js";

export interface BootstrapReconciliationStoresV0 {
  dataDir?: string;
  identity: IdentityStore;
  governance: GovernanceStore;
  evidence: EvidenceGraphStore;
  runs: RunStore;
}

export async function reconcileBootstrapSessionV0(input: {
  stores: BootstrapReconciliationStoresV0;
  workspaceId: string;
  principalRef: PrincipalRefV0 | null;
  adminBindingRef: WorkspaceScopedRefV0 | null;
  session: BootstrapSessionV0 | null;
}): Promise<BootstrapSessionV0 | null> {
  if (input.session === null) {
    return null;
  }

  const createdObjectRefs = await collectCanonicalBootstrapObjectRefsV0({
    stores: input.stores,
    workspaceId: input.workspaceId,
    principalRef: input.principalRef,
    adminBindingRef: input.adminBindingRef,
    existingObjectRefs: input.session.createdObjectRefs,
  });
  return {
    ...input.session,
    createdObjectRefs,
  };
}

export async function collectCanonicalBootstrapObjectRefsV0(input: {
  stores: BootstrapReconciliationStoresV0;
  workspaceId: string;
  principalRef: PrincipalRefV0 | null;
  adminBindingRef: WorkspaceScopedRefV0 | null;
  existingObjectRefs?: readonly BootstrapObjectRefV0[];
}): Promise<BootstrapObjectRefV0[]> {
  const workspaceRef: WorkspaceScopedRefV0 = {
    workspaceId: input.workspaceId,
    kind: "workspace",
    id: input.workspaceId,
  };
  const refs = new Map<string, BootstrapObjectRefV0>();

  for (const objectRef of input.existingObjectRefs ?? []) {
    refs.set(objectRef.id, objectRef);
  }

  const workspace = await input.stores.identity.get("workspace", input.workspaceId);
  if (workspace !== null) {
    refs.set(`${input.workspaceId}:workspace:${input.workspaceId}`, makeObjectRef({
      id: `${input.workspaceId}:workspace:${input.workspaceId}`,
      workspaceRef,
      objectRef: workspaceRef,
      objectType: "workspace",
      actorRefs: input.principalRef ? [input.principalRef] : [],
      status: workspace.status === "active" ? "succeeded" : workspace.status,
      summary: "Workspace reconciled",
      createdAt: workspace.createdAt,
      updatedAt: workspace.updatedAt,
    }));
  }

  if (input.principalRef !== null) {
    const principal = await input.stores.identity.get("user", input.principalRef.principalId);
    if (principal !== null) {
      refs.set(`${input.workspaceId}:${input.principalRef.kind}:${input.principalRef.principalId}`, makeObjectRef({
        id: `${input.workspaceId}:${input.principalRef.kind}:${input.principalRef.principalId}`,
        workspaceRef,
        objectRef: {
          workspaceId: input.principalRef.workspaceId,
          kind: input.principalRef.kind,
          id: input.principalRef.principalId,
        },
        objectType: input.principalRef.kind,
        actorRefs: [input.principalRef],
        status: principal.status === "active" ? "succeeded" : principal.status,
        summary: "Bootstrap principal reconciled",
        createdAt: principal.createdAt,
        updatedAt: principal.updatedAt,
      }));
    }
  }

  if (input.adminBindingRef !== null) {
    const binding = await input.stores.identity.get("membership_binding", input.adminBindingRef.id);
    if (binding !== null) {
      refs.set(input.adminBindingRef.id, makeObjectRef({
        id: input.adminBindingRef.id,
        workspaceRef,
        objectRef: input.adminBindingRef,
        objectType: "membership_binding",
        actorRefs: input.principalRef ? [input.principalRef] : [],
        status: binding.status === "active" ? "succeeded" : binding.status,
        summary: binding.status === "revoked" ? "First admin revoked" : "First admin reconciled",
        createdAt: binding.createdAt,
        updatedAt: binding.updatedAt,
      }));
    }
  }

  for (const sample of await listSampleInstallRecordsV0(input.stores.dataDir, input.workspaceId)) {
    refs.set(`bootstrap-sample:${sample.sampleId}`, makeObjectRef({
      id: `bootstrap-sample:${sample.sampleId}`,
      workspaceRef,
      objectRef: {
        workspaceId: sample.workspaceRef.workspaceId,
        kind: "sample_workflow",
        id: sample.sampleId,
      },
      objectType: "sample_workflow",
      actorRefs: sample.actorRefs,
      status: sample.lifecycleStatus,
      summary: `${sample.definition.name} (${sample.scope})`,
      createdAt: sample.installedAt,
      updatedAt: sample.updatedAt,
    }));
  }

  const documentId = `bootstrap-document-${input.workspaceId}`;
  const document = await input.stores.governance.get("document", documentId);
  if (document !== null) {
    refs.set(`bootstrap-document:${document.id}`, makeObjectRef({
      id: `bootstrap-document:${document.id}`,
      workspaceRef,
      objectRef: {
        workspaceId: document.workspaceId,
        kind: "document",
        id: document.id,
      },
      objectType: "document",
      actorRefs: input.principalRef ? [input.principalRef] : [],
      status: document.status,
      summary: document.title,
      createdAt: document.createdAt,
      updatedAt: document.updatedAt,
    }));

    const version = document.currentVersionId === null
      ? null
      : await input.stores.governance.get("version", document.currentVersionId);
    if (version !== null) {
      refs.set(`bootstrap-version:${version.id}`, makeObjectRef({
        id: `bootstrap-version:${version.id}`,
        workspaceRef,
        objectRef: {
          workspaceId: version.workspaceId,
          kind: "version",
          id: version.id,
        },
        objectType: "version",
        actorRefs: input.principalRef ? [input.principalRef] : [],
        status: version.status,
        summary: version.label,
        createdAt: version.createdAt,
        updatedAt: version.updatedAt,
      }));
    }
  }

  const runIds = await collectBootstrapRunIdsV0(input.stores.runs, input.workspaceId);
  for (const runId of runIds) {
    const run = await input.stores.runs.readRunMeta(runId);
    if (run === null) {
      continue;
    }

    refs.set(`bootstrap-run:${run.runId}`, makeObjectRef({
      id: `bootstrap-run:${run.runId}`,
      workspaceRef,
      objectRef: {
        workspaceId: input.workspaceId,
        kind: "run",
        id: run.runId,
      },
      objectType: "run",
      actorRefs: input.principalRef ? [input.principalRef] : [],
      status: run.status === "done" ? "succeeded" : run.status,
      summary: run.taskTitle,
      createdAt: run.startedAt,
      updatedAt: run.finishedAt ?? run.startedAt,
    }));

    const artifactMarkdown = await input.stores.runs.readArtifact(run.runId);
    if (artifactMarkdown !== null) {
      refs.set(`bootstrap-artifact:${run.runId}`, makeObjectRef({
        id: `bootstrap-artifact:${run.runId}`,
        workspaceRef,
        objectRef: {
          workspaceId: input.workspaceId,
          kind: "artifact",
          id: `${run.runId}:artifact.md`,
        },
        objectType: "artifact",
        actorRefs: input.principalRef ? [input.principalRef] : [],
        status: artifactMarkdown.trim().length > 0 ? "succeeded" : "failed",
        summary: `.pluto/runs/${run.runId}/artifact.md`,
        createdAt: run.finishedAt ?? run.startedAt,
        updatedAt: run.finishedAt ?? run.startedAt,
      }));
    }
  }

  for (const sealedEvidence of await input.stores.evidence.listSealedEvidenceRefs()) {
    if (!runIds.has(sealedEvidence.runId)) {
      continue;
    }

    refs.set(`bootstrap-evidence:${sealedEvidence.id}`, makeObjectRef({
      id: `bootstrap-evidence:${sealedEvidence.id}`,
      workspaceRef,
      objectRef: {
        workspaceId: input.workspaceId,
        kind: "sealed_evidence",
        id: sealedEvidence.id,
      },
      objectType: "sealed_evidence",
      actorRefs: input.principalRef ? [input.principalRef] : [],
      status: sealedEvidence.validationSummary.outcome === "fail" ? "failed" : "succeeded",
      summary: sealedEvidence.evidencePath,
      createdAt: sealedEvidence.sealedAt,
      updatedAt: sealedEvidence.sealedAt,
    }));
  }

  return [...refs.values()].sort((left, right) => left.id.localeCompare(right.id));
}

async function collectBootstrapRunIdsV0(runStore: RunStore, workspaceId: string): Promise<Set<string>> {
  const runIds = new Set<string>();
  for (const runId of await runStore.listRunDirs()) {
    const evidence = await runStore.readEvidence(runId);
    const evidenceWorkspace = evidence.json?.workspace;
    if (evidenceWorkspace === workspaceId) {
      runIds.add(runId);
      continue;
    }

    if (runId.startsWith(`bootstrap-${workspaceId}`)) {
      runIds.add(runId);
      continue;
    }

    const run = await runStore.readRunMeta(runId);
    if (run !== null && run.taskTitle.toLowerCase().includes("bootstrap")) {
      runIds.add(runId);
    }
  }

  return runIds;
}

async function listSampleInstallRecordsV0(dataDir: string | undefined, workspaceId: string): Promise<SampleInstallRecordV0[]> {
  const root = dataDir ?? process.env.PLUTO_DATA_DIR ?? ".pluto";
  const dir = join(root, "bootstrap", workspaceId, "samples", "local-v0");

  let entries: string[];
  try {
    entries = await readdir(dir);
  } catch {
    return [];
  }

  const records: SampleInstallRecordV0[] = [];
  for (const entry of entries.filter((value) => value.endsWith(".json")).sort((left, right) => left.localeCompare(right))) {
    try {
      const parsed = JSON.parse(await readFile(join(dir, entry), "utf8")) as SampleInstallRecordV0;
      records.push(parsed);
    } catch {
      continue;
    }
  }

  return records.filter((record) => record.schema === "pluto.bootstrap.sample-install");
}

function makeObjectRef(
  input: Omit<BootstrapObjectRefV0, "schema" | "schemaVersion">,
): BootstrapObjectRefV0 {
  return {
    schema: "pluto.bootstrap.object-ref",
    schemaVersion: 0,
    ...input,
  };
}
