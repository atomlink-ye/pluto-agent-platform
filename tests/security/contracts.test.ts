import { describe, expect, it } from "vitest";

import {
  validateAuditEventV0,
  validateRedactionPolicyV0,
  validateRedactionResultV0,
  validateScopedToolPermitV0,
  validateSecretRefV0,
} from "@/contracts/security.js";

describe("security contracts", () => {
  it("validates schema-stamped workspace-scoped records", () => {
    expect(validateSecretRefV0({
      schemaVersion: 0,
      kind: "secret_ref",
      workspaceId: "workspace-1",
      name: "OPENCODE_API_KEY",
      ref: "opencode://secrets/OPENCODE_API_KEY",
      displayLabel: "OpenCode API key",
      status: "active",
      createdAt: "2026-04-30T00:00:00.000Z",
      updatedAt: "2026-04-30T00:00:01.000Z",
      providerType: "local_v0",
      actorRefs: [{ workspaceId: "workspace-1", kind: "user", principalId: "user-1" }],
    }).ok).toBe(true);

    expect(validateScopedToolPermitV0({
      schemaVersion: 0,
      kind: "scoped_tool_permit",
      workspaceId: "workspace-1",
      permitId: "permit-1",
      actionFamily: "github",
      targetSummary: {
        allow: ["repo:pluto/*"],
        deny: ["repo:pluto/legacy"],
      },
      sensitivityCeiling: "confidential",
      sandboxPosture: "local_v0",
      trustBoundary: "operator_approved",
      grantedAt: "2026-04-30T00:00:00.000Z",
      expiresAt: null,
      approvalRefs: ["approval-1"],
    }).ok).toBe(true);

    expect(validateRedactionPolicyV0({
      schemaVersion: 0,
      kind: "redaction_policy",
      workspaceId: "workspace-1",
      policyId: "policy-1",
      name: "Default secret masking",
      updatedAt: "2026-04-30T00:00:00.000Z",
      defaultAction: "mask",
      rules: [
        {
          path: "payload.token",
          action: "mask",
          minSensitivity: "confidential",
          reasonCode: "policy_required",
        },
      ],
    }).ok).toBe(true);

    expect(validateRedactionResultV0({
      schemaVersion: 0,
      kind: "redaction_result",
      workspaceId: "workspace-1",
      resultId: "result-1",
      policyId: "policy-1",
      redactedAt: "2026-04-30T00:00:00.000Z",
      sourceSensitivity: "restricted",
      resultSensitivity: "internal",
      outcome: "redacted",
      redactionCount: 2,
      reasonCodes: ["policy_required", "operator_approved"],
    }).ok).toBe(true);

    expect(validateAuditEventV0({
      schemaVersion: 0,
      kind: "audit_event",
      workspaceId: "workspace-1",
      eventId: "event-1",
      occurredAt: "2026-04-30T00:00:00.000Z",
      actionFamily: "mcp",
      action: "invoke",
      target: "mcp://github/issues.create",
      permitId: "permit-1",
      approvalRefs: ["approval-1"],
      outcome: "allowed",
      sensitivity: "internal",
      sandboxPosture: "local_v0",
      trustBoundary: "operator_approved",
      reasonCodes: ["operator_approved"],
    }).ok).toBe(true);
  });

  it("rejects schema mismatches and malformed permit target summaries", () => {
    const wrongSchemaVersion = validateSecretRefV0({
      schemaVersion: 1,
      kind: "secret_ref",
      workspaceId: "workspace-1",
      name: "OPENCODE_API_KEY",
      ref: "opencode://secrets/OPENCODE_API_KEY",
      displayLabel: "OpenCode API key",
      status: "active",
      createdAt: "2026-04-30T00:00:00.000Z",
      updatedAt: "2026-04-30T00:00:01.000Z",
      actorRefs: [{ workspaceId: "workspace-1", kind: "user", principalId: "user-1" }],
    });

    expect(wrongSchemaVersion.ok).toBe(false);
    expect(wrongSchemaVersion.ok ? [] : wrongSchemaVersion.errors).toContain("schemaVersion must be 0");

    const badSummary = validateScopedToolPermitV0({
      schemaVersion: 0,
      kind: "scoped_tool_permit",
      workspaceId: "workspace-1",
      permitId: "permit-1",
      actionFamily: "filesystem",
      targetSummary: {
        allow: ["workspace://src/*"],
        deny: [42],
      },
      sensitivityCeiling: "internal",
      sandboxPosture: "local_v0",
      trustBoundary: "local_workspace",
      grantedAt: "2026-04-30T00:00:00.000Z",
      expiresAt: null,
      approvalRefs: [],
    });

    expect(badSummary.ok).toBe(false);
    expect(badSummary.ok ? [] : badSummary.errors).toContain(
      "targetSummary must be an object with allow and deny string arrays",
    );
  });
});
