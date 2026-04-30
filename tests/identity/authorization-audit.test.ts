import { describe, expect, it } from "vitest";

import type { ApiTokenRecordV0, MembershipBindingV0, PrincipalRefV0, WorkspaceRecordV0, WorkspaceScopedRefV0 } from "@/contracts/identity.js";
import {
  approvalRecordedAuditEventV0,
  membershipGrantedAuditEventV0,
  membershipRevokedAuditEventV0,
  permitGrantedAuditEventV0,
  permitRevokedAuditEventV0,
  publishDecisionRecordedAuditEventV0,
  serviceAccountActivatedAuditEventV0,
  serviceAccountRevokedAuditEventV0,
  tokenIssuedAuditEventV0,
  tokenRevokedAuditEventV0,
  tokenRotatedAuditEventV0,
  workspaceActivatedAuditEventV0,
  workspaceSuspendedAuditEventV0,
} from "@/identity/audit-events.js";

const workspaceId = "ws_local_alpha";
const actorRef: PrincipalRefV0 = {
  workspaceId,
  kind: "user",
  principalId: "user_01JTS9X1TK6D2",
};
const serviceAccountRef: PrincipalRefV0 = {
  workspaceId,
  kind: "service_account",
  principalId: "sa_01JTS9X23Q8A7",
};
const binding: MembershipBindingV0 = {
  schemaVersion: 0,
  kind: "membership_binding",
  id: "bind_01",
  orgId: "org_01JTS9X1HFW9Q",
  workspaceId,
  createdAt: "2026-04-30T00:00:00.000Z",
  updatedAt: "2026-04-30T00:00:01.000Z",
  status: "active",
  principal: serviceAccountRef,
  role: "publisher",
  permissions: ["governance.publish"],
};
const token: ApiTokenRecordV0 = {
  schemaVersion: 0,
  kind: "api_token",
  id: "tok_publish_01",
  orgId: "org_01JTS9X1HFW9Q",
  workspaceId,
  label: "publisher token",
  status: "active",
  createdAt: "2026-04-30T00:00:00.000Z",
  updatedAt: "2026-04-30T00:05:00.000Z",
  tokenPrefix: "pluto_pub_",
  tokenHash: "sha256:publish",
  verification: {
    hashAlgorithm: "sha256",
    verificationState: "verified",
    verifiedAt: "2026-04-30T00:00:01.000Z",
    lastUsedAt: null,
  },
  allowedActions: ["governance.publish"],
  principal: serviceAccountRef,
  actorRef,
  rotatedAt: "2026-04-30T00:05:00.000Z",
  replacedByTokenId: "tok_publish_02",
  revokedAt: "2026-04-30T00:10:00.000Z",
};
const workspace: WorkspaceRecordV0 = {
  schemaVersion: 0,
  kind: "workspace",
  id: workspaceId,
  orgId: "org_01JTS9X1HFW9Q",
  slug: "core-platform",
  displayName: "Core Platform",
  ownerRef: actorRef,
  createdAt: "2026-04-30T00:00:00.000Z",
  updatedAt: "2026-04-30T00:00:01.000Z",
  status: "active",
  suspendedAt: "2026-04-30T00:20:00.000Z",
};
const permitRef: WorkspaceScopedRefV0 = {
  workspaceId,
  kind: "permit",
  id: "permit_01",
};
const approvalRef: WorkspaceScopedRefV0 = {
  workspaceId,
  kind: "approval",
  id: "approval_01",
};
const documentRef: WorkspaceScopedRefV0 = {
  workspaceId,
  kind: "document",
  id: "doc_01",
};
const publishDecisionRef: WorkspaceScopedRefV0 = {
  workspaceId,
  kind: "publish_decision",
  id: "publish_01",
};

describe("authorization audit inputs", () => {
  it("builds canonical lifecycle events with stable attribution and object refs", () => {
    expect(membershipGrantedAuditEventV0({
      occurredAt: "2026-04-30T00:00:02.000Z",
      actorRef,
      binding,
    })).toEqual({
      schemaVersion: 0,
      eventType: "membership_granted",
      workspaceId,
      occurredAt: "2026-04-30T00:00:02.000Z",
      actorRef,
      subjectRef: serviceAccountRef,
      objectRef: { workspaceId, kind: "membership_binding", id: "bind_01" },
      details: {
        role: "publisher",
        permissions: "governance.publish",
      },
    });

    expect(membershipRevokedAuditEventV0({
      occurredAt: "2026-04-30T00:10:00.000Z",
      actorRef,
      binding: { ...binding, revokedAt: "2026-04-30T00:10:00.000Z" },
    }).details.revokedAt).toBe("2026-04-30T00:10:00.000Z");

    expect(tokenIssuedAuditEventV0({
      occurredAt: "2026-04-30T00:00:03.000Z",
      actorRef,
      token,
    }).details.tokenPrefix).toBe("pluto_pub_");

    expect(tokenRotatedAuditEventV0({
      occurredAt: "2026-04-30T00:05:00.000Z",
      actorRef,
      token,
    }).details.replacedByTokenId).toBe("tok_publish_02");

    expect(tokenRevokedAuditEventV0({
      occurredAt: "2026-04-30T00:10:00.000Z",
      actorRef,
      token,
    }).subjectRef).toEqual(serviceAccountRef);

    expect(workspaceSuspendedAuditEventV0({
      occurredAt: "2026-04-30T00:20:00.000Z",
      actorRef,
      workspace: { ...workspace, status: "suspended" },
    }).details.suspendedAt).toBe("2026-04-30T00:20:00.000Z");

    expect(workspaceActivatedAuditEventV0({
      occurredAt: "2026-04-30T00:30:00.000Z",
      actorRef,
      workspace,
    }).eventType).toBe("workspace_activated");

    expect(serviceAccountActivatedAuditEventV0({
      occurredAt: "2026-04-30T00:40:00.000Z",
      actorRef,
      serviceAccountRef,
    }).objectRef).toEqual({ workspaceId, kind: "service_account", id: "sa_01JTS9X23Q8A7" });

    expect(serviceAccountRevokedAuditEventV0({
      occurredAt: "2026-04-30T00:41:00.000Z",
      actorRef,
      serviceAccountRef,
    }).eventType).toBe("service_account_revoked");

    expect(permitGrantedAuditEventV0({
      occurredAt: "2026-04-30T00:50:00.000Z",
      actorRef,
      subjectRef: serviceAccountRef,
      permitRef,
      permission: "governance.publish",
    }).details.permission).toBe("governance.publish");

    expect(permitRevokedAuditEventV0({
      occurredAt: "2026-04-30T00:51:00.000Z",
      actorRef,
      subjectRef: serviceAccountRef,
      permitRef,
      permission: "governance.publish",
    }).eventType).toBe("permit_revoked");

    expect(approvalRecordedAuditEventV0({
      occurredAt: "2026-04-30T01:00:00.000Z",
      actorRef,
      approvalRef,
      approverRef: serviceAccountRef,
      documentRef,
    }).details.documentId).toBe("doc_01");

    expect(publishDecisionRecordedAuditEventV0({
      occurredAt: "2026-04-30T01:10:00.000Z",
      actorRef,
      decisionRef: publishDecisionRef,
      documentRef,
      outcome: "approved",
    })).toEqual({
      schemaVersion: 0,
      eventType: "publish_decision_recorded",
      workspaceId,
      occurredAt: "2026-04-30T01:10:00.000Z",
      actorRef,
      subjectRef: documentRef,
      objectRef: publishDecisionRef,
      details: {
        outcome: "approved",
        documentId: "doc_01",
      },
    });
  });
});
