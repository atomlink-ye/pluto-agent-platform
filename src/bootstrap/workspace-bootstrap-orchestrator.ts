import type {
  MembershipBindingV0,
  OrgRecordV0,
  UserRecordV0,
  WorkspaceRecordV0,
} from "../contracts/identity.js";
import { permissionsForRoleV0 } from "../identity/role-matrix.js";
import type { GovernanceEventRecordV0 } from "../audit/governance-events.js";
import {
  createWorkspaceBootstrapAuditEventV0,
  toGovernanceTargetRefV0,
} from "./audit.js";
import { putBlockedBootstrapRecords, ensureBootstrapArtifactChain } from "./workspace-bootstrap-artifact-chain.js";
import { getLocalWorkspaceBootstrapStatus } from "./workspace-bootstrap-status.js";
import {
  DEFAULT_ORG_ID,
  DEFAULT_PRINCIPAL_DISPLAY_NAME,
  DEFAULT_PRINCIPAL_ID,
  DEFAULT_SOURCE_COMMAND,
  DEFAULT_WORKSPACE_DISPLAY_NAME,
  DEFAULT_WORKSPACE_ID,
  DEFAULT_WORKSPACE_SLUG,
  SESSION_ID,
  STEP_ADMIN_ID,
  STEP_ARTIFACT_ID,
  STEP_DOCUMENT_ID,
  STEP_EVIDENCE_ID,
  STEP_PRINCIPAL_ID,
  STEP_RUN_ID,
  STEP_VERSION_ID,
  STEP_WORKSPACE_ID,
  appendStateLedgerEvent,
  createStores,
  failureRecordId,
  isSamePrincipal,
  makeSessionRecord,
  makeStepRecord,
  metadataRecordId,
  objectRef,
  putStateRecord,
  readStateFromMetadata,
  toAdminBindingRef,
  toPrincipalObjectRef,
  toPrincipalRef,
  toWorkspaceRef,
  type EnsureLocalWorkspaceBootstrapOptions,
  type LocalWorkspaceBootstrapResultV0,
  type LocalWorkspaceBootstrapStateV0,
  type ResetLocalWorkspaceBootstrapOptions,
} from "./workspace-bootstrap-records.js";

export async function ensureLocalWorkspaceBootstrap(
  options: EnsureLocalWorkspaceBootstrapOptions = {},
): Promise<LocalWorkspaceBootstrapResultV0> {
  return ensureLocalWorkspaceBootstrapInternal("workspace", options);
}

export async function resumeLocalWorkspaceBootstrap(
  options: EnsureLocalWorkspaceBootstrapOptions = {},
): Promise<LocalWorkspaceBootstrapResultV0> {
  return ensureLocalWorkspaceBootstrapInternal("resume", {
    ...options,
    sourceCommand: options.sourceCommand ?? "bootstrap.resume",
  });
}

export async function resetLocalWorkspaceBootstrap(
  options: ResetLocalWorkspaceBootstrapOptions = {},
): Promise<LocalWorkspaceBootstrapResultV0> {
  const now = options.now ?? new Date().toISOString();
  const workspaceId = options.workspaceId ?? DEFAULT_WORKSPACE_ID;
  const sourceCommand = options.sourceCommand ?? "bootstrap.reset-local";
  const stores = createStores(options.dataDir);
  const stateRecord = await stores.storage.get("metadata", metadataRecordId(workspaceId));
  const state = readStateFromMetadata(stateRecord);

  if (state === null) {
    return {
      command: "reset-local",
      created: { org: false, workspace: false, principal: false, adminBinding: false, stateRef: false },
      activated: { workspace: false, adminBinding: false },
      revoked: { adminBinding: false },
      auditEventIds: [],
      ...(await getLocalWorkspaceBootstrapStatus({ dataDir: options.dataDir, workspaceId })),
    };
  }

  const auditEvents: GovernanceEventRecordV0[] = [];
  let revokedAdminBinding = false;

  const binding = await stores.identity.get("membership_binding", state.adminBindingRef.id);
  if (binding !== null && (binding.status !== "revoked" || binding.revokedAt == null)) {
    const revokedBinding: MembershipBindingV0 = {
      ...binding,
      status: "revoked",
      revokedAt: now,
      updatedAt: now,
    };
    await stores.identity.put("membership_binding", revokedBinding);
    revokedAdminBinding = true;
    auditEvents.push(createWorkspaceBootstrapAuditEventV0({
      eventType: "admin_revoked",
      createdAt: now,
      actorRef: state.principalRef,
      target: toGovernanceTargetRefV0(state.adminBindingRef),
      summary: `workspace admin binding ${state.adminBindingRef.id} revoked`,
      beforeStatus: binding.status,
      afterStatus: revokedBinding.status,
      reason: "reset_local",
      sourceCommand,
      sourceRef: state.adminBindingRef.id,
    }));
  }

  const failures = await stores.bootstrap.listFailures(workspaceId, state.sessionId);
  const activeFailure = failures.find((failure) => failure.status === "active") ?? null;
  if (activeFailure !== null) {
    const resolvedFailure = {
      ...activeFailure,
      status: "resolved" as const,
      updatedAt: now,
      resolvedAt: now,
    };
    await stores.bootstrap.putFailure(resolvedFailure);
    auditEvents.push(createWorkspaceBootstrapAuditEventV0({
      eventType: "blocker_resolved",
      createdAt: now,
      actorRef: state.principalRef,
      target: {
        kind: "bootstrap_failure",
        recordId: resolvedFailure.id,
        workspaceId,
      },
      summary: `bootstrap blocker ${resolvedFailure.id} resolved`,
      beforeStatus: activeFailure.status,
      afterStatus: resolvedFailure.status,
      reason: "reset_local",
      sourceCommand,
      sourceRef: resolvedFailure.id,
    }));
  }

  const resetState: LocalWorkspaceBootstrapStateV0 = {
    ...state,
    status: "reset",
    blockerReason: null,
    resolutionHint: null,
    lastResetAt: now,
    updatedAt: now,
  };
  await putStateRecord(stores.storage, resetState, now);
  await appendStateLedgerEvent(stores.storage, resetState, state.principalRef, now, "bootstrap.reset_local", sourceCommand);
  await stores.audit.appendMany(auditEvents);

  return {
    command: "reset-local",
    created: { org: false, workspace: false, principal: false, adminBinding: false, stateRef: false },
    activated: { workspace: false, adminBinding: false },
    revoked: { adminBinding: revokedAdminBinding },
    auditEventIds: auditEvents.map((event) => event.eventId),
    ...(await getLocalWorkspaceBootstrapStatus({ dataDir: options.dataDir, workspaceId })),
  };
}

async function ensureLocalWorkspaceBootstrapInternal(
  command: "workspace" | "resume",
  options: EnsureLocalWorkspaceBootstrapOptions,
): Promise<LocalWorkspaceBootstrapResultV0> {
  const now = options.now ?? new Date().toISOString();
  const workspaceId = options.workspaceId ?? DEFAULT_WORKSPACE_ID;
  const workspaceRef = toWorkspaceRef(workspaceId);
  const principalRef = toPrincipalRef(workspaceId, options.principalId ?? DEFAULT_PRINCIPAL_ID);
  const adminBindingRef = toAdminBindingRef(workspaceId, principalRef);
  const orgId = options.orgId ?? DEFAULT_ORG_ID;
  const stores = createStores(options.dataDir);
  const sourceCommand = options.sourceCommand ?? DEFAULT_SOURCE_COMMAND;

  const existingStateRecord = await stores.storage.get("metadata", metadataRecordId(workspaceId));
  const existingState = readStateFromMetadata(existingStateRecord);
  const created = { org: false, workspace: false, principal: false, adminBinding: false, stateRef: existingState === null };
  const activated = { workspace: false, adminBinding: false };
  const revoked = { adminBinding: false };
  const auditEvents: GovernanceEventRecordV0[] = [];

  await stores.bootstrap.putSession(makeSessionRecord({
    now,
    workspaceRef,
    principalRef,
    status: "running",
    blockingReason: null,
    resolutionHint: null,
    finishedAt: null,
    createdObjectRefs: [],
  }));

  const principalMismatch = existingState !== null
    && !isSamePrincipal(existingState.principalRef, principalRef)
    && existingState.status !== "reset";

  if (principalMismatch) {
    const createdObjectRefs = [
      objectRef(workspaceRef, workspaceRef, "workspace", principalRef, now, "Workspace bootstrap target"),
      objectRef(workspaceRef, toPrincipalObjectRef(principalRef), principalRef.kind, principalRef, now, "Bootstrap principal ref"),
    ];
    await putBlockedBootstrapRecords({
      bootstrap: stores.bootstrap,
      now,
      workspaceRef,
      principalRef,
      createdObjectRefs,
      blockingReason: "principal_mismatch",
      resolutionHint: "Run reset-local to revoke the current first-admin binding before assigning a new bootstrap principal.",
    });
    const blockedState: LocalWorkspaceBootstrapStateV0 = {
      schema: "pluto.bootstrap.local-workspace-state",
      schemaVersion: 0,
      workspaceRef,
      principalRef: existingState.principalRef,
      adminBindingRef: existingState.adminBindingRef,
      orgId: existingState.orgId,
      sessionId: SESSION_ID,
      status: "blocked",
      blockerReason: "principal_mismatch",
      resolutionHint: "Run reset-local to revoke the current first-admin binding before assigning a new bootstrap principal.",
      lastCompletedAt: existingState.lastCompletedAt,
      lastResetAt: existingState.lastResetAt,
      updatedAt: now,
    };
    await putStateRecord(stores.storage, blockedState, now);
    await appendStateLedgerEvent(stores.storage, blockedState, principalRef, now, "bootstrap.blocked", sourceCommand);
    const failureId = failureRecordId(workspaceId);
    auditEvents.push(createWorkspaceBootstrapAuditEventV0({
      eventType: "bootstrap_blocked",
      createdAt: now,
      actorRef: principalRef,
      target: { kind: "bootstrap_failure", recordId: failureId, workspaceId },
      summary: `bootstrap blocked for ${workspaceId}`,
      afterStatus: "active",
      reason: "principal_mismatch",
      sourceCommand,
      sourceRef: failureId,
    }));
    await stores.audit.appendMany(auditEvents);
    return {
      command,
      created,
      activated,
      revoked,
      auditEventIds: auditEvents.map((event) => event.eventId),
      ...(await getLocalWorkspaceBootstrapStatus({ dataDir: options.dataDir, workspaceId })),
    };
  }

  const workspaceRecord = await stores.identity.get("workspace", workspaceId);
  let ensuredWorkspace: WorkspaceRecordV0;
  if (workspaceRecord === null) {
    ensuredWorkspace = {
      schemaVersion: 0,
      kind: "workspace",
      id: workspaceId,
      orgId,
      slug: options.workspaceSlug ?? DEFAULT_WORKSPACE_SLUG,
      displayName: options.workspaceDisplayName ?? DEFAULT_WORKSPACE_DISPLAY_NAME,
      ownerRef: principalRef,
      createdAt: now,
      updatedAt: now,
      status: "active",
      suspendedAt: null,
    };
    created.workspace = true;
  } else {
    ensuredWorkspace = {
      ...workspaceRecord,
      orgId,
      updatedAt: now,
      status: "active",
      suspendedAt: null,
    };
    activated.workspace = workspaceRecord.status !== "active" || workspaceRecord.suspendedAt != null;
  }

  const orgRecord = await stores.identity.get("org", orgId);
  if (orgRecord === null) {
    const org: OrgRecordV0 = {
      schemaVersion: 0,
      kind: "org",
      id: orgId,
      slug: options.workspaceSlug ?? DEFAULT_WORKSPACE_SLUG,
      displayName: `${options.workspaceDisplayName ?? DEFAULT_WORKSPACE_DISPLAY_NAME} Org`,
      createdAt: now,
      updatedAt: now,
      status: "active",
    };
    await stores.identity.put("org", org);
    created.org = true;
  }
  await stores.identity.put("workspace", ensuredWorkspace);

  const userRecord = await stores.identity.get("user", principalRef.principalId);
  let ensuredUser: UserRecordV0;
  if (userRecord === null) {
    ensuredUser = {
      schemaVersion: 0,
      kind: "user",
      id: principalRef.principalId,
      orgId,
      displayName: options.principalDisplayName ?? DEFAULT_PRINCIPAL_DISPLAY_NAME,
      primaryWorkspaceRef: workspaceRef,
      createdAt: now,
      updatedAt: now,
      status: "active",
    };
    created.principal = true;
  } else {
    ensuredUser = {
      ...userRecord,
      orgId,
      displayName: userRecord.displayName || options.principalDisplayName || DEFAULT_PRINCIPAL_DISPLAY_NAME,
      primaryWorkspaceRef: workspaceRef,
      updatedAt: now,
      status: "active",
    };
  }
  await stores.identity.put("user", ensuredUser);

  const existingBinding = await stores.identity.get("membership_binding", adminBindingRef.id);
  const createdAt = existingBinding?.createdAt ?? now;
  const ensuredBinding: MembershipBindingV0 = {
    schemaVersion: 0,
    kind: "membership_binding",
    id: adminBindingRef.id,
    orgId,
    workspaceId,
    createdAt,
    updatedAt: now,
    status: "active",
    principal: principalRef,
    role: "admin",
    permissions: permissionsForRoleV0("admin"),
    expiresAt: null,
    revokedAt: null,
  };
  created.adminBinding = existingBinding === null;
  activated.adminBinding = existingBinding !== null && (existingBinding.status !== "active" || existingBinding.revokedAt != null);
  await stores.identity.put("membership_binding", ensuredBinding);

  const identityObjectRefs = [
    objectRef(workspaceRef, workspaceRef, "workspace", principalRef, now, created.workspace ? "Workspace created" : "Workspace reconciled"),
    objectRef(workspaceRef, toPrincipalObjectRef(principalRef), principalRef.kind, principalRef, now, created.principal ? "Bootstrap principal created" : "Bootstrap principal reconciled"),
    objectRef(workspaceRef, adminBindingRef, "membership_binding", principalRef, now, created.adminBinding ? "First admin granted" : "First admin reconciled"),
  ];
  const artifactChainObjectRefs = await ensureBootstrapArtifactChain({
    stores,
    now,
    workspaceRef,
    principalRef,
  });
  const createdObjectRefs = [...identityObjectRefs, ...artifactChainObjectRefs];

  await stores.bootstrap.putStep(makeStepRecord({
    now,
    workspaceRef,
    principalRef,
    stepId: STEP_WORKSPACE_ID,
    title: "Ensure local workspace ref",
    status: "succeeded",
    createdObjectRefs: [identityObjectRefs[0]!],
    dependsOnStepIds: [],
  }));
  await stores.bootstrap.putStep(makeStepRecord({
    now,
    workspaceRef,
    principalRef,
    stepId: STEP_PRINCIPAL_ID,
    title: "Ensure initiating principal ref",
    status: "succeeded",
    createdObjectRefs: [identityObjectRefs[1]!],
    dependsOnStepIds: [STEP_WORKSPACE_ID],
  }));
  await stores.bootstrap.putStep(makeStepRecord({
    now,
    workspaceRef,
    principalRef,
    stepId: STEP_ADMIN_ID,
    title: "Ensure first admin binding",
    status: "succeeded",
    createdObjectRefs: [identityObjectRefs[2]!],
    dependsOnStepIds: [STEP_PRINCIPAL_ID],
  }));
  await stores.bootstrap.putStep(makeStepRecord({
    now,
    workspaceRef,
    principalRef,
    stepId: STEP_DOCUMENT_ID,
    title: "Ensure bootstrap document",
    status: "succeeded",
    createdObjectRefs: [artifactChainObjectRefs[0]!],
    dependsOnStepIds: [STEP_ADMIN_ID],
  }));
  await stores.bootstrap.putStep(makeStepRecord({
    now,
    workspaceRef,
    principalRef,
    stepId: STEP_VERSION_ID,
    title: "Ensure bootstrap version",
    status: "succeeded",
    createdObjectRefs: [artifactChainObjectRefs[1]!],
    dependsOnStepIds: [STEP_DOCUMENT_ID],
  }));
  await stores.bootstrap.putStep(makeStepRecord({
    now,
    workspaceRef,
    principalRef,
    stepId: STEP_RUN_ID,
    title: "Ensure bootstrap run",
    status: "succeeded",
    createdObjectRefs: [artifactChainObjectRefs[2]!],
    dependsOnStepIds: [STEP_VERSION_ID],
  }));
  await stores.bootstrap.putStep(makeStepRecord({
    now,
    workspaceRef,
    principalRef,
    stepId: STEP_ARTIFACT_ID,
    title: "Ensure bootstrap artifact",
    status: "succeeded",
    createdObjectRefs: [artifactChainObjectRefs[3]!],
    dependsOnStepIds: [STEP_RUN_ID],
  }));
  await stores.bootstrap.putStep(makeStepRecord({
    now,
    workspaceRef,
    principalRef,
    stepId: STEP_EVIDENCE_ID,
    title: "Ensure bootstrap evidence packet",
    status: "succeeded",
    createdObjectRefs: [artifactChainObjectRefs[4]!],
    dependsOnStepIds: [STEP_ARTIFACT_ID],
  }));
  await stores.bootstrap.putSession(makeSessionRecord({
    now,
    workspaceRef,
    principalRef,
    status: "succeeded",
    blockingReason: null,
    resolutionHint: null,
    finishedAt: now,
    createdObjectRefs,
  }));

  const previousFailures = await stores.bootstrap.listFailures(workspaceId, SESSION_ID);
  const activeFailure = previousFailures.find((failure) => failure.status === "active") ?? null;
  if (activeFailure !== null) {
    await stores.bootstrap.putFailure({
      ...activeFailure,
      status: "resolved",
      updatedAt: now,
      resolvedAt: now,
    });
    auditEvents.push(createWorkspaceBootstrapAuditEventV0({
      eventType: "blocker_resolved",
      createdAt: now,
      actorRef: principalRef,
      target: { kind: "bootstrap_failure", recordId: activeFailure.id, workspaceId },
      summary: `bootstrap blocker ${activeFailure.id} resolved`,
      beforeStatus: activeFailure.status,
      afterStatus: "resolved",
      reason: activeFailure.blockingReason,
      sourceCommand,
      sourceRef: activeFailure.id,
    }));
  }

  const state: LocalWorkspaceBootstrapStateV0 = {
    schema: "pluto.bootstrap.local-workspace-state",
    schemaVersion: 0,
    workspaceRef,
    principalRef,
    adminBindingRef,
    orgId,
    sessionId: SESSION_ID,
    status: "completed",
    blockerReason: null,
    resolutionHint: null,
    lastCompletedAt: now,
    lastResetAt: existingState?.lastResetAt ?? null,
    updatedAt: now,
  };
  await putStateRecord(stores.storage, state, now);
  await appendStateLedgerEvent(stores.storage, state, principalRef, now, "bootstrap.materialized", sourceCommand);

  if (created.workspace) {
    auditEvents.push(createWorkspaceBootstrapAuditEventV0({
      eventType: "workspace_created",
      createdAt: now,
      actorRef: principalRef,
      target: toGovernanceTargetRefV0(workspaceRef),
      summary: `workspace ${workspaceId} created`,
      afterStatus: ensuredWorkspace.status,
      sourceCommand,
      sourceRef: workspaceId,
    }));
  }
  if (activated.workspace) {
    auditEvents.push(createWorkspaceBootstrapAuditEventV0({
      eventType: "workspace_activated",
      createdAt: now,
      actorRef: principalRef,
      target: toGovernanceTargetRefV0(workspaceRef),
      summary: `workspace ${workspaceId} activated`,
      beforeStatus: workspaceRecord?.status ?? null,
      afterStatus: ensuredWorkspace.status,
      sourceCommand,
      sourceRef: workspaceId,
    }));
  }
  if (created.adminBinding || activated.adminBinding) {
    auditEvents.push(createWorkspaceBootstrapAuditEventV0({
      eventType: "admin_granted",
      createdAt: now,
      actorRef: principalRef,
      target: toGovernanceTargetRefV0(adminBindingRef),
      summary: `workspace admin binding ${adminBindingRef.id} granted`,
      beforeStatus: existingBinding?.status ?? null,
      afterStatus: ensuredBinding.status,
      sourceCommand,
      sourceRef: adminBindingRef.id,
    }));
  }
  auditEvents.push(createWorkspaceBootstrapAuditEventV0({
    eventType: "bootstrap_completed",
    createdAt: now,
    actorRef: principalRef,
    target: { kind: "bootstrap_session", recordId: SESSION_ID, workspaceId },
    summary: `workspace bootstrap completed for ${workspaceId}`,
    beforeStatus: "running",
    afterStatus: "succeeded",
    sourceCommand,
    sourceRef: SESSION_ID,
  }));
  await stores.audit.appendMany(auditEvents);

  return {
    command,
    created,
    activated,
    revoked,
    auditEventIds: auditEvents.map((event) => event.eventId),
    ...(await getLocalWorkspaceBootstrapStatus({ dataDir: options.dataDir, workspaceId })),
  };
}
