import { describe, expect, it } from "vitest";

import { evaluateScopedToolPermitV0 } from "@/security/tool-gateway.js";
import type { AuthorizationDecisionV0 } from "@/identity/authorization.js";
import type { RuntimeCapabilityDescriptorV0 } from "@/contracts/types.js";
import type { ScopedToolPermitV0 } from "@/contracts/security.js";

const authorization: AuthorizationDecisionV0 = {
  schemaVersion: 0,
  allowed: true,
  reasonCode: "allowed",
  evaluatedAt: "2026-04-30T00:00:00.000Z",
  workspaceId: "ws-1",
  action: "governance.publish",
  principal: { workspaceId: "ws-1", kind: "service_account", principalId: "sa_1" },
  resource: { workspaceId: "ws-1", kind: "publish_package", id: "pkg_1" },
  effectivePermissions: ["governance.publish"],
  matchedBindingIds: ["bind_1"],
  tokenId: "tok_1",
};

const runtime: RuntimeCapabilityDescriptorV0 = {
  schemaVersion: 0,
  runtimeId: "runtime-1",
  adapterId: "adapter-1",
  provider: "opencode",
  tools: { web_fetch: true },
  locality: "remote",
  posture: "workspace_write",
};

const permit: ScopedToolPermitV0 = {
  schemaVersion: 0,
  kind: "scoped_tool_permit",
  workspaceId: "ws-1",
  permitId: "permit-http-1",
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
  approvalRefs: ["approval-export-1"],
};

describe("outbound approval gate", () => {
  it("requires an approval reference for restricted outbound writes", () => {
    const denied = evaluateScopedToolPermitV0({
      now: "2026-04-30T00:00:00.000Z",
      workspaceId: "ws-1",
      actionFamily: "http",
      action: "request",
      httpMethod: "POST",
      target: "https://api.example.test/v1/exports",
      requestedSensitivity: "restricted",
      sandboxPosture: "local_v0",
      trustBoundary: "operator_approved",
      authorization,
      runtimeCapability: runtime,
      permit,
      approvalRefs: [],
    });

    expect(denied.allowed).toBe(false);
    expect(denied.reasonCode).toBe("approval_missing");
  });

  it("allows restricted outbound writes once the approval ref matches the permit", () => {
    const allowed = evaluateScopedToolPermitV0({
      now: "2026-04-30T00:00:00.000Z",
      workspaceId: "ws-1",
      actionFamily: "http",
      action: "request",
      httpMethod: "POST",
      target: "https://api.example.test/v1/exports",
      requestedSensitivity: "restricted",
      sandboxPosture: "local_v0",
      trustBoundary: "operator_approved",
      authorization,
      runtimeCapability: runtime,
      permit,
      approvalRefs: ["approval-export-1"],
    });

    expect(allowed.allowed).toBe(true);
    expect(allowed.reasonCode).toBe("operator_approved");
  });

  it("requires approval refs for export-style outbound writes even below restricted sensitivity", () => {
    const denied = evaluateScopedToolPermitV0({
      now: "2026-04-30T00:00:00.000Z",
      workspaceId: "ws-1",
      actionFamily: "http",
      action: "export_result",
      httpMethod: "POST",
      target: "https://api.example.test/v1/exports/download",
      requestedSensitivity: "internal",
      sandboxPosture: "local_v0",
      trustBoundary: "operator_approved",
      authorization,
      runtimeCapability: runtime,
      permit,
      approvalRefs: [],
    });

    expect(denied.allowed).toBe(false);
    expect(denied.reasonCode).toBe("approval_missing");
  });
});
