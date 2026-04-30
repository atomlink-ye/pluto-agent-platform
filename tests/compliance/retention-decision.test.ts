import { describe, expect, it } from "vitest";

import { toGovernedPublishPackageRefV0 } from "@/contracts/compliance.js";
import { evaluateRetentionDecisionV0 } from "@/compliance/retention.js";

const publishPackageRef = toGovernedPublishPackageRefV0({
  id: "pkg-1",
  workspaceId: "workspace-1",
  documentId: "doc-1",
  versionId: "ver-1",
  summary: "Governed release package",
});

describe("retention deletion decisions", () => {
  it("blocks fixed-term deletion until the retention date expires", () => {
    const decision = evaluateRetentionDecisionV0({
      targetRef: publishPackageRef,
      requestedAt: "2026-05-01T00:00:00.000Z",
      mode: "hard_delete",
      policies: [{
        id: "policy-fixed",
        retentionClass: "fixed_term",
        governedRefs: [publishPackageRef],
        retainUntil: "2026-06-01T00:00:00.000Z",
      }],
    });

    expect(decision).toMatchObject({
      outcome: "blocked",
      blockReason: "retain_until_active",
      matchedPolicyIds: ["policy-fixed"],
      retainUntil: "2026-06-01T00:00:00.000Z",
    });
  });

  it("allows fixed-term deletion after expiry but keeps indefinite retention blocked", () => {
    expect(evaluateRetentionDecisionV0({
      targetRef: publishPackageRef,
      requestedAt: "2026-07-01T00:00:00.000Z",
      mode: "hard_delete",
      policies: [{
        id: "policy-fixed-expired",
        retentionClass: "fixed_term",
        governedRefs: [publishPackageRef],
        retainUntil: "2026-06-01T00:00:00.000Z",
      }],
    })).toMatchObject({
      outcome: "allowed",
      blockReason: null,
    });

    expect(evaluateRetentionDecisionV0({
      targetRef: publishPackageRef,
      requestedAt: "2026-07-01T00:00:00.000Z",
      mode: "hard_delete",
      policies: [{
        id: "policy-indefinite",
        retentionClass: "indefinite",
        governedRefs: [publishPackageRef],
        retainUntil: null,
      }],
    })).toMatchObject({
      outcome: "blocked",
      blockReason: "indefinite_retention_active",
    });
  });

  it("treats regulated content conservatively for hard delete decisions", () => {
    const decision = evaluateRetentionDecisionV0({
      targetRef: publishPackageRef,
      requestedAt: "2026-07-01T00:00:00.000Z",
      mode: "hard_delete",
      policies: [{
        id: "policy-regulated",
        retentionClass: "regulated",
        governedRefs: [publishPackageRef],
        retainUntil: null,
      }],
    });

    expect(decision).toMatchObject({
      outcome: "blocked",
      blockReason: "regulated_retention_active",
      matchedPolicyIds: ["policy-regulated"],
    });
  });
});
