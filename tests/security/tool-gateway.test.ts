import { describe, expect, it } from "vitest";

import type { AuthorizationDecisionV0 } from "@/identity/authorization.js";
import type { RuntimeCapabilityDescriptorV0 } from "@/contracts/types.js";
import type { ScopedToolPermitV0 } from "@/contracts/security.js";
import { evaluateScopedToolPermitV0 } from "@/security/tool-gateway.js";

const authorization: AuthorizationDecisionV0 = {
  schemaVersion: 0,
  allowed: true,
  reasonCode: "allowed",
  evaluatedAt: "2026-04-30T00:00:00.000Z",
  workspaceId: "ws-1",
  action: "workspace.write",
  principal: { workspaceId: "ws-1", kind: "user", principalId: "user_1" },
  resource: { workspaceId: "ws-1", kind: "document", id: "doc_1" },
  effectivePermissions: ["workspace.write"],
  matchedBindingIds: ["bind_1"],
  tokenId: null,
};

const runtime: RuntimeCapabilityDescriptorV0 = {
  schemaVersion: 0,
  runtimeId: "runtime-1",
  adapterId: "adapter-1",
  provider: "opencode",
  files: { write: true },
  tools: { web_fetch: true },
  locality: "local",
  posture: "workspace_write",
};

const filesystemPermit: ScopedToolPermitV0 = {
  schemaVersion: 0,
  kind: "scoped_tool_permit",
  workspaceId: "ws-1",
  permitId: "permit-1",
  actionFamily: "filesystem",
  targetSummary: {
    allow: ["workspace://docs/*"],
    deny: ["workspace://docs/private/*"],
  },
  sensitivityCeiling: "restricted",
  sandboxPosture: "local_v0",
  trustBoundary: "operator_approved",
  grantedAt: "2026-04-30T00:00:00.000Z",
  expiresAt: null,
  approvalRefs: ["approval-1"],
};

describe("evaluateScopedToolPermitV0", () => {
  it("blocks filesystem writes without an active permit", () => {
    const decision = evaluateScopedToolPermitV0({
      now: "2026-04-30T00:00:00.000Z",
      workspaceId: "ws-1",
      actionFamily: "filesystem",
      action: "write_file",
      target: "workspace://docs/output.md",
      requestedSensitivity: "internal",
      sandboxPosture: "local_v0",
      trustBoundary: "operator_approved",
      authorization,
      runtimeCapability: runtime,
      permit: null,
    });

    expect(decision.allowed).toBe(false);
    expect(decision.reasonCode).toBe("policy_required");
  });

  it("blocks outbound mutating http writes without a permit and with auditable policy reason", () => {
    const decision = evaluateScopedToolPermitV0({
      now: "2026-04-30T00:00:00.000Z",
      workspaceId: "ws-1",
      actionFamily: "http",
      action: "request",
      httpMethod: "POST",
      target: "https://api.example.test/v1/tickets",
      requestedSensitivity: "internal",
      sandboxPosture: "local_v0",
      trustBoundary: "operator_approved",
      authorization,
      runtimeCapability: runtime,
      permit: null,
    });

    expect(decision.allowed).toBe(false);
    expect(decision.reasonCode).toBe("policy_required");
    expect(decision.supported).toBe(true);
  });

  it("allows a permitted filesystem write when capability, auth, and target all match", () => {
    const decision = evaluateScopedToolPermitV0({
      now: "2026-04-30T00:00:00.000Z",
      workspaceId: "ws-1",
      actionFamily: "filesystem",
      action: "write_file",
      target: "workspace://docs/output.md",
      requestedSensitivity: "restricted",
      sandboxPosture: "local_v0",
      trustBoundary: "operator_approved",
      authorization,
      runtimeCapability: runtime,
      permit: filesystemPermit,
      approvalRefs: ["approval-1"],
    });

    expect(decision.allowed).toBe(true);
    expect(decision.permitId).toBe("permit-1");
  });

  it("treats unsupported non-mutating families and actions as deterministic blocked results", () => {
    const browserDecision = evaluateScopedToolPermitV0({
      now: "2026-04-30T00:00:00.000Z",
      workspaceId: "ws-1",
      actionFamily: "browser",
      action: "navigate",
      target: "https://example.test",
      requestedSensitivity: "public",
      sandboxPosture: "local_v0",
      trustBoundary: "operator_approved",
      authorization,
      runtimeCapability: runtime,
      permit: null,
    });

    const readDecision = evaluateScopedToolPermitV0({
      now: "2026-04-30T00:00:00.000Z",
      workspaceId: "ws-1",
      actionFamily: "filesystem",
      action: "read_file",
      target: "workspace://docs/output.md",
      requestedSensitivity: "public",
      sandboxPosture: "local_v0",
      trustBoundary: "operator_approved",
      authorization,
      runtimeCapability: runtime,
      permit: filesystemPermit,
    });

    expect(browserDecision.supported).toBe(false);
    expect(browserDecision.allowed).toBe(false);
    expect(browserDecision.reasonCode).toBe("unsupported_family");
    expect(readDecision.supported).toBe(false);
    expect(readDecision.allowed).toBe(false);
    expect(readDecision.reasonCode).toBe("unsupported_action");
  });
});
