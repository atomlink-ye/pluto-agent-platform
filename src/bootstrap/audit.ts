import type { PrincipalRefV0, WorkspaceScopedRefV0 } from "../contracts/identity.js";
import type {
  GovernanceEventActorRefV0,
  GovernanceEventRecordV0,
  GovernanceEventTargetRefV0,
} from "../audit/governance-events.js";

export const WORKSPACE_BOOTSTRAP_AUDIT_EVENT_TYPES_V0 = [
  "workspace_created",
  "workspace_activated",
  "admin_granted",
  "admin_revoked",
  "bootstrap_blocked",
  "blocker_resolved",
  "bootstrap_completed",
] as const;

export type WorkspaceBootstrapAuditEventTypeV0 = typeof WORKSPACE_BOOTSTRAP_AUDIT_EVENT_TYPES_V0[number];

export interface WorkspaceBootstrapAuditOptionsV0 {
  eventType: WorkspaceBootstrapAuditEventTypeV0;
  createdAt: string;
  actorRef: PrincipalRefV0;
  target: GovernanceEventTargetRefV0;
  summary: string;
  beforeStatus?: string | null;
  afterStatus?: string | null;
  reason?: string | null;
  evidenceRefs?: readonly string[];
  sourceCommand: string;
  sourceRef?: string | null;
}

export function createWorkspaceBootstrapAuditEventV0(
  options: WorkspaceBootstrapAuditOptionsV0,
): GovernanceEventRecordV0 {
  return {
    schema: "pluto.audit.governance-event",
    schemaVersion: 0,
    eventId: `${options.createdAt}:${options.eventType}:${options.target.recordId}`,
    eventType: options.eventType,
    actor: toActor(options.actorRef),
    target: options.target,
    status: {
      before: options.beforeStatus ?? null,
      after: options.afterStatus ?? null,
      summary: options.summary,
    },
    evidenceRefs: uniqueStrings(options.evidenceRefs ?? []),
    reason: options.reason ?? null,
    createdAt: options.createdAt,
    source: {
      command: options.sourceCommand,
      ref: options.sourceRef ?? null,
    },
  };
}

export function toGovernanceTargetRefV0(ref: WorkspaceScopedRefV0): GovernanceEventTargetRefV0 {
  return {
    kind: ref.kind,
    recordId: ref.id,
    workspaceId: ref.workspaceId,
  };
}

function toActor(actorRef: PrincipalRefV0): GovernanceEventActorRefV0 {
  return {
    principalId: actorRef.principalId,
  };
}

function uniqueStrings(values: readonly string[]): string[] {
  return [...new Set(values.filter((value) => value.length > 0))];
}
