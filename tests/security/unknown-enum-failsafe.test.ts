import { describe, expect, it } from "vitest";

import {
  allowsMutatingActionV0,
  allowsSensitiveDataV0,
  parseDataSensitivityClassV0,
  parseSandboxPostureV0,
  parseScopedToolActionFamilyV0,
  parseSecurityReasonCodeV0,
  parseTrustBoundaryV0,
} from "@/contracts/security.js";

const permit = {
  schemaVersion: 0 as const,
  kind: "scoped_tool_permit" as const,
  workspaceId: "workspace-1",
  permitId: "permit-1",
  actionFamily: "filesystem",
  targetSummary: {
    allow: ["workspace://src/*"],
    deny: [],
  },
  sensitivityCeiling: "confidential",
  sandboxPosture: "local_v0",
  trustBoundary: "operator_approved",
  grantedAt: "2026-04-30T00:00:00.000Z",
  expiresAt: null,
  approvalRefs: ["approval-1"],
};

describe("security unknown-enum failsafes", () => {
  it("preserves unknown additive enum strings for tolerant readers", () => {
    expect(parseDataSensitivityClassV0("regulated")).toBe("regulated");
    expect(parseDataSensitivityClassV0("workspace_secret")).toBe("workspace_secret");
    expect(parseSandboxPostureV0("sandbox_v1_remote")).toBe("sandbox_v1_remote");
    expect(parseTrustBoundaryV0("partner_operator")).toBe("partner_operator");
    expect(parseScopedToolActionFamilyV0("slack")).toBe("slack");
    expect(parseSecurityReasonCodeV0("review_escalated")).toBe("review_escalated");
  });

  it("treats regulated as canonical and still fails closed for unknown additive enums", () => {
    expect(allowsSensitiveDataV0({ ...permit, sensitivityCeiling: "regulated" }, "regulated", "local_v0", "operator_approved")).toBe(true);
    expect(allowsSensitiveDataV0(permit, "workspace_secret", "local_v0", "operator_approved")).toBe(false);
    expect(allowsSensitiveDataV0(permit, "internal", "sandbox_v1_remote", "operator_approved")).toBe(false);
    expect(allowsSensitiveDataV0(permit, "internal", "local_v0", "partner_operator")).toBe(false);

    expect(allowsMutatingActionV0(
      { ...permit, actionFamily: "slack" },
      "slack",
      "workspace://src/contracts/security.ts",
      "internal",
      "local_v0",
      "operator_approved",
    )).toBe(false);

    expect(allowsMutatingActionV0(
      { ...permit, sensitivityCeiling: "workspace_secret" },
      "filesystem",
      "workspace://src/contracts/security.ts",
      "internal",
      "local_v0",
      "operator_approved",
    )).toBe(false);
  });
});
