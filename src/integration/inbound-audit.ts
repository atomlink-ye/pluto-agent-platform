import { createHash } from "node:crypto";

import { createAuditEventV0 } from "../security/audit.js";
import type { SecurityStore } from "../security/security-store.js";

const INBOUND_AUDIT_PRINCIPAL_ID = "r5_inbound_ingest";

export async function emitInboundRejectAuditV0(input: {
  securityStore?: SecurityStore;
  workspaceId: string;
  occurredAt: string;
  action: string;
  target: string;
  reasonCode: string;
  correlationId: string;
  details?: Record<string, unknown>;
}): Promise<void> {
  if (!input.securityStore) {
    return;
  }

  const principalRef = {
    workspaceId: input.workspaceId,
    kind: "service_account" as const,
    principalId: INBOUND_AUDIT_PRINCIPAL_ID,
  };
  const eventId = buildInboundAuditEventIdV0(input);
  await input.securityStore.appendAuditEvent(createAuditEventV0({
    workspaceId: input.workspaceId,
    eventId,
    occurredAt: input.occurredAt,
    actorRef: principalRef,
    principalRef,
    actionFamily: "connector",
    action: input.action,
    target: input.target,
    permitId: null,
    approvalRefs: [],
    outcome: "denied",
    sensitivity: "restricted",
    sandboxPosture: "connector_bridge",
    trustBoundary: "external_service",
    reasonCodes: [input.reasonCode],
    correlationId: input.correlationId,
    details: input.details,
  }));
}

function buildInboundAuditEventIdV0(input: {
  workspaceId: string;
  occurredAt: string;
  action: string;
  target: string;
  reasonCode: string;
  correlationId: string;
}): string {
  const digest = createHash("sha1")
    .update(JSON.stringify([
      input.workspaceId,
      input.occurredAt,
      input.action,
      input.target,
      input.reasonCode,
      input.correlationId,
    ]))
    .digest("hex")
    .slice(0, 12);
  return `audit-inbound-${input.reasonCode}-${digest}`;
}
