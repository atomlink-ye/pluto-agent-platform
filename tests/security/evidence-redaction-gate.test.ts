import { describe, expect, it } from "vitest";

import { applyRedactionPolicyV0 } from "@/security/redaction.js";

describe("evidence redaction gate", () => {
  it("blocks evidence sealing when high-confidence token-shaped content is present", () => {
    const result = applyRedactionPolicyV0({
      workspaceId: "ws-1",
      sourceSensitivity: "restricted",
      stage: "evidence_seal",
      value: {
        artifact: "Bearer ghp_ABCDEFGHIJKLMNOPQRSTUVWXYZ123456",
      },
      now: "2026-04-30T00:00:00.000Z",
    });

    expect(result.blocked).toBe(true);
    expect(result.record.outcome).toBe("blocked");
    expect(result.record.policyId).toBe("local-v0-conservative-redaction");
    expect(result.record.reasonCodes).toContain("policy_required");
  });
});
