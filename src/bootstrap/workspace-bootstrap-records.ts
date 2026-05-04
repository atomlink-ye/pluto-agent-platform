import { createHash } from "node:crypto";

import type {
  PrincipalRefV0,
  WorkspaceScopedRefV0,
} from "../contracts/identity.js";
import type { EventLedgerEntryV0, MetadataRecordV0 } from "../contracts/storage.js";
import { toStorageRefV0 } from "../contracts/storage.js";
import { appendLedgerEventV0 } from "../storage/event-ledger.js";
import { StorageStore } from "../storage/storage-store.js";
import { GovernanceEventStore } from "../audit/governance-event-store.js";
import { BootstrapStore } from "./bootstrap-store.js";
import type {
  BootstrapChecklistV0,
  BootstrapFailureV0,
  BootstrapObjectRefV0,
  BootstrapSessionV0,
  BootstrapStepV0,
} from "./contracts.js";
import { IdentityStore } from "../identity/identity-store.js";
import { GovernanceStore } from "../governance/governance-store.js";
import { EvidenceGraphStore } from "../evidence/evidence-graph.js";
import { RunStore } from "../orchestrator/run-store.js";

export const DEFAULT_WORKSPACE_ID = "workspace-local-v0";
export const DEFAULT_ORG_ID = "org-local-v0";
export const DEFAULT_WORKSPACE_SLUG = "local-v0";
export const DEFAULT_WORKSPACE_DISPLAY_NAME = "Local Workspace";
export const DEFAULT_PRINCIPAL_ID = "user-local-admin";
export const DEFAULT_PRINCIPAL_DISPLAY_NAME = "Local Workspace Admin";
export const DEFAULT_SOURCE_COMMAND = "bootstrap.workspace";

export const SESSION_ID = "bootstrap-local-workspace-admin";
export const STEP_WORKSPACE_ID = "workspace-ref";
export const STEP_PRINCIPAL_ID = "principal-ref";
export const STEP_ADMIN_ID = "admin-binding";
export const STEP_DOCUMENT_ID = "bootstrap-document";
export const STEP_VERSION_ID = "bootstrap-version";
export const STEP_RUN_ID = "bootstrap-run";
export const STEP_ARTIFACT_ID = "bootstrap-artifact";
export const STEP_EVIDENCE_ID = "bootstrap-evidence-packet";
export const BOOTSTRAP_STEP_IDS = [
  STEP_WORKSPACE_ID,
  STEP_PRINCIPAL_ID,
  STEP_ADMIN_ID,
  STEP_DOCUMENT_ID,
  STEP_VERSION_ID,
  STEP_RUN_ID,
  STEP_ARTIFACT_ID,
  STEP_EVIDENCE_ID,
] as const;

export type BootstrapStateStatusV0 = "ready" | "completed" | "blocked" | "reset";

export interface LocalWorkspaceBootstrapStateV0 {
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

export interface LocalWorkspaceBootstrapStores {
  identity: IdentityStore;
  audit: GovernanceEventStore;
  bootstrap: BootstrapStore;
  storage: StorageStore;
  governance: GovernanceStore;
  evidence: EvidenceGraphStore;
  runs: RunStore;
  dataDir?: string;
}

export function createStores(dataDir?: string): LocalWorkspaceBootstrapStores {
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

export function toWorkspaceRef(workspaceId: string): WorkspaceScopedRefV0 {
  return { workspaceId, kind: "workspace", id: workspaceId };
}

export function toPrincipalRef(workspaceId: string, principalId: string): PrincipalRefV0 {
  return { workspaceId, kind: "user", principalId };
}

export function toAdminBindingRef(workspaceId: string, principalRef: PrincipalRefV0): WorkspaceScopedRefV0 {
  return {
    workspaceId,
    kind: "membership_binding",
    id: adminBindingId(workspaceId, principalRef),
  };
}

export function adminBindingId(workspaceId: string, principalRef: PrincipalRefV0): string {
  return `${workspaceId}:admin:${principalRef.kind}:${principalRef.principalId}`;
}

export function metadataRecordId(workspaceId: string): string {
  return `${workspaceId}:local-bootstrap-state`;
}

export function failureRecordId(workspaceId: string): string {
  return `${workspaceId}:bootstrap-blocker`;
}

export function toPrincipalObjectRef(principalRef: PrincipalRefV0): WorkspaceScopedRefV0 {
  return {
    workspaceId: principalRef.workspaceId,
    kind: principalRef.kind,
    id: principalRef.principalId,
  };
}

export function objectRef(
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

export function makeSessionRecord(input: {
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

export function makeStepRecord(input: {
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

export async function putStateRecord(
  storage: StorageStore,
  state: LocalWorkspaceBootstrapStateV0,
  now: string,
): Promise<void> {
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

export async function appendStateLedgerEvent(
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

export function readStateFromMetadata(record: MetadataRecordV0 | null): LocalWorkspaceBootstrapStateV0 | null {
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

export function parseStateStatus(value: unknown): BootstrapStateStatusV0 {
  return value === "blocked" || value === "reset" || value === "completed" ? value : "ready";
}

export function asNullableString(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

export function checksumFor(value: unknown): { algorithm: "sha256"; digest: string } {
  return {
    algorithm: "sha256",
    digest: createHash("sha256").update(JSON.stringify(value)).digest("hex"),
  };
}

export function isSamePrincipal(left: PrincipalRefV0, right: PrincipalRefV0): boolean {
  return left.workspaceId === right.workspaceId
    && left.kind === right.kind
    && left.principalId === right.principalId;
}
