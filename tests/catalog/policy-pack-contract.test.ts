import { describe, expect, it } from "vitest";

import type { PolicyPackV0 } from "@/catalog/contracts.js";

function describePolicyPack(pack: PolicyPackV0): string {
  if (pack.status === "enabled") {
    return `${pack.status}:${pack.posture}:${pack.approvalExpectations.values.length}`;
  }

  return `${pack.status}:${pack.reason}:${pack.conflicts.length}`;
}

describe("PolicyPackV0", () => {
  it("models enabled posture distinctly from blocked conflict posture", () => {
    const enabled: PolicyPackV0 = {
      schema: "pluto.catalog.policy-pack",
      schemaVersion: 0,
      id: "default-guardrails",
      version: "0.0.1",
      status: "enabled",
      name: "Default guardrails",
      summary: "Baseline requirements applied to workers.",
      posture: "advisory",
      runtimeExpectations: {
        level: "required",
        values: ["local-context"],
      },
      toolExpectations: {
        level: "preferred",
        values: ["read", "grep"],
      },
      sensitivityExpectations: {
        level: "required",
        values: ["no-secrets"],
      },
      budgetExpectations: {
        level: "preferred",
        maxRuntimeSeconds: 300,
      },
      approvalExpectations: {
        level: "required",
        values: ["human-review-for-destructive-actions"],
      },
    };

    const blocked: PolicyPackV0 = {
      schema: "pluto.catalog.policy-pack",
      schemaVersion: 0,
      id: "default-guardrails",
      version: "0.0.2",
      status: "blocked",
      name: "Default guardrails",
      summary: "Conflicts with an incompatible runtime policy.",
      reason: "conflict",
      conflicts: [
        {
          policyId: "default-guardrails/no-network",
          withPolicyId: "runtime/open-network",
          message: "The runtime requires outbound network access.",
        },
      ],
    };

    expect(describePolicyPack(enabled)).toBe("enabled:advisory:1");
    expect(describePolicyPack(blocked)).toBe("blocked:conflict:1");
  });

  it("remains durably serializable across both union variants", () => {
    const packs: PolicyPackV0[] = [
      {
        schema: "pluto.catalog.policy-pack",
        schemaVersion: 0,
        id: "quality",
        version: "0.1.0",
        status: "enabled",
        name: "Quality",
        summary: "Artifact quality checks.",
        posture: "enforced",
        runtimeExpectations: {
          level: "required",
          values: ["workspace-write"],
        },
        toolExpectations: {
          level: "required",
          values: ["read-before-write"],
        },
        sensitivityExpectations: {
          level: "required",
          values: ["no-external-exfiltration"],
        },
        budgetExpectations: {
          level: "preferred",
          maxInputTokens: 8000,
          maxOutputTokens: 4000,
        },
        approvalExpectations: {
          level: "required",
          values: ["peer-review"],
        },
        metadata: { owner: "qa" },
      },
      {
        schema: "pluto.catalog.policy-pack",
        schemaVersion: 0,
        id: "quality",
        version: "0.1.1",
        status: "blocked",
        name: "Quality",
        summary: "Blocked until policy conflict is resolved.",
        reason: "conflict",
        conflicts: [
          {
            policyId: "quality/non-empty-artifact",
            withPolicyId: "runtime/allow-empty-artifact",
            message: "The runtime policy allows empty artifacts.",
          },
        ],
        metadata: { owner: "qa" },
      },
    ];

    expect(JSON.parse(JSON.stringify(packs))).toEqual(packs);
  });
});
