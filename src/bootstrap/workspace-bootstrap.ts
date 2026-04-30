import { createHash } from "node:crypto";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";

import type {
  MembershipBindingV0,
  OrgRecordV0,
  PrincipalRefV0,
  UserRecordV0,
  WorkspaceRecordV0,
  WorkspaceScopedRefV0,
} from "../contracts/identity.js";
import { permissionsForRoleV0 } from "../identity/role-matrix.js";
import { IdentityStore } from "../identity/identity-store.js";
import { GovernanceEventStore } from "../audit/governance-event-store.js";
import type { GovernanceEventRecordV0 } from "../audit/governance-events.js";
import { BootstrapStore } from "./bootstrap-store.js";
import type {
  BootstrapChecklistV0,
  BootstrapFailureV0,
  BootstrapObjectRefV0,
  BootstrapSessionV0,
  BootstrapStepV0,
} from "./contracts.js";
import { StorageStore } from "../storage/storage-store.js";
import type { EventLedgerEntryV0, MetadataRecordV0 } from "../contracts/storage.js";
import { appendLedgerEventV0 } from "../storage/event-ledger.js";
import { toStorageRefV0 } from "../contracts/storage.js";
import {
  createWorkspaceBootstrapAuditEventV0,
  toGovernanceTargetRefV0,
} from "./audit.js";
import { GovernanceStore } from "../governance/governance-store.js";
import { EvidenceGraphStore } from "../evidence/evidence-graph.js";
import { RunStore } from "../orchestrator/run-store.js";
import { classifyBootstrapFailureReasonV0 } from "./failures.js";
import { collectCanonicalBootstrapObjectRefsV0, reconcileBootstrapSessionV0 } from "./reconcile.js";
import { buildFirstRunRecords } from "./first-run.js";
import { toImmutableEvidencePacketMetadataV0 } from "../contracts/evidence-graph.js";
import type { EvidencePacketV0 } from "../contracts/types.js";

const DEFAULT_WORKSPACE_ID = "workspace-local-v0";
const DEFAULT_ORG_ID = "org-local-v0";
const DEFAULT_WORKSPACE_SLUG = "local-v0";
const DEFAULT_WORKSPACE_DISPLAY_NAME = "Local Workspace";
const DEFAULT_PRINCIPAL_ID = "user-local-admin";
const DEFAULT_PRINCIPAL_DISPLAY_NAME = "Local Workspace Admin";
const DEFAULT_SOURCE_COMMAND = "bootstrap.workspace";

const SESSION_ID = "bootstrap-local-workspace-admin";
const STEP_WORKSPACE_ID = "workspace-ref";
const STEP_PRINCIPAL_ID = "principal-ref";
const STEP_ADMIN_ID = "admin-binding";
const STEP_DOCUMENT_ID = "bootstrap-document";
const STEP_VERSION_ID = "bootstrap-version";
const STEP_RUN_ID = "bootstrap-run";
const STEP_ARTIFACT_ID = "bootstrap-artifact";
const STEP_EVIDENCE_ID = "bootstrap-evidence-packet";
const BOOTSTRAP_STEP_IDS = [
  STEP_WORKSPACE_ID,
  STEP_PRINCIPAL_ID,
  STEP_ADMIN_ID,
  STEP_DOCUMENT_ID,
  STEP_VERSION_ID,
  STEP_RUN_ID,
  STEP_ARTIFACT_ID,
  STEP_EVIDENCE_ID,
] as const;

type BootstrapStateStatusV0 = "ready" | "completed" | "blocked" | "reset";

interface LocalWorkspaceBootstrapStateV0 {
  schema: "pluto.bootstrap.local-workspace-state";
  schemaVersion: 0;
  workspaceRef: WorkspaceScopedRefV0;
  principalRef: PrincipalRefV0;
  adminBindingRef: WorkspaceScopedRefV0;
  orgId: string;
  sessionId: string;
  status: BootstrapStateStatusV0;
  blockerReason: string | null;
  resolutionHint: string | null;
  lastCompletedAt: string | null;
  lastResetAt: string | null;
  updatedAt: string;
}

export interface EnsureLocalWorkspaceBootstrapOptions {
  dataDir?: string;
  now?: string;
  workspaceId?: string;
  orgId?: string;
  workspaceSlug?: string;
  workspaceDisplayName?: string;
  principalId?: string;
  principalDisplayName?: string;
  sourceCommand?: string;
}

export interface ResetLocalWorkspaceBootstrapOptions {
  dataDir?: string;
  now?: string;
  workspaceId?: string;
  sourceCommand?: string;
}

export interface LocalWorkspaceBootstrapStatusV0 {
  schema: "pluto.bootstrap.local-workspace-status";
  schemaVersion: 0;
  status: "uninitialized" | BootstrapStateStatusV0;
  workspaceRef: WorkspaceScopedRefV0 | null;
  principalRef: PrincipalRefV0 | null;
  adminBindingRef: WorkspaceScopedRefV0 | null;
  session: BootstrapSessionV0 | null;
  checklist: BootstrapChecklistV0 | null;
  failures: BootstrapFailureV0[];
  blocker: {
    failureId: string;
    reason: string;
    reasonCode: string;
    resolutionHint: string | null;
    retryable: boolean;
  } | null;
  lastCompletedAt: string | null;
  lastResetAt: string | null;
  updatedAt: string | null;
}

export interface LocalWorkspaceBootstrapResultV0 extends LocalWorkspaceBootstrapStatusV0 {
  command: "workspace" | "resume" | "reset-local";
  created: {
    org: boolean;
    workspace: boolean;
    principal: boolean;
    adminBinding: boolean;
    stateRef: boolean;
  };
  activated: {
    workspace: boolean;
    adminBinding: boolean;
  };
  revoked: {
    adminBinding: boolean;
  };
  auditEventIds: string[];
}

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
    const resolvedFailure: BootstrapFailureV0 = {
      ...activeFailure,
      status: "resolved",
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

  const session = await stores.bootstrap.putSession(makeSessionRecord({
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

async function putBlockedBootstrapRecords(input: {
  bootstrap: BootstrapStore;
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

async function ensureBootstrapArtifactChain(input: {
  stores: ReturnType<typeof createStores>;
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

async function buildStatusFromState(
  stores: {
    bootstrap: BootstrapStore;
    identity: IdentityStore;
    governance: GovernanceStore;
    evidence: EvidenceGraphStore;
    runs: RunStore;
    dataDir?: string;
  },
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

async function buildStatusFromUnderlyingStores(
  stores: ReturnType<typeof createStores>,
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

function createStores(dataDir?: string): {
  identity: IdentityStore;
  audit: GovernanceEventStore;
  bootstrap: BootstrapStore;
  storage: StorageStore;
  governance: GovernanceStore;
  evidence: EvidenceGraphStore;
  runs: RunStore;
  dataDir?: string;
} {
  return {
    dataDir,
    identity: new IdentityStore({ dataDir }),
    audit: new GovernanceEventStore({ dataDir }),
    bootstrap: new BootstrapStore({ dataDir }),
    storage: new StorageStore({ dataDir }),
    governance: new GovernanceStore({ dataDir }),
    evidence: new EvidenceGraphStore({ dataDir }),
    runs: new RunStore({ dataDir }),
  };
}

function toWorkspaceRef(workspaceId: string): WorkspaceScopedRefV0 {
  return { workspaceId, kind: "workspace", id: workspaceId };
}

function toPrincipalRef(workspaceId: string, principalId: string): PrincipalRefV0 {
  return { workspaceId, kind: "user", principalId };
}

function toAdminBindingRef(workspaceId: string, principalRef: PrincipalRefV0): WorkspaceScopedRefV0 {
  return {
    workspaceId,
    kind: "membership_binding",
    id: adminBindingId(workspaceId, principalRef),
  };
}

function adminBindingId(workspaceId: string, principalRef: PrincipalRefV0): string {
  return `${workspaceId}:admin:${principalRef.kind}:${principalRef.principalId}`;
}

function metadataRecordId(workspaceId: string): string {
  return `${workspaceId}:local-bootstrap-state`;
}

function failureRecordId(workspaceId: string): string {
  return `${workspaceId}:bootstrap-blocker`;
}

function toPrincipalObjectRef(principalRef: PrincipalRefV0): WorkspaceScopedRefV0 {
  return {
    workspaceId: principalRef.workspaceId,
    kind: principalRef.kind,
    id: principalRef.principalId,
  };
}

function objectRef(
  workspaceRef: WorkspaceScopedRefV0,
  objectRefValue: WorkspaceScopedRefV0,
  objectType: string,
  actorRef: PrincipalRefV0,
  now: string,
  summary: string,
): BootstrapObjectRefV0 {
  return {
    schema: "pluto.bootstrap.object-ref",
    schemaVersion: 0,
    id: `${workspaceRef.workspaceId}:${objectRefValue.kind}:${objectRefValue.id}`,
    workspaceRef,
    objectRef: objectRefValue,
    objectType,
    status: "succeeded",
    actorRefs: [actorRef],
    summary,
    createdAt: now,
    updatedAt: now,
  };
}

function makeSessionRecord(input: {
  now: string;
  workspaceRef: WorkspaceScopedRefV0;
  principalRef: PrincipalRefV0;
  status: string;
  blockingReason: string | null;
  resolutionHint: string | null;
  finishedAt: string | null;
  createdObjectRefs: BootstrapObjectRefV0[];
}): BootstrapSessionV0 {
  return {
    schema: "pluto.bootstrap.session",
    schemaVersion: 0,
    id: SESSION_ID,
    workspaceRef: input.workspaceRef,
    actorRefs: [input.principalRef],
    status: input.status,
    createdAt: input.now,
    updatedAt: input.now,
    startedAt: input.now,
    finishedAt: input.finishedAt,
    blockingReason: input.blockingReason,
    resolutionHint: input.resolutionHint,
    stepIds: [...BOOTSTRAP_STEP_IDS],
    createdObjectRefs: input.createdObjectRefs,
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

function makeStepRecord(input: {
  now: string;
  workspaceRef: WorkspaceScopedRefV0;
  principalRef: PrincipalRefV0;
  stepId: string;
  title: string;
  status: string;
  createdObjectRefs: BootstrapObjectRefV0[];
  dependsOnStepIds: string[];
  blockingReason?: string | null;
  resolutionHint?: string | null;
  finishedAt?: string | null;
}): BootstrapStepV0 {
  return {
    schema: "pluto.bootstrap.step",
    schemaVersion: 0,
    id: input.stepId,
    sessionId: SESSION_ID,
    stableKey: input.stepId,
    title: input.title,
    workspaceRef: input.workspaceRef,
    actorRefs: [input.principalRef],
    status: input.status,
    createdAt: input.now,
    updatedAt: input.now,
    startedAt: input.now,
    finishedAt: input.finishedAt === undefined ? input.now : input.finishedAt,
    blockingReason: input.blockingReason ?? null,
    resolutionHint: input.resolutionHint ?? null,
    dependsOnStepIds: input.dependsOnStepIds,
    createdObjectRefs: input.createdObjectRefs,
  };
}

async function putStateRecord(storage: StorageStore, state: LocalWorkspaceBootstrapStateV0, now: string): Promise<void> {
  const metadata = {
    schema: state.schema,
    schemaVersion: state.schemaVersion,
    workspaceRef: state.workspaceRef,
    principalRef: state.principalRef,
    adminBindingRef: state.adminBindingRef,
    orgId: state.orgId,
    sessionId: state.sessionId,
    status: state.status,
    blockerReason: state.blockerReason,
    resolutionHint: state.resolutionHint,
    lastCompletedAt: state.lastCompletedAt,
    lastResetAt: state.lastResetAt,
    updatedAt: state.updatedAt,
  };
  const record: MetadataRecordV0 = {
    schemaVersion: 0,
    storageVersion: "local-v0",
    kind: "metadata",
    id: metadataRecordId(state.workspaceRef.workspaceId),
    workspaceId: state.workspaceRef.workspaceId,
    objectType: "workspace_bootstrap_state",
    status: "active",
    actorRefs: [{ actorId: state.principalRef.principalId, actorType: state.principalRef.kind }],
    createdAt: now,
    updatedAt: now,
    retentionClass: "durable",
    sensitivityClass: "internal",
    summary: `Local workspace bootstrap state for ${state.workspaceRef.workspaceId}`,
    metadata,
    checksum: checksumFor(metadata),
  };
  await storage.put("metadata", record);
}

async function appendStateLedgerEvent(
  storage: StorageStore,
  state: LocalWorkspaceBootstrapStateV0,
  principalRef: PrincipalRefV0,
  now: string,
  eventType: string,
  sourceCommand: string,
): Promise<void> {
  const subject = await storage.get("metadata", metadataRecordId(state.workspaceRef.workspaceId));
  if (subject === null) {
    return;
  }

  const ledgerEvent: EventLedgerEntryV0 = {
    schemaVersion: 0,
    storageVersion: "local-v0",
    kind: "event_ledger",
    id: `${state.workspaceRef.workspaceId}:${eventType}:${now}`,
    workspaceId: state.workspaceRef.workspaceId,
    objectType: subject.objectType,
    status: "active",
    actorRefs: [{ actorId: principalRef.principalId, actorType: principalRef.kind }],
    createdAt: now,
    updatedAt: now,
    retentionClass: "durable",
    sensitivityClass: "internal",
    summary: `Bootstrap state event ${eventType}`,
    eventType,
    subjectRef: toStorageRefV0(subject),
    occurredAt: now,
    detail: {
      sourceCommand,
      bootstrapStatus: state.status,
      blockerReason: state.blockerReason,
    },
    checksum: checksumFor({ eventType, workspaceId: state.workspaceRef.workspaceId, now }),
  };
  await appendLedgerEventV0({
    store: storage,
    event: ledgerEvent,
    idempotencyKey: `${eventType}:${state.workspaceRef.workspaceId}:${state.status}`,
    correlationId: `${sourceCommand}:${state.workspaceRef.workspaceId}`,
  });
}

function readStateFromMetadata(record: MetadataRecordV0 | null): LocalWorkspaceBootstrapStateV0 | null {
  const metadata = record?.metadata;
  if (!metadata || typeof metadata !== "object") {
    return null;
  }

  const value = metadata as Record<string, unknown>;
  if (value["schema"] !== "pluto.bootstrap.local-workspace-state" || value["schemaVersion"] !== 0) {
    return null;
  }

  const workspaceRef = value["workspaceRef"] as WorkspaceScopedRefV0 | undefined;
  const principalRef = value["principalRef"] as PrincipalRefV0 | undefined;
  const adminBindingRef = value["adminBindingRef"] as WorkspaceScopedRefV0 | undefined;
  if (!workspaceRef || !principalRef || !adminBindingRef) {
    return null;
  }

  return {
    schema: "pluto.bootstrap.local-workspace-state",
    schemaVersion: 0,
    workspaceRef,
    principalRef,
    adminBindingRef,
    orgId: String(value["orgId"] ?? DEFAULT_ORG_ID),
    sessionId: String(value["sessionId"] ?? SESSION_ID),
    status: parseStateStatus(value["status"]),
    blockerReason: asNullableString(value["blockerReason"]),
    resolutionHint: asNullableString(value["resolutionHint"]),
    lastCompletedAt: asNullableString(value["lastCompletedAt"]),
    lastResetAt: asNullableString(value["lastResetAt"]),
    updatedAt: String(value["updatedAt"] ?? record?.updatedAt ?? ""),
  };
}

function parseStateStatus(value: unknown): BootstrapStateStatusV0 {
  return value === "blocked" || value === "reset" || value === "completed" ? value : "ready";
}

function asNullableString(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function checksumFor(value: unknown): { algorithm: "sha256"; digest: string } {
  return {
    algorithm: "sha256",
    digest: createHash("sha256").update(JSON.stringify(value)).digest("hex"),
  };
}

function isSamePrincipal(left: PrincipalRefV0, right: PrincipalRefV0): boolean {
  return left.workspaceId === right.workspaceId
    && left.kind === right.kind
    && left.principalId === right.principalId;
}
