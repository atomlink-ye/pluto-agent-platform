import { describe, expect, it } from "vitest";

import type { PrincipalRefV0, WorkspaceScopedRefV0 } from "@/contracts/identity.js";
import {
  permitGrantedAuditEventV0,
  publishDecisionRecordedAuditEventV0,
  serviceAccountActivatedAuditEventV0,
  serviceAccountRevokedAuditEventV0,
  tokenIssuedAuditEventV0,
} from "@/identity/audit-events.js";

const workspaceId = "ws_local_alpha";
const actorRef: PrincipalRefV0 = {
  workspaceId,
  kind: "user",
  principalId: "user_01",
};
const serviceAccountRef: PrincipalRefV0 = {
  workspaceId,
  kind: "service_account",
  principalId: "sa_01",
};
const permitRef: WorkspaceScopedRefV0 = {
  workspaceId,
  kind: "permit",
  id: "permit_01",
};
const decisionRef: WorkspaceScopedRefV0 = {
  workspaceId,
  kind: "publish_decision",
  id: "decision_01",
};
const documentRef: WorkspaceScopedRefV0 = {
  workspaceId,
  kind: "document",
  id: "doc_01",
};

describe("auditable lifecycle boundary", () => {
  it("emits canonical local-v0 audit events for install/activate/revoke/approval/decision style actions", () => {
    const issued = tokenIssuedAuditEventV0({
      occurredAt: "2026-04-30T00:00:01.000Z",
      actorRef,
      token: {
        schemaVersion: 0,
        kind: "api_token",
        id: "tok_01",
        orgId: "org_01",
        workspaceId,
        label: "publisher token",
        status: "active",
        createdAt: "2026-04-30T00:00:00.000Z",
        updatedAt: "2026-04-30T00:00:01.000Z",
        principal: serviceAccountRef,
        actorRef,
        tokenPrefix: "pluto_pub_",
        tokenHash: "sha256:abc",
        verification: {
          hashAlgorithm: "sha256",
          verificationState: "verified",
          verifiedAt: "2026-04-30T00:00:01.000Z",
          lastUsedAt: null,
        },
        allowedActions: ["governance.publish"],
      },
    });
    const activated = serviceAccountActivatedAuditEventV0({
      occurredAt: "2026-04-30T00:00:02.000Z",
      actorRef,
      serviceAccountRef,
    });
    const revoked = serviceAccountRevokedAuditEventV0({
      occurredAt: "2026-04-30T00:00:03.000Z",
      actorRef,
      serviceAccountRef,
    });
    const permitGranted = permitGrantedAuditEventV0({
      occurredAt: "2026-04-30T00:00:04.000Z",
      actorRef,
      subjectRef: serviceAccountRef,
      permitRef,
      permission: "governance.publish",
    });
    const decision = publishDecisionRecordedAuditEventV0({
      occurredAt: "2026-04-30T00:00:05.000Z",
      actorRef,
      decisionRef,
      documentRef,
      outcome: "approved",
    });

    expect(issued.eventType).toBe("token_issued");
    expect(issued.subjectRef).toEqual(serviceAccountRef);
    expect(activated.objectRef).toEqual({ workspaceId, kind: "service_account", id: "sa_01" });
    expect(revoked.eventType).toBe("service_account_revoked");
    expect(permitGranted.objectRef).toEqual(permitRef);
    expect(permitGranted.details.permission).toBe("governance.publish");
    expect(decision).toEqual({
      schemaVersion: 0,
      eventType: "publish_decision_recorded",
      workspaceId,
      occurredAt: "2026-04-30T00:00:05.000Z",
      actorRef,
      subjectRef: documentRef,
      objectRef: decisionRef,
      details: {
        outcome: "approved",
        documentId: "doc_01",
      },
    });
  });
});
