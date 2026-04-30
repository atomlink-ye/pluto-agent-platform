import { describe, expect, it } from "vitest";

import type {
  MembershipBindingV0,
  PrincipalRefV0,
  WorkspaceRecordV0,
  WorkspaceScopedRefV0,
} from "@/contracts/identity.js";
import { LOCAL_V0_UNSUPPORTED_SURFACES_V0, composeGovernedLocalActionBoundaryV0 } from "@/identity/security-storage-boundary.js";

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
  role: "admin",
  permissions: ["workspace.write"],
};
const resourceRef: WorkspaceScopedRefV0 = {
  workspaceId,
  kind: "document",
  id: "doc_01",
};

describe("local-v0 boundary fence", () => {
  it("declares the unsupported enterprise/integration surfaces explicitly", () => {
    expect(LOCAL_V0_UNSUPPORTED_SURFACES_V0).toEqual([
      "real_signing",
      "sso",
      "secret_manager",
      "multi_tenant_infrastructure",
      "provider_storage_integration",
      "enterprise_compliance",
    ]);
  });

  it("blocks local-v0 requests that would imply real signing, SSO, secret manager, multi-tenant, provider storage, or enterprise compliance", () => {
    for (const requestedSurface of LOCAL_V0_UNSUPPORTED_SURFACES_V0) {
      const boundary = composeGovernedLocalActionBoundaryV0({
        now: "2026-04-30T00:10:00.000Z",
        workspaceId,
        actorRef,
        principalRef,
        resourceRef,
        action: "workspace.write",
        workspace,
        bindings: [binding],
        actionFamily: "shell",
        actionName: `probe_${requestedSurface}`,
        target: `${requestedSurface}://requested`,
        requestedSensitivity: "internal",
        sandboxPosture: "local_v0",
        trustBoundary: "local_workspace",
        runtimeCapability: null,
        storageStatus: null,
        permit: null,
        requestedSurface,
      });

      expect(boundary.supported).toBe(false);
      expect(boundary.allowed).toBe(false);
      expect(boundary.unsupportedSurface).toBe(requestedSurface);
      expect(boundary.reasonCodes).toContain(`local_v0_only:${requestedSurface}`);
      expect(boundary.audit.reasonCodes).toContain(`local_v0_only:${requestedSurface}`);
    }
  });
});
