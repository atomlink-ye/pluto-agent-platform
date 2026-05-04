import { classifyBootstrapFailureReasonV0 } from "./failures.js";
import { collectCanonicalBootstrapObjectRefsV0, reconcileBootstrapSessionV0 } from "./reconcile.js";
import type { BootstrapChecklistV0, BootstrapObjectRefV0, BootstrapSessionV0 } from "./contracts.js";
import {
  BOOTSTRAP_STEP_IDS,
  DEFAULT_WORKSPACE_ID,
  SESSION_ID,
  STEP_ADMIN_ID,
  STEP_PRINCIPAL_ID,
  STEP_WORKSPACE_ID,
  createStores,
  failureRecordId,
  metadataRecordId,
  readStateFromMetadata,
  type BootstrapStateStatusV0,
  type LocalWorkspaceBootstrapStateV0,
  type LocalWorkspaceBootstrapStatusV0,
  type LocalWorkspaceBootstrapStores,
} from "./workspace-bootstrap-records.js";

export async function getLocalWorkspaceBootstrapStatus(
  options: { dataDir?: string; workspaceId?: string } = {},
): Promise<LocalWorkspaceBootstrapStatusV0> {
  const dataDir = options.dataDir;
  const workspaceId = options.workspaceId ?? DEFAULT_WORKSPACE_ID;
  const stores = createStores(dataDir);
  const stateRecord = await stores.storage.get("metadata", metadataRecordId(workspaceId));
  const state = readStateFromMetadata(stateRecord);

  if (state === null) {
    const reconciled = await buildStatusFromUnderlyingStores(stores, workspaceId);
    if (reconciled !== null) {
      return {
        schema: "pluto.bootstrap.local-workspace-status",
        schemaVersion: 0,
        ...reconciled,
      };
    }

    return {
      schema: "pluto.bootstrap.local-workspace-status",
      schemaVersion: 0,
      status: "uninitialized",
      workspaceRef: null,
      principalRef: null,
      adminBindingRef: null,
      session: null,
      checklist: null,
      failures: [],
      blocker: null,
      lastCompletedAt: null,
      lastResetAt: null,
      updatedAt: null,
    };
  }

  const status = await buildStatusFromState(stores, state);
  return {
    schema: "pluto.bootstrap.local-workspace-status",
    schemaVersion: 0,
    ...status,
  };
}

export async function buildStatusFromState(
  stores: LocalWorkspaceBootstrapStores,
  state: LocalWorkspaceBootstrapStateV0,
): Promise<Omit<LocalWorkspaceBootstrapStatusV0, "schema" | "schemaVersion">> {
  const sessionRecord = await stores.bootstrap.getSession(state.workspaceRef.workspaceId, state.sessionId);
  const session = await reconcileBootstrapSessionV0({
    stores,
    workspaceId: state.workspaceRef.workspaceId,
    principalRef: state.principalRef,
    adminBindingRef: state.adminBindingRef,
    session: sessionRecord,
  });
  const checklist = session === null ? null : await stores.bootstrap.getChecklist(state.workspaceRef.workspaceId, state.sessionId);
  const failures = session === null ? [] : await stores.bootstrap.listFailures(state.workspaceRef.workspaceId, state.sessionId);
  const activeFailure = failures.find((failure) => failure.status === "active") ?? null;
  const classified = classifyBootstrapFailureReasonV0(activeFailure ?? (state.blockerReason === null
    ? null
    : {
        blockingReason: state.blockerReason,
        resolutionHint: state.resolutionHint,
      }));
  return {
    status: projectBootstrapStatus(state.status, session, checklist),
    workspaceRef: state.workspaceRef,
    principalRef: state.principalRef,
    adminBindingRef: state.adminBindingRef,
    session,
    checklist,
    failures,
    blocker: activeFailure === null
      ? state.blockerReason === null || classified === null
        ? null
        : {
            failureId: failureRecordId(state.workspaceRef.workspaceId),
            reason: state.blockerReason,
            reasonCode: classified.reasonCode,
            resolutionHint: state.resolutionHint,
            retryable: classified.retryable,
          }
      : {
          failureId: activeFailure.id,
          reason: activeFailure.blockingReason,
          reasonCode: classified?.reasonCode ?? "run_failed",
          resolutionHint: activeFailure.resolutionHint,
          retryable: classified?.retryable ?? false,
        },
    lastCompletedAt: state.lastCompletedAt,
    lastResetAt: state.lastResetAt,
    updatedAt: state.updatedAt,
  };
}

export async function buildStatusFromUnderlyingStores(
  stores: LocalWorkspaceBootstrapStores,
  workspaceId: string,
): Promise<Omit<LocalWorkspaceBootstrapStatusV0, "schema" | "schemaVersion"> | null> {
  const workspace = await stores.identity.get("workspace", workspaceId);
  if (workspace === null) {
    return null;
  }

  const adminBinding = (await stores.identity.list("membership_binding"))
    .filter((binding) => binding.workspaceId === workspaceId && binding.role === "admin")
    .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))[0] ?? null;
  const principalRef = adminBinding?.principal ?? workspace.ownerRef;
  const adminBindingRef = adminBinding === null
    ? null
    : { workspaceId, kind: "membership_binding" as const, id: adminBinding.id };
  const createdObjectRefs = await collectCanonicalBootstrapObjectRefsV0({
    stores,
    workspaceId,
    principalRef,
    adminBindingRef,
  });

  return {
    status: adminBinding?.status === "revoked"
      ? "reset"
      : hasFullSuccessfulBootstrapObjectChain(createdObjectRefs) ? "completed" : "ready",
    workspaceRef: { workspaceId, kind: "workspace", id: workspaceId },
    principalRef,
    adminBindingRef,
    session: {
      schema: "pluto.bootstrap.session",
      schemaVersion: 0,
      id: SESSION_ID,
      workspaceRef: { workspaceId, kind: "workspace", id: workspaceId },
      actorRefs: principalRef ? [principalRef] : [],
      status: adminBinding?.status === "revoked" ? "blocked" : "succeeded",
      createdAt: workspace.createdAt,
      updatedAt: adminBinding?.updatedAt ?? workspace.updatedAt,
      startedAt: workspace.createdAt,
      finishedAt: adminBinding?.updatedAt ?? workspace.updatedAt,
      blockingReason: null,
      resolutionHint: null,
      stepIds: [STEP_WORKSPACE_ID, STEP_PRINCIPAL_ID, STEP_ADMIN_ID],
      createdObjectRefs,
    },
    checklist: null,
    failures: [],
    blocker: null,
    lastCompletedAt: adminBinding?.status === "revoked" ? null : adminBinding?.updatedAt ?? workspace.updatedAt,
    lastResetAt: adminBinding?.status === "revoked" ? adminBinding.updatedAt : null,
    updatedAt: adminBinding?.updatedAt ?? workspace.updatedAt,
  };
}

function projectBootstrapStatus(
  stateStatus: BootstrapStateStatusV0,
  session: BootstrapSessionV0 | null,
  checklist: BootstrapChecklistV0 | null,
): BootstrapStateStatusV0 {
  if (stateStatus === "blocked" || stateStatus === "reset") {
    return stateStatus;
  }

  if (hasFullSuccessfulBootstrapChecklist(checklist) || hasFullSuccessfulBootstrapObjectChain(session?.createdObjectRefs ?? [])) {
    return "completed";
  }

  return stateStatus;
}

function hasFullSuccessfulBootstrapChecklist(checklist: BootstrapChecklistV0 | null): boolean {
  if (checklist === null || checklist.status !== "succeeded") {
    return false;
  }

  const succeededStepIds = new Set(
    checklist.items
      .filter((item) => item.status === "succeeded")
      .map((item) => item.stepId),
  );
  return BOOTSTRAP_STEP_IDS.every((stepId) => succeededStepIds.has(stepId));
}

function hasFullSuccessfulBootstrapObjectChain(objectRefs: readonly BootstrapObjectRefV0[]): boolean {
  const succeededObjectTypes = new Set(
    objectRefs
      .filter((ref) => ref.status === "succeeded" || ref.status === "ready" || ref.status === "done")
      .map((ref) => ref.objectType),
  );
  return ["workspace", "document", "version", "run", "artifact", "sealed_evidence"]
    .every((objectType) => succeededObjectTypes.has(objectType));
}
