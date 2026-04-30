import { describe, expect, it } from "vitest";

import { validateAuditEventV0 } from "@/contracts/security.js";
import { createAuditEventV0 } from "@/security/audit.js";

describe("audit envelope", () => {
  it("includes actor, principal, reason, correlation, and redaction summary without leaking secrets", () => {
    const event = createAuditEventV0({
      workspaceId: "ws-1",
      eventId: "audit-1",
      occurredAt: "2026-04-30T00:00:00.000Z",
      actorRef: { workspaceId: "ws-1", kind: "user", principalId: "user_1" },
      principalRef: { workspaceId: "ws-1", kind: "service_account", principalId: "sa_1" },
      actionFamily: "http",
      action: "request",
      target: "https://api.example.test/v1/export?token=ghp_ABCDEFGHIJKLMNOPQRSTUVWXYZ123456",
      permitId: "permit-1",
      approvalRefs: ["approval-1"],
      outcome: "denied",
      sensitivity: "restricted",
      sandboxPosture: "local_v0",
      trustBoundary: "operator_approved",
      reasonCodes: ["approval_missing"],
      correlationId: "corr-1",
      details: {
        stderr: "OPENAI_API_KEY=sk-abcdefghijklmnop123456\nstack line 1",
        transcript: ["user asked to export", "assistant prepared payload"],
      },
    });

    expect(validateAuditEventV0(event).ok).toBe(true);
    expect(event.actorRef.principalId).toBe("user_1");
    expect(event.principalRef.principalId).toBe("sa_1");
    expect(event.reasonCode).toBe("approval_missing");
    expect(event.correlationId).toBe("corr-1");
    expect(event.redaction.hitCount).toBeGreaterThan(0);
    expect(JSON.stringify(event)).not.toContain("OPENAI_API_KEY");
    expect(JSON.stringify(event)).not.toContain("ghp_ABCDEFGHIJKLMNOPQRSTUVWXYZ123456");
    expect(JSON.stringify(event)).toContain("[stderr 2 lines]");
    expect(JSON.stringify(event)).toContain("[transcript summary: 2 lines]");
  });
});
