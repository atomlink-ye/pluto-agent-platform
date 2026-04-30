import type {
  MembershipBindingV0,
  PrincipalRefV0,
  WorkspaceRecordV0,
  WorkspaceScopedRefV0,
} from "@/contracts/identity.js";
import type { OutboundTargetRecordV0, WebhookSubscriptionRecordV0 } from "@/contracts/integration.js";
import type { ScopedToolPermitV0, SecretRefV0 } from "@/contracts/security.js";
import type { MetadataRecordV0 } from "@/contracts/storage.js";
import type { RuntimeCapabilityDescriptorV0, RuntimeRequirementsV0 } from "@/contracts/types.js";
import { toStorageStatusV0 } from "@/contracts/storage.js";
import type { GovernedIntegrationActionContextV0, LocalOutboundConnectorV0 } from "@/integration/outbound-writes.js";

export const workspaceId = "ws-r6";
export const actorRef: PrincipalRefV0 = {
  workspaceId,
  kind: "user",
  principalId: "user-r6",
};
export const principalRef: PrincipalRefV0 = {
  workspaceId,
  kind: "service_account",
  principalId: "sa-r6",
};
export const workspace: WorkspaceRecordV0 = {
  schemaVersion: 0,
  kind: "workspace",
  id: workspaceId,
  orgId: "org-r6",
  slug: "slice-r6",
  displayName: "Slice R6",
  ownerRef: actorRef,
  createdAt: "2026-04-30T00:00:00.000Z",
  updatedAt: "2026-04-30T00:00:01.000Z",
  status: "active",
};
export const binding: MembershipBindingV0 = {
  schemaVersion: 0,
  kind: "membership_binding",
  id: "binding-r6",
  orgId: "org-r6",
  workspaceId,
  createdAt: "2026-04-30T00:00:00.000Z",
  updatedAt: "2026-04-30T00:00:01.000Z",
  status: "active",
  principal: principalRef,
  role: "publisher",
  permissions: ["governance.publish"],
};
export const permitRef: WorkspaceScopedRefV0 = {
  workspaceId,
  kind: "permit",
  id: "permit-r6",
};
export const approvalObjectRef: WorkspaceScopedRefV0 = {
  workspaceId,
  kind: "approval",
  id: "approval-r6",
};
export const permit: ScopedToolPermitV0 = {
  schemaVersion: 0,
  kind: "scoped_tool_permit",
  workspaceId,
  permitId: permitRef.id,
  actionFamily: "http",
  targetSummary: {
    allow: ["https://hooks.example.test/*", "https://api.example.test/*"],
    deny: [],
  },
  sensitivityCeiling: "restricted",
  sandboxPosture: "local_v0",
  trustBoundary: "operator_approved",
  grantedAt: "2026-04-30T00:00:00.000Z",
  expiresAt: null,
  approvalRefs: [approvalObjectRef.id],
};
export const runtimeCapability: RuntimeCapabilityDescriptorV0 = {
  schemaVersion: 0,
  runtimeId: "runtime-r6",
  adapterId: "adapter-r6",
  provider: "opencode",
  tools: { web_fetch: true },
  files: { read: true, write: true, workspaceRootOnly: true },
  locality: "local",
  posture: "workspace_write",
};
export const runtimeRequirements: RuntimeRequirementsV0 = {
  tools: { web_fetch: true },
  files: { write: true },
};
export const metadataRecord: MetadataRecordV0 = {
  schemaVersion: 0,
  storageVersion: "local-v0",
  kind: "metadata",
  id: "metadata-r6",
  workspaceId,
  objectType: "publish_package",
  status: "active",
  actorRefs: [{ actorId: actorRef.principalId, actorType: actorRef.kind }],
  createdAt: "2026-04-30T00:00:00.000Z",
  updatedAt: "2026-04-30T00:00:02.000Z",
  retentionClass: "governed_record",
  sensitivityClass: "restricted",
  summary: "R6 metadata",
  metadata: { key: "value" },
  checksum: { algorithm: "sha256", digest: "checksum-r6" },
};
export const signingSecret: { ref: Pick<SecretRefV0, "workspaceId" | "name" | "ref" | "displayLabel">; keyMaterial: string } = {
  ref: {
    workspaceId,
    name: "webhook-signing",
    ref: "secret://local/webhook-signing",
    displayLabel: "Webhook Signing",
  },
  keyMaterial: "local-signing-secret-r6",
};

export function createGovernanceContext(now: string, overrides: Partial<GovernedIntegrationActionContextV0> = {}): GovernedIntegrationActionContextV0 {
  const base: GovernedIntegrationActionContextV0 = {
    now,
    workspaceId,
    actorRef,
    principalRef,
    resourceRef: {
      workspaceId,
      kind: "publish_package",
      id: "pkg-r6",
    },
    action: "governance.publish",
    workspace,
    bindings: [binding],
    permit,
    permitRef,
    approvalRefs: [approvalObjectRef.id],
    approvalObjectRefs: [approvalObjectRef],
    runtimeCapability,
    runtimeRequirements,
    storageStatus: toStorageStatusV0(metadataRecord),
    storageEventStatus: "done",
    requestedSensitivity: "restricted",
    sandboxPosture: "local_v0",
    trustBoundary: "operator_approved",
    correlationId: `corr:${now}`,
    auditEventId: `audit:${now}`,
  };

  return {
    ...base,
    ...overrides,
  } as GovernedIntegrationActionContextV0;
}

export function createOutboundTarget(now: string): OutboundTargetRecordV0 {
  return {
    schema: "pluto.integration.outbound-target",
    schemaVersion: 0,
    kind: "outbound_target",
    id: "outbound-target-r6",
    workspaceId,
    providerKind: "fake-local",
    status: "active",
    summary: "Export target",
    createdAt: now,
    updatedAt: now,
    targetRef: {
      providerKind: "fake-local",
      resourceType: "export_endpoint",
      externalId: "https://api.example.test/v1/exports",
      summary: "Export API",
    },
    governanceRefs: [approvalObjectRef.id],
    deliveryMode: "push",
    readinessRef: null,
  };
}

export function createWebhookSubscription(now: string, status = "active", verifiedAt: string | null = now): WebhookSubscriptionRecordV0 {
  return {
    schema: "pluto.integration.webhook-subscription",
    schemaVersion: 0,
    kind: "webhook_subscription",
    id: "webhook-subscription-r6",
    workspaceId,
    providerKind: "fake-local",
    status,
    summary: "Release webhook",
    createdAt: now,
    updatedAt: now,
    topic: "release.published",
    endpointRef: "https://hooks.example.test/inbound/release",
    deliveryPolicyRef: "policy://webhook/default",
    providerSubscriptionRef: null,
    verifiedAt,
  };
}

export function createConnector(counter: { calls: number; payloadBodies?: string[] }): LocalOutboundConnectorV0 {
  return {
    kind: "fake-local",
    async executeWrite({ record, payloadBody }) {
      counter.calls += 1;
      counter.payloadBodies?.push(payloadBody);
      return {
        providerWriteRef: `fake-write:${record.id}:${counter.calls}`,
        responseSummary: `delivered ${record.id}`,
      };
    },
  };
}
