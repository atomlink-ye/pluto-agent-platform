import type { AuditEventV0, AuditEventOutcomeLikeV0, DataSensitivityClassLikeV0 } from "../contracts/security.js";
import type { PrincipalRefV0 } from "../contracts/identity.js";
import { applyRedactionPolicyV0 } from "./redaction.js";

export interface CreateAuditEventInputV0 {
  workspaceId: string;
  eventId: string;
  occurredAt: string;
  actorRef: PrincipalRefV0;
  principalRef: PrincipalRefV0;
  actionFamily: string;
  action: string;
  target: string;
  permitId: string | null;
  approvalRefs: string[];
  outcome: AuditEventOutcomeLikeV0;
  sensitivity: DataSensitivityClassLikeV0;
  sandboxPosture: string;
  trustBoundary: string;
  reasonCodes: string[];
  correlationId: string;
  details?: Record<string, unknown>;
}

export type AuditEnvelopeEventV0 = AuditEventV0 & {
  actorRef: PrincipalRefV0;
  principalRef: PrincipalRefV0;
  reasonCode: string | null;
  correlationId: string;
  redaction: {
    hitCount: number;
    categories: string[];
  };
  details?: unknown;
};

export function createAuditEventV0(input: CreateAuditEventInputV0): AuditEnvelopeEventV0 {
  const targetRedaction = applyRedactionPolicyV0({
    workspaceId: input.workspaceId,
    sourceSensitivity: input.sensitivity,
    stage: "audit",
    value: input.target,
    now: input.occurredAt,
  });
  const detailsRedaction = input.details
    ? applyRedactionPolicyV0({
        workspaceId: input.workspaceId,
        sourceSensitivity: input.sensitivity,
        stage: "audit",
        value: input.details,
        now: input.occurredAt,
      })
    : null;

  return {
    schemaVersion: 0,
    kind: "audit_event",
    workspaceId: input.workspaceId,
    eventId: input.eventId,
    occurredAt: input.occurredAt,
    actionFamily: input.actionFamily,
    action: input.action,
    target: String(targetRedaction.value),
    permitId: input.permitId,
    approvalRefs: [...input.approvalRefs],
    outcome: input.outcome,
    sensitivity: input.sensitivity,
    sandboxPosture: input.sandboxPosture,
    trustBoundary: input.trustBoundary,
    reasonCodes: [...input.reasonCodes],
    actorRef: input.actorRef,
    principalRef: input.principalRef,
    reasonCode: input.reasonCodes[0] ?? null,
    correlationId: input.correlationId,
    redaction: {
      hitCount: targetRedaction.summary.hitCount + (detailsRedaction?.summary.hitCount ?? 0),
      categories: Array.from(new Set([
        ...targetRedaction.summary.categories,
        ...(detailsRedaction?.summary.categories ?? []),
      ])).sort((left, right) => left.localeCompare(right)),
    },
    ...(detailsRedaction ? { details: detailsRedaction.value } : {}),
  };
}
