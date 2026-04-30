import type {
  MembershipBindingV0,
  PermissionLikeV0,
  PrincipalRefV0,
  WorkspaceRecordV0,
  WorkspaceScopedRefV0,
} from "../contracts/identity.js";
import type {
  OutboundTargetRecordV0,
  OutboundWriteRecordV0,
  PayloadEnvelopeRefV0,
  ProviderResourceRefV0,
} from "../contracts/integration.js";
import { toIntegrationRecordRefV0 } from "../contracts/integration.js";
import type { ScopedToolPermitV0 } from "../contracts/security.js";
import type { StorageStatusV0 } from "../contracts/storage.js";
import type { ApiTokenRecordV0 } from "../contracts/identity.js";
import type { RuntimeCapabilityDescriptorV0, RuntimeRequirementsV0 } from "../contracts/types.js";
import type { GovernanceEventRecordV0 } from "../audit/governance-events.js";
import { GovernanceEventStore } from "../audit/governance-event-store.js";
import { composeGovernedLocalActionBoundaryV0, type GovernedLocalActionAuditEventV0 } from "../identity/security-storage-boundary.js";
import { IntegrationStore } from "./integration-store.js";
import { SecurityStore } from "../security/security-store.js";
import {
  buildLocalPayloadDigestV0,
  buildReplayProtectionKeyV0,
  createLocalSignatureEnvelopeV0,
  type LocalSigningSecretV0,
} from "./local-signing.js";

export const OUTBOUND_BLOCKER_REASONS_V0 = [
  "approval_missing",
  "budget_blocked",
  "connector_local_required",
  "identity_denied",
  "permit_expired",
  "permit_revoked",
  "policy_blocked",
  "policy_required",
  "runtime_capability_required",
  "sandbox_required",
  "target_denied",
  "trust_boundary_required",
  "workspace_mismatch",
] as const;

export type OutboundBlockerReasonV0 = typeof OUTBOUND_BLOCKER_REASONS_V0[number] | (string & {});

export interface OutboundPolicyGateV0 {
  allowed: boolean;
  reasonCode?: string | null;
  policyRef?: string | null;
  summary: string;
}

export interface OutboundBudgetGateV0 {
  allowed: boolean;
  reasonCode?: string | null;
  budgetRef?: string | null;
  summary: string;
}

export interface GovernedIntegrationActionContextV0 {
  now: string;
  workspaceId: string;
  actorRef: PrincipalRefV0;
  principalRef: PrincipalRefV0;
  resourceRef: WorkspaceScopedRefV0;
  action: PermissionLikeV0;
  workspace: WorkspaceRecordV0 | null;
  bindings: MembershipBindingV0[];
  token?: ApiTokenRecordV0 | null;
  principalLifecycle?: {
    status?: string;
    suspendedAt?: string | null;
    revokedAt?: string | null;
  } | null;
  permit: ScopedToolPermitV0 | null;
  permitRef?: WorkspaceScopedRefV0 | null;
  approvalRefs?: string[];
  approvalObjectRefs?: WorkspaceScopedRefV0[];
  runtimeCapability: RuntimeCapabilityDescriptorV0 | null;
  runtimeRequirements?: RuntimeRequirementsV0;
  storageStatus: StorageStatusV0 | null;
  storageEventStatus?: unknown;
  requestedSensitivity: string;
  sandboxPosture: string;
  trustBoundary: string;
  correlationId?: string;
  auditEventId?: string;
}

export interface LocalOutboundConnectorV0 {
  kind: "fake-local" | "local";
  executeWrite(input: {
    record: OutboundWriteRecordV0;
    outboundTarget: OutboundTargetRecordV0;
    payloadBody: string;
    payloadRef: PayloadEnvelopeRefV0;
  }): Promise<{
    providerWriteRef: string;
    responseSummary: string;
    completedAt?: string;
    metadata?: Record<string, unknown>;
  }>;
}

export interface PrepareOutboundWriteInputV0 {
  store: IntegrationStore;
  securityStore?: SecurityStore;
  governanceEvents?: GovernanceEventStore;
  connector: LocalOutboundConnectorV0;
  governance: GovernedIntegrationActionContextV0;
  outboundTarget: OutboundTargetRecordV0;
  writeId: string;
  sourceRecordRefs: string[];
  payloadBody: string;
  payloadContentType: string;
  payloadRefKind?: string;
  operation: string;
  idempotencyKey: string;
  policy: OutboundPolicyGateV0;
  budget: OutboundBudgetGateV0;
  signingSecret: LocalSigningSecretV0;
}

export interface PrepareOutboundWriteResultV0 {
  duplicate: boolean;
  record: OutboundWriteRecordV0;
  audit: GovernedLocalActionAuditEventV0;
  blockerReasons: string[];
}

export interface ExecuteOutboundWriteInputV0 {
  store: IntegrationStore;
  connector: LocalOutboundConnectorV0;
  writeId?: string;
  idempotencyKey?: string;
  payloadBody: string;
  now: string;
}

export interface ExecuteOutboundWriteResultV0 {
  duplicate: boolean;
  executed: boolean;
  record: OutboundWriteRecordV0;
}

export async function prepareOutboundWrite(input: PrepareOutboundWriteInputV0): Promise<PrepareOutboundWriteResultV0> {
  const existing = await findOutboundWriteByIdempotencyKeyV0(input.store, input.idempotencyKey, input.governance.workspaceId);
  const boundary = composeGovernedLocalActionBoundaryV0({
    now: input.governance.now,
    workspaceId: input.governance.workspaceId,
    actorRef: input.governance.actorRef,
    principalRef: input.governance.principalRef,
    resourceRef: input.governance.resourceRef,
    action: input.governance.action,
    workspace: input.governance.workspace,
    bindings: input.governance.bindings,
    token: input.governance.token,
    principalLifecycle: input.governance.principalLifecycle,
    actionFamily: "http",
    actionName: input.operation,
    httpMethod: "POST",
    target: input.outboundTarget.targetRef.externalId,
    requestedSensitivity: input.governance.requestedSensitivity,
    sandboxPosture: input.governance.sandboxPosture,
    trustBoundary: input.governance.trustBoundary,
    runtimeCapability: input.governance.runtimeCapability,
    runtimeRequirements: input.governance.runtimeRequirements,
    permit: input.governance.permit,
    permitRef: input.governance.permitRef,
    approvalRefs: input.governance.approvalRefs,
    approvalObjectRefs: input.governance.approvalObjectRefs,
    storageStatus: input.governance.storageStatus,
    storageEventStatus: input.governance.storageEventStatus,
    correlationId: input.governance.correlationId,
    auditEventId: input.governance.auditEventId,
  });
  const blockerReasons = resolveOutboundBlockerReasonsV0(
    boundary.allowed,
    boundary.reasonCodes,
    input.policy,
    input.budget,
    input.connector,
  );

  if (input.securityStore) {
    await input.securityStore.appendAuditEvent(boundary.audit);
  }

  if (existing !== null) {
    await appendGovernanceDecisionEventV0(
      input.governanceEvents,
      input.governance.now,
      input.governance.actorRef.principalId,
      existing.id,
      input.governance.workspaceId,
      "duplicate",
      blockerReasons,
      input.governance.correlationId ?? input.idempotencyKey,
    );

    return {
      duplicate: true,
      record: existing,
      audit: boundary.audit,
      blockerReasons: readBlockerReasonsV0(existing),
    };
  }

  const signature = createLocalSignatureEnvelopeV0({
    payload: {
      workspaceId: input.governance.workspaceId,
      providerKind: input.outboundTarget.providerKind,
      purpose: `outbound-write:${input.operation}`,
      contentType: input.payloadContentType,
      body: input.payloadBody,
    },
    secret: input.signingSecret,
    signedAt: input.governance.now,
  });
  const payloadRef = toPayloadEnvelopeRefV0(input.outboundTarget.providerKind, input.payloadContentType, signature.digestRef, input.operation);
  const record: OutboundWriteRecordV0 = {
    schema: "pluto.integration.outbound-write",
    schemaVersion: 0,
    kind: "outbound_write",
    id: input.writeId,
    workspaceId: input.governance.workspaceId,
    providerKind: input.outboundTarget.providerKind,
    status: blockerReasons.length === 0 ? "prepared" : "blocked",
    summary: blockerReasons.length === 0
      ? `Prepared ${input.operation} for ${input.outboundTarget.targetRef.summary}`
      : `Blocked ${input.operation} for ${input.outboundTarget.targetRef.summary}`,
    createdAt: input.governance.now,
    updatedAt: input.governance.now,
    outboundTargetRef: toIntegrationRecordRefV0(input.outboundTarget),
    sourceRecordRefs: [...input.sourceRecordRefs],
    payloadRef,
    operation: input.operation,
    idempotencyKey: input.idempotencyKey,
    providerWriteRef: null,
    attemptedAt: input.governance.now,
    completedAt: null,
    decision: {
      allowed: blockerReasons.length === 0,
      blockerReasons,
      policyRef: input.policy.policyRef ?? null,
      budgetRef: input.budget.budgetRef ?? null,
      permitId: boundary.permitDecision.permitId,
      approvalRefs: boundary.permitDecision.approvalRefs,
      connectorKind: input.connector.kind,
    },
    signing: {
      algorithm: signature.algorithm,
      digest: signature.digest,
      keyRef: signature.keyRef,
      keyFingerprint: signature.keyFingerprint,
      signedAt: signature.signedAt,
    },
    replayProtectionKey: buildReplayProtectionKeyV0([
      input.governance.workspaceId,
      input.outboundTarget.id,
      input.idempotencyKey,
      signature.digest,
    ]),
    connectorKind: input.connector.kind,
    responseSummary: null,
    execution: null,
  };

  await input.store.put("outbound_write", record);
  await appendGovernanceDecisionEventV0(
    input.governanceEvents,
    input.governance.now,
    input.governance.actorRef.principalId,
    record.id,
    input.governance.workspaceId,
    blockerReasons.length === 0 ? "prepared" : "blocked",
    blockerReasons,
    input.governance.correlationId ?? input.idempotencyKey,
  );

  return {
    duplicate: false,
    record,
    audit: boundary.audit,
    blockerReasons,
  };
}

export async function executeOutboundWrite(input: ExecuteOutboundWriteInputV0): Promise<ExecuteOutboundWriteResultV0> {
  const record = input.writeId
    ? await input.store.get("outbound_write", input.writeId)
    : input.idempotencyKey
      ? await findOutboundWriteByIdempotencyKeyV0(input.store, input.idempotencyKey)
      : null;
  if (record === null) {
    throw new Error("outbound_write_not_found");
  }

  if (record.completedAt !== null || record.providerWriteRef !== null) {
    return { duplicate: true, executed: false, record };
  }

  if (record.status === "blocked") {
    return { duplicate: false, executed: false, record };
  }

  if (input.connector.kind !== "fake-local" && input.connector.kind !== "local") {
    throw new Error("connector_local_required");
  }

  const outboundTarget = await input.store.get("outbound_target", record.outboundTargetRef.recordId);
  if (outboundTarget === null) {
    throw new Error("outbound_target_not_found");
  }

  const result = await input.connector.executeWrite({
    record,
    outboundTarget,
    payloadBody: assertOutboundPayloadBodyMatchesRecordV0(record, input.payloadBody),
    payloadRef: record.payloadRef,
  });

  const updated: OutboundWriteRecordV0 = {
    ...record,
    status: "completed",
    updatedAt: input.now,
    providerWriteRef: result.providerWriteRef,
    completedAt: result.completedAt ?? input.now,
    summary: result.responseSummary,
    responseSummary: result.responseSummary,
    execution: {
      completedAt: result.completedAt ?? input.now,
      metadata: result.metadata ?? {},
    },
  };
  await input.store.put("outbound_write", updated);

  return { duplicate: false, executed: true, record: updated };
}

export async function findOutboundWriteByIdempotencyKeyV0(
  store: IntegrationStore,
  idempotencyKey: string,
  workspaceId?: string,
): Promise<OutboundWriteRecordV0 | null> {
  const records = await store.list("outbound_write");
  return records.find((record) =>
    record.idempotencyKey === idempotencyKey && (workspaceId === undefined || record.workspaceId === workspaceId)
  ) ?? null;
}

function resolveOutboundBlockerReasonsV0(
  boundaryAllowed: boolean,
  boundaryReasonCodes: readonly string[],
  policy: OutboundPolicyGateV0,
  budget: OutboundBudgetGateV0,
  connector: LocalOutboundConnectorV0,
): string[] {
  const reasons = new Set<string>();
  if (!boundaryAllowed) {
    for (const reason of boundaryReasonCodes) {
      if (reason.length > 0) {
        reasons.add(reason);
      }
    }
  }

  if (!policy.allowed) {
    reasons.add(policy.reasonCode ?? "policy_blocked");
  }
  if (!budget.allowed) {
    reasons.add(budget.reasonCode ?? "budget_blocked");
  }
  if (connector.kind !== "fake-local" && connector.kind !== "local") {
    reasons.add("connector_local_required");
  }

  return [...reasons].sort((left, right) => left.localeCompare(right));
}

function toPayloadEnvelopeRefV0(
  providerKind: string,
  contentType: string,
  digestRef: string,
  operation: string,
): PayloadEnvelopeRefV0 {
  return {
    providerKind,
    refKind: "signed-digest",
    ref: digestRef,
    contentType,
    summary: `${operation} payload ${digestRef}`,
  };
}

async function appendGovernanceDecisionEventV0(
  governanceEvents: GovernanceEventStore | undefined,
  createdAt: string,
  actorId: string,
  recordId: string,
  workspaceId: string,
  outcome: string,
  blockerReasons: readonly string[],
  correlationRef: string,
): Promise<GovernanceEventRecordV0 | null> {
  if (!governanceEvents) {
    return null;
  }

  return governanceEvents.append({
    schema: "pluto.audit.governance-event",
    schemaVersion: 0,
    eventId: `${createdAt}:integration_decision:${recordId}`,
    eventType: "integration_decision",
    actor: { principalId: actorId },
    target: {
      kind: "outbound_write",
      recordId,
      workspaceId,
      targetId: recordId,
    },
    status: {
      before: null,
      after: outcome,
      summary: `Outbound write ${recordId} ${outcome}`,
    },
    evidenceRefs: [...blockerReasons],
    reason: blockerReasons[0] ?? null,
    createdAt,
    source: {
      command: "integration.prepareOutboundWrite",
      ref: correlationRef,
    },
  });
}

function readBlockerReasonsV0(record: OutboundWriteRecordV0): string[] {
  return [...record.decision.blockerReasons];
}

export function toOutboundTargetResourceRefV0(target: OutboundTargetRecordV0): ProviderResourceRefV0 {
  return {
    providerKind: target.targetRef.providerKind,
    resourceType: target.targetRef.resourceType,
    externalId: target.targetRef.externalId,
    summary: target.targetRef.summary,
  };
}

function assertOutboundPayloadBodyMatchesRecordV0(record: OutboundWriteRecordV0, payloadBody: string): string {
  const digest = buildLocalPayloadDigestV0({
    workspaceId: record.workspaceId,
    providerKind: record.providerKind,
    purpose: `outbound-write:${record.operation}`,
    contentType: record.payloadRef.contentType,
    body: payloadBody,
  });

  if (digest !== record.signing.digest) {
    throw new Error("outbound_payload_mismatch");
  }

  return payloadBody;
}
