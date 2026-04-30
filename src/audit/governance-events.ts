import type { DecisionRecordV0, DelegationRecordV0, GovernedTargetRefV0 } from "../contracts/review.js";
import type { PublishAttemptRecordV0, PublishPackageRecordV0, RollbackRetractRecordV0 } from "../contracts/publish.js";
import type { ReleaseCandidateRecordV0, ReleaseReadinessReportV0, WaiverRecordV0 } from "../contracts/release.js";
import type { ExportAssetRecordV0 } from "../contracts/publish.js";
import type { GovernanceEventTypeLikeV0 } from "./event-types.js";
import { parseGovernanceEventTypeV0 } from "./event-types.js";

export interface GovernanceEventActorRefV0 {
  principalId: string;
  roleLabels?: string[];
}

export interface GovernanceEventTargetRefV0 {
  kind: string;
  recordId: string;
  workspaceId?: string;
  documentId?: string;
  versionId?: string;
  requestId?: string;
  packageId?: string;
  candidateId?: string;
  gateId?: string;
  attemptId?: string;
  targetId?: string;
}

export interface GovernanceEventStatusSummaryV0 {
  before: string | null;
  after: string | null;
  summary: string;
}

export interface GovernanceEventSourceRefV0 {
  command: string;
  ref: string | null;
}

export interface GovernanceEventRecordV0 {
  schema: "pluto.audit.governance-event";
  schemaVersion: 0;
  eventId: string;
  eventType: GovernanceEventTypeLikeV0;
  actor: GovernanceEventActorRefV0;
  target: GovernanceEventTargetRefV0;
  status: GovernanceEventStatusSummaryV0;
  evidenceRefs: string[];
  reason: string | null;
  createdAt: string;
  source: GovernanceEventSourceRefV0;
}

export interface GovernanceEventQueryV0 {
  eventType?: GovernanceEventTypeLikeV0 | GovernanceEventTypeLikeV0[];
  targetKind?: string;
  targetRecordId?: string;
  actorId?: string;
  since?: string;
  until?: string;
}

interface GovernanceEventOptions {
  beforeStatus?: string | null;
  afterStatus?: string | null;
  summary: string;
  evidenceRefs?: readonly string[];
  reason?: string | null;
  sourceCommand: string;
  sourceRef?: string | null;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (typeof value !== "object" || value === null) {
    return null;
  }

  return value as Record<string, unknown>;
}

function hasOwnProperty(object: Record<string, unknown>, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(object, key);
}

function validateStringField(record: Record<string, unknown>, field: string, errors: string[]): void {
  if (!hasOwnProperty(record, field)) {
    errors.push(`missing required field: ${field}`);
    return;
  }

  if (typeof record[field] !== "string") {
    errors.push(`${field} must be a string`);
  }
}

function validateNullableStringField(record: Record<string, unknown>, field: string, errors: string[]): void {
  if (!hasOwnProperty(record, field)) {
    errors.push(`missing required field: ${field}`);
    return;
  }

  const value = record[field];
  if (value !== null && typeof value !== "string") {
    errors.push(`${field} must be a string or null`);
  }
}

function validateStringArray(value: unknown, field: string, errors: string[]): void {
  if (!Array.isArray(value) || value.some((entry) => typeof entry !== "string")) {
    errors.push(`${field} must be an array of strings`);
  }
}

function uniqueStrings(values: readonly string[]): string[] {
  return [...new Set(values.filter((value) => value.length > 0))];
}

function toEventId(eventType: string, targetRecordId: string, createdAt: string): string {
  return `${createdAt}:${eventType}:${targetRecordId}`;
}

function createEvent(
  eventType: GovernanceEventTypeLikeV0,
  actor: GovernanceEventActorRefV0,
  target: GovernanceEventTargetRefV0,
  createdAt: string,
  options: GovernanceEventOptions,
): GovernanceEventRecordV0 {
  return {
    schema: "pluto.audit.governance-event",
    schemaVersion: 0,
    eventId: toEventId(eventType, target.recordId, createdAt),
    eventType,
    actor: {
      principalId: actor.principalId,
      roleLabels: actor.roleLabels === undefined ? undefined : uniqueStrings(actor.roleLabels),
    },
    target,
    status: {
      before: options.beforeStatus ?? null,
      after: options.afterStatus ?? null,
      summary: options.summary,
    },
    evidenceRefs: uniqueStrings(options.evidenceRefs ?? []),
    reason: options.reason ?? null,
    createdAt,
    source: {
      command: options.sourceCommand,
      ref: options.sourceRef ?? null,
    },
  };
}

function targetFromGovernedTarget(target: GovernedTargetRefV0, requestId: string): GovernanceEventTargetRefV0 {
  switch (target.kind) {
    case "document":
      return {
        kind: target.kind,
        recordId: target.documentId,
        documentId: target.documentId,
        requestId,
      };
    case "version":
      return {
        kind: target.kind,
        recordId: target.versionId,
        documentId: target.documentId,
        versionId: target.versionId,
        requestId,
      };
    case "section":
      return {
        kind: target.kind,
        recordId: target.sectionId,
        documentId: target.documentId,
        versionId: target.versionId,
        requestId,
      };
    case "publish_package":
      return {
        kind: target.kind,
        recordId: target.packageId,
        documentId: target.documentId,
        versionId: target.versionId,
        packageId: target.packageId,
        requestId,
      };
  }
}

export function buildReviewRequestedAuditEvent(record: {
  id: string;
  workspaceId: string;
  target: GovernedTargetRefV0;
  requestedById: string;
  status: string;
  evidenceRequirements: Array<{ ref: string }>;
  createdAt: string;
}): GovernanceEventRecordV0 {
  const target = targetFromGovernedTarget(record.target, record.id);
  return createEvent(
    "review_requested",
    { principalId: record.requestedById },
    { ...target, workspaceId: record.workspaceId },
    record.createdAt,
    {
      afterStatus: record.status,
      summary: `review request ${record.id} recorded`,
      evidenceRefs: record.evidenceRequirements.map((entry) => entry.ref),
      sourceCommand: "review-store.putReviewRequest",
      sourceRef: record.id,
    },
  );
}

export function buildDecisionAuditEvents(record: DecisionRecordV0): GovernanceEventRecordV0[] {
  const target = targetFromGovernedTarget(record.target, record.requestId);
  const events = [createEvent(
    "decision_recorded",
    { principalId: record.actorId },
    target,
    record.recordedAt,
    {
      afterStatus: record.event,
      summary: `${record.requestKind} decision ${record.event} recorded`,
      reason: record.comment,
      sourceCommand: "review-store.putDecision",
      sourceRef: record.id,
    },
  )];

  if (record.requestKind === "approval") {
    if (record.event === "approved") {
      events.push(createEvent(
        "approval_granted",
        { principalId: record.actorId },
        target,
        record.recordedAt,
        {
          afterStatus: record.event,
          summary: `approval request ${record.requestId} approved`,
          reason: record.comment,
          sourceCommand: "review-store.putDecision",
          sourceRef: record.id,
        },
      ));
    }

    if (record.event === "rejected") {
      events.push(createEvent(
        "approval_rejected",
        { principalId: record.actorId },
        target,
        record.recordedAt,
        {
          afterStatus: record.event,
          summary: `approval request ${record.requestId} rejected`,
          reason: record.comment,
          sourceCommand: "review-store.putDecision",
          sourceRef: record.id,
        },
      ));
    }

    if (record.event === "revoked") {
      events.push(createEvent(
        "approval_revoked",
        { principalId: record.actorId },
        target,
        record.recordedAt,
        {
          afterStatus: record.event,
          summary: `approval request ${record.requestId} revoked`,
          reason: record.comment,
          sourceCommand: "review-store.putDecision",
          sourceRef: record.id,
        },
      ));
    }
  }

  if (record.event === "delegated") {
    events.push(createEvent(
      "delegation_changed",
      { principalId: record.actorId },
      target,
      record.recordedAt,
      {
        afterStatus: record.event,
        summary: `decision delegation recorded for ${record.requestId}`,
        reason: record.comment,
        sourceCommand: "review-store.putDecision",
        sourceRef: record.id,
      },
    ));
  }

  return events;
}

export function buildDelegationAuditEvent(
  record: DelegationRecordV0,
  previousStatus: string | null,
): GovernanceEventRecordV0 {
  const status = record.revokedAt === null ? "active" : "revoked";
  return createEvent(
    "delegation_changed",
    { principalId: record.delegatorId, roleLabels: [record.roleLabel] },
    {
      kind: "delegation",
      recordId: record.id,
      workspaceId: record.workspaceId,
      targetId: record.scope.requestId ?? record.scope.targetId,
      requestId: record.scope.requestId,
    },
    record.createdAt,
    {
      beforeStatus: previousStatus,
      afterStatus: status,
      summary: `delegation ${record.id} ${status}`,
      reason: record.revokedAt === null ? null : `revoked_by:${record.revokedById ?? "unknown"}`,
      sourceCommand: "review-store.putDelegation",
      sourceRef: record.id,
    },
  );
}

export function buildPackageAssembledAuditEvent(
  record: PublishPackageRecordV0,
  previousStatus: string | null,
): GovernanceEventRecordV0 {
  return createEvent(
    "package_assembled",
    { principalId: record.ownerId },
    {
      kind: "publish_package",
      recordId: record.id,
      workspaceId: record.workspaceId,
      documentId: record.documentId,
      versionId: record.versionId,
      packageId: record.id,
      targetId: record.targetId,
    },
    record.updatedAt,
    {
      beforeStatus: previousStatus,
      afterStatus: record.status,
      summary: `publish package ${record.id} assembled`,
      evidenceRefs: record.sealedEvidenceRefs,
      sourceCommand: "publish-store.putPublishPackage",
      sourceRef: record.id,
    },
  );
}

export function buildExportSealedAuditEvent(record: ExportAssetRecordV0): GovernanceEventRecordV0 {
  return createEvent(
    "export_sealed",
    { principalId: "system" },
    {
      kind: "export_asset",
      recordId: record.id,
      workspaceId: record.workspaceId,
      packageId: record.publishPackageId,
      targetId: record.channelTarget.targetId,
    },
    record.createdAt,
    {
      afterStatus: "sealed",
      summary: `export asset ${record.id} sealed`,
      evidenceRefs: record.sealedEvidenceRefs,
      sourceCommand: "publish-store.putExportAssetRecord",
      sourceRef: record.id,
    },
  );
}

export function buildPublishAttemptedAuditEvent(record: PublishAttemptRecordV0): GovernanceEventRecordV0 {
  return createEvent(
    "publish_attempted",
    { principalId: record.publisher.principalId, roleLabels: record.publisher.roleLabels },
    {
      kind: "publish_attempt",
      recordId: record.id,
      packageId: record.publishPackageId,
      attemptId: record.id,
      targetId: record.channelTarget.targetId,
    },
    record.createdAt,
    {
      afterStatus: record.status,
      summary: `publish attempt ${record.id} recorded`,
      reason: record.blockedReasons.length === 0 ? null : record.blockedReasons.join(","),
      sourceCommand: "publish-store.recordPublishAttempt",
      sourceRef: record.id,
    },
  );
}

export function buildRollbackAuditEvent(record: RollbackRetractRecordV0): GovernanceEventRecordV0 {
  const eventType = record.action === "retract"
    ? "retract_recorded"
    : record.action === "supersede"
      ? "supersede_recorded"
      : "rollback_recorded";

  return createEvent(
    eventType,
    { principalId: record.actorId },
    {
      kind: "publish_attempt",
      recordId: record.publishAttemptId,
      packageId: record.publishPackageId,
      attemptId: record.publishAttemptId,
      targetId: record.replacementPackageId ?? record.publishPackageId,
    },
    record.createdAt,
    {
      afterStatus: record.action,
      summary: `${record.action} recorded for publish attempt ${record.publishAttemptId}`,
      reason: record.reason,
      sourceCommand: "publish-store.recordRollbackRetract",
      sourceRef: record.id,
    },
  );
}

export function buildWaiverAuditEvents(
  record: WaiverRecordV0,
  previousStatus: string | null,
): GovernanceEventRecordV0[] {
  const events: GovernanceEventRecordV0[] = [];

  if (record.status === "approved") {
    events.push(createEvent(
      "waiver_approved",
      { principalId: record.approverId },
      {
        kind: "waiver",
        recordId: record.id,
        candidateId: record.candidateId,
        gateId: record.scope.gateIds[0],
      },
      record.updatedAt,
      {
        beforeStatus: previousStatus,
        afterStatus: record.status,
        summary: `waiver ${record.id} approved`,
        evidenceRefs: [...record.approvalEvidenceRefs, ...record.decisionEvidenceRefs],
        reason: record.justification,
        sourceCommand: "release-store.putWaiver",
        sourceRef: record.id,
      },
    ));
  }

  if (record.status === "revoked") {
    events.push(createEvent(
      "waiver_revoked",
      { principalId: record.approverId },
      {
        kind: "waiver",
        recordId: record.id,
        candidateId: record.candidateId,
        gateId: record.scope.gateIds[0],
      },
      record.updatedAt,
      {
        beforeStatus: previousStatus,
        afterStatus: record.status,
        summary: `waiver ${record.id} revoked`,
        evidenceRefs: [...record.approvalEvidenceRefs, ...record.decisionEvidenceRefs],
        reason: record.justification,
        sourceCommand: "release-store.putWaiver",
        sourceRef: record.id,
      },
    ));
  }

  return events;
}

export function buildReadinessEvaluatedAuditEvent(
  report: ReleaseReadinessReportV0,
  candidate: ReleaseCandidateRecordV0 | null,
  previousStatus: string | null,
): GovernanceEventRecordV0 {
  const evidenceRefs = uniqueStrings([
    ...(candidate?.candidateEvidenceRefs ?? []),
    ...report.testEvidenceRefs,
    ...report.evalEvidenceRefs,
    ...report.manualCheckEvidenceRefs,
    ...report.artifactCheckEvidenceRefs,
  ]);

  return createEvent(
    "readiness_evaluated",
    { principalId: candidate?.createdById ?? "system" },
    {
      kind: "release_readiness_report",
      recordId: report.id,
      workspaceId: report.workspaceId,
      documentId: report.documentId,
      versionId: report.versionId,
      packageId: report.packageId,
      candidateId: report.candidateId,
    },
    report.generatedAt,
    {
      beforeStatus: previousStatus,
      afterStatus: report.status,
      summary: `release readiness ${report.id} evaluated`,
      evidenceRefs,
      reason: report.blockedReasons.length === 0 ? null : report.blockedReasons.join(","),
      sourceCommand: "release-store.putReadinessReport",
      sourceRef: report.id,
    },
  );
}

export function validateGovernanceEventRecordV0(
  value: unknown,
): { ok: true; value: GovernanceEventRecordV0 } | { ok: false; errors: string[] } {
  const record = asRecord(value);
  if (!record) {
    return { ok: false, errors: ["governance event record must be an object"] };
  }

  const errors: string[] = [];
  if (record["schema"] !== "pluto.audit.governance-event") {
    errors.push("schema must be pluto.audit.governance-event");
  }
  if (record["schemaVersion"] !== 0) {
    errors.push("schemaVersion must be 0");
  }

  validateStringField(record, "eventId", errors);
  validateStringField(record, "eventType", errors);
  validateStringField(record, "createdAt", errors);
  validateStringArray(record["evidenceRefs"], "evidenceRefs", errors);
  validateNullableStringField(record, "reason", errors);

  if (typeof record["eventType"] === "string" && parseGovernanceEventTypeV0(record["eventType"]) === null) {
    errors.push("eventType must be a string");
  }

  const actor = asRecord(record["actor"]);
  if (!actor) {
    errors.push("actor must be an object");
  } else {
    validateStringField(actor, "principalId", errors);
    if (actor["roleLabels"] !== undefined) {
      validateStringArray(actor["roleLabels"], "actor.roleLabels", errors);
    }
  }

  const target = asRecord(record["target"]);
  if (!target) {
    errors.push("target must be an object");
  } else {
    validateStringField(target, "kind", errors);
    validateStringField(target, "recordId", errors);
    for (const field of [
      "workspaceId",
      "documentId",
      "versionId",
      "requestId",
      "packageId",
      "candidateId",
      "gateId",
      "attemptId",
      "targetId",
    ]) {
      if (target[field] !== undefined && typeof target[field] !== "string") {
        errors.push(`target.${field} must be a string when present`);
      }
    }
  }

  const status = asRecord(record["status"]);
  if (!status) {
    errors.push("status must be an object");
  } else {
    validateNullableStringField(status, "before", errors);
    validateNullableStringField(status, "after", errors);
    validateStringField(status, "summary", errors);
  }

  const source = asRecord(record["source"]);
  if (!source) {
    errors.push("source must be an object");
  } else {
    validateStringField(source, "command", errors);
    validateNullableStringField(source, "ref", errors);
  }

  return errors.length === 0
    ? { ok: true, value: value as GovernanceEventRecordV0 }
    : { ok: false, errors };
}
