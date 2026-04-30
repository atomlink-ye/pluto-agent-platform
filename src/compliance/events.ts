import type {
  ComplianceActionEventV0,
  ComplianceStore,
  ComplianceTargetRefV0,
} from "./compliance-store.js";

export interface PrivilegedLifecycleEventInputV0 {
  eventId: string;
  action: string;
  actorId: string;
  target: ComplianceTargetRefV0;
  createdAt: string;
  sourceCommand: string;
  beforeStatus?: string | null;
  afterStatus?: string | null;
  reason?: string | null;
  roleLabels?: readonly string[];
  evidenceRefs?: readonly string[];
  sourceRef?: string | null;
  summary?: string;
}

export function buildPrivilegedLifecycleEvent(
  input: PrivilegedLifecycleEventInputV0,
): ComplianceActionEventV0 {
  return {
    schema: "pluto.compliance.action-event",
    schemaVersion: 0,
    id: input.eventId,
    eventType: toComplianceEventType(input.action),
    action: input.action,
    actor: {
      principalId: input.actorId,
      roleLabels: input.roleLabels === undefined ? undefined : uniqueStrings(input.roleLabels),
    },
    target: input.target,
    status: {
      before: input.beforeStatus ?? null,
      after: input.afterStatus ?? null,
      summary: input.summary ?? summarizeLifecycleAction(input.action, input.target.recordId),
    },
    evidenceRefs: uniqueStrings(input.evidenceRefs ?? []),
    reason: input.reason ?? null,
    createdAt: input.createdAt,
    source: {
      command: input.sourceCommand,
      ref: input.sourceRef ?? null,
    },
  };
}

export async function recordPrivilegedLifecycleEvent(
  store: ComplianceStore,
  input: PrivilegedLifecycleEventInputV0,
): Promise<ComplianceActionEventV0> {
  return store.recordEvent(buildPrivilegedLifecycleEvent(input));
}

function toComplianceEventType(action: string): string {
  return `compliance.${action}`;
}

function summarizeLifecycleAction(action: string, recordId: string): string {
  return `${action} recorded for ${recordId}`;
}

function uniqueStrings(values: readonly string[]): string[] {
  return [...new Set(values.filter((value) => value.length > 0))];
}
