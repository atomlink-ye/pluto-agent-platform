import { describe, expect, it } from "vitest";

import type {
  MembershipBindingV0,
  PrincipalRefV0,
  WorkspaceRecordV0,
  WorkspaceScopedRefV0,
} from "@/contracts/identity.js";
import type { ScopedToolPermitV0 } from "@/contracts/security.js";
import type { MetadataRecordV0 } from "@/contracts/storage.js";
import type { RuntimeCapabilityDescriptorV0, RuntimeRequirementsV0 } from "@/contracts/types.js";
import { toStorageStatusV0 } from "@/contracts/storage.js";
import { composeGovernedLocalActionBoundaryV0 } from "@/identity/security-storage-boundary.js";

const workspaceId = "ws_local_alpha";
const actorRef: PrincipalRefV0 = {
  workspaceId,
  kind: "user",
  principalId: "user_01",
};
const principalRef: PrincipalRefV0 = {
  workspaceId,
  kind: "service_account",
  principalId: "sa_01",
};
const resourceRef: WorkspaceScopedRefV0 = {
  workspaceId,
  kind: "publish_package",
  id: "pkg_01",
};
const permitRef: WorkspaceScopedRefV0 = {
  workspaceId,
  kind: "permit",
  id: "permit_http_01",
};
const approvalRef: WorkspaceScopedRefV0 = {
  workspaceId,
  kind: "approval",
  id: "approval_export_01",
};
const workspace: WorkspaceRecordV0 = {
  schemaVersion: 0,
  kind: "workspace",
  id: workspaceId,
  orgId: "org_01",
  slug: "core-platform",
  displayName: "Core Platform",
  ownerRef: actorRef,
  createdAt: "2026-04-30T00:00:00.000Z",
  updatedAt: "2026-04-30T00:00:01.000Z",
  status: "active",
};
const binding: MembershipBindingV0 = {
  schemaVersion: 0,
  kind: "membership_binding",
  id: "bind_01",
  orgId: "org_01",
  workspaceId,
  createdAt: "2026-04-30T00:00:00.000Z",
  updatedAt: "2026-04-30T00:00:01.000Z",
  status: "active",
  principal: principalRef,
  role: "publisher",
  permissions: ["governance.publish"],
};
const permit: ScopedToolPermitV0 = {
  schemaVersion: 0,
  kind: "scoped_tool_permit",
  workspaceId,
  permitId: "permit_http_01",
  actionFamily: "http",
  targetSummary: {
    allow: ["https://api.example.test/v1/exports*"],
    deny: [],
  },
  sensitivityCeiling: "restricted",
  sandboxPosture: "local_v0",
  trustBoundary: "operator_approved",
  grantedAt: "2026-04-30T00:00:00.000Z",
  expiresAt: null,
  approvalRefs: [approvalRef.id],
};
const runtimeCapability: RuntimeCapabilityDescriptorV0 = {
  schemaVersion: 0,
  runtimeId: "runtime_local_v0",
  adapterId: "adapter_fake",
  provider: "opencode",
  tools: { web_fetch: true },
  files: { read: true, write: true, workspaceRootOnly: true },
  locality: "local",
  posture: "workspace_write",
};
const runtimeRequirements: RuntimeRequirementsV0 = {
  tools: { web_fetch: true },
  files: { write: true },
};
const metadataRecord: MetadataRecordV0 = {
  schemaVersion: 0,
  storageVersion: "local-v0",
  kind: "metadata",
  id: "meta_01",
  workspaceId,
  objectType: "publish_package",
  status: "active",
  actorRefs: [{ actorId: actorRef.principalId, actorType: actorRef.kind }],
  createdAt: "2026-04-30T00:00:00.000Z",
  updatedAt: "2026-04-30T00:00:02.000Z",
  retentionClass: "governed_record",
  sensitivityClass: "restricted",
  summary: "Publish package metadata",
  metadata: { publishPackageId: resourceRef.id },
  checksum: { algorithm: "sha256", digest: "meta-checksum" },
};

describe("identity/security/storage boundary", () => {
  it("composes workspace scope, authorization, permit, storage readiness, and audit refs deterministically", () => {
    const boundary = composeGovernedLocalActionBoundaryV0({
      now: "2026-04-30T00:10:00.000Z",
      workspaceId,
      actorRef,
      principalRef,
      resourceRef,
      action: "governance.publish",
      workspace,
      bindings: [binding],
      actionFamily: "http",
      actionName: "export_result",
      httpMethod: "POST",
      target: "https://api.example.test/v1/exports/pkg_01",
      requestedSensitivity: "restricted",
      sandboxPosture: "local_v0",
      trustBoundary: "operator_approved",
      runtimeCapability,
      runtimeRequirements,
      permit,
      permitRef,
      approvalRefs: [approvalRef.id],
      approvalObjectRefs: [approvalRef],
      storageStatus: toStorageStatusV0(metadataRecord),
      storageEventStatus: "done",
      correlationId: "corr_pkg_01",
      auditEventId: "audit_pkg_01",
    });

    expect(boundary.allowed).toBe(true);
    expect(boundary.supported).toBe(true);
    expect(boundary.workspaceScoped).toBe(true);
    expect(boundary.reasonCode).toBe("operator_approved");
    expect(boundary.authorization.reasonCode).toBe("allowed");
    expect(boundary.permitDecision.reasonCode).toBe("operator_approved");
    expect(boundary.runtime).toEqual({
      supported: true,
      matched: true,
      reasonCode: null,
      mismatches: [],
    });
    expect(boundary.storage.ready).toBe(true);
    expect(boundary.storage.eventStatus).toBe("succeeded");
    expect(boundary.storage.objectRef).toEqual({
      workspaceId,
      kind: "metadata",
      id: "meta_01",
    });
    expect(boundary.audit.approvalRefs).toEqual([approvalRef.id]);
    expect(boundary.audit.reasonCodes).toContain("operator_approved");
    expect(boundary.audit.correlationId).toBe("corr_pkg_01");
    expect(boundary.audit.details).toMatchObject({
      permitRef,
      storageObjectRef: boundary.storage.objectRef,
      unsupportedSurface: null,
    });
  });

  it("fails closed when runtime details or object refs required by the boundary are absent", () => {
    const boundary = composeGovernedLocalActionBoundaryV0({
      now: "2026-04-30T00:10:00.000Z",
      workspaceId,
      actorRef,
      principalRef,
      resourceRef,
      action: "governance.publish",
      workspace,
      bindings: [binding],
      actionFamily: "http",
      actionName: "export_result",
      httpMethod: "POST",
      target: "https://api.example.test/v1/exports/pkg_01",
      requestedSensitivity: "restricted",
      sandboxPosture: "local_v0",
      trustBoundary: "operator_approved",
      runtimeCapability: null,
      runtimeRequirements,
      permit,
      approvalRefs: [approvalRef.id],
      approvalObjectRefs: [approvalRef],
      storageStatus: toStorageStatusV0(metadataRecord),
      storageEventStatus: "done",
    });

    expect(boundary.allowed).toBe(false);
    expect(boundary.supported).toBe(false);
    expect(boundary.reasonCodes).toContain("runtime_capability_required");
    expect(boundary.reasonCodes).toContain("permit_object_ref_required");
    expect(boundary.audit.reasonCodes).toContain("runtime_capability_required");
    expect(boundary.audit.reasonCodes).toContain("permit_object_ref_required");
  });
});
