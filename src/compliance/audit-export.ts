import { createHash } from "node:crypto";

import type {
  AuditExportManifestV0,
  ComplianceActionEventV0,
  ComplianceGovernedObjectRefV0,
  LegalHoldV0,
  RetentionPolicyV0,
} from "../contracts/compliance.js";
import {
  validateAuditExportManifestV0,
  validateComplianceActionEventV0,
} from "../contracts/compliance.js";

import type {
  ComplianceActionEventV0 as StoredComplianceActionEventV0,
  ComplianceStore,
  ComplianceTargetRefV0,
} from "./compliance-store.js";

export interface AuditExportSelectedContentRangeV0 {
  startRef: string;
  endRef: string;
  itemCount: number;
  summary: string;
}

export type AuditExportManifestRecordV0 = AuditExportManifestV0 & {
  selectedContentRange: AuditExportSelectedContentRangeV0;
};

export interface CreateAuditExportInputV0 {
  store: ComplianceStore;
  manifestId: string;
  workspaceId: string;
  createdById: string;
  createdAt: string;
  governedChain: readonly ComplianceGovernedObjectRefV0[];
  selectedContentRange: AuditExportSelectedContentRangeV0;
  evidenceRefs?: readonly string[];
  complianceEvents?: readonly Pick<ComplianceActionEventV0, "id">[];
  retentionPolicies?: readonly Pick<RetentionPolicyV0, "id" | "summary">[];
  legalHolds?: readonly Pick<LegalHoldV0, "id" | "summary">[];
  recipient?: {
    name: string;
    deliveryMethod?: string;
    destination?: string | null;
  };
  sealId?: string;
  generatedEventId?: string;
  blockedEventId?: string;
  sourceCommand?: string;
}

export type CreateAuditExportResultV0 =
  | {
      ok: true;
      manifest: AuditExportManifestRecordV0;
      generatedEvent: ComplianceActionEventV0;
    }
  | {
      ok: false;
      blockerEvent: ComplianceActionEventV0;
      errors: string[];
    };

export async function createAuditExportV0(input: CreateAuditExportInputV0): Promise<CreateAuditExportResultV0> {
  const chainErrors = validateGovernedChain(input.governedChain);
  const rangeErrors = validateSelectedContentRange(input.selectedContentRange, input.governedChain);
  const errors = [...chainErrors, ...rangeErrors];

  if (errors.length > 0) {
    const blockerEvent = buildAuditExportEvent({
      eventId: input.blockedEventId ?? `${input.manifestId}:blocked`,
      workspaceId: input.workspaceId,
      actorId: input.createdById,
      occurredAt: input.createdAt,
      subjectRef: input.governedChain.at(-1) ?? fallbackSubjectRef(input),
      recordId: input.manifestId,
      evidenceRefs: input.evidenceRefs ?? [],
      outcome: "blocked",
      summary: `Blocked local-only audit export: ${errors.join("; ")}`,
    });

    await input.store.recordEvent(toStoredEventRecord(blockerEvent, input.sourceCommand ?? "compliance.audit-export"));
    return { ok: false, blockerEvent, errors };
  }

  const recipient = normalizeRecipient(input.recipient);
  const generatedEventId = input.generatedEventId ?? `${input.manifestId}:generated`;
  const complianceEventRefs = uniqueStrings([...(input.complianceEvents?.map((event) => event.id) ?? []), generatedEventId]);
  const evidenceRefs = uniqueStrings(input.evidenceRefs ?? []);
  const subjectRef = input.governedChain.at(-1) ?? fallbackSubjectRef(input);

  const manifest: AuditExportManifestRecordV0 = {
    schema: "pluto.compliance.audit-export-manifest",
    schemaVersion: 0,
    id: input.manifestId,
    workspaceId: input.workspaceId,
    status: "generated",
    governedChain: [...input.governedChain],
    selectedContentRange: input.selectedContentRange,
    evidenceRefs,
    complianceEventRefs,
    createdById: input.createdById,
    createdAt: input.createdAt,
    retentionSummary: {
      policyIds: uniqueStrings(input.retentionPolicies?.map((policy) => policy.id) ?? []),
      summary: summarizeRetention(input.retentionPolicies ?? []),
    },
    holdSummary: {
      holdIds: uniqueStrings(input.legalHolds?.map((hold) => hold.id) ?? []),
      summary: summarizeHolds(input.legalHolds ?? []),
    },
    checksumSummary: {
      algorithm: "sha256",
      digest: createManifestDigest({
        workspaceId: input.workspaceId,
        governedChain: input.governedChain,
        selectedContentRange: input.selectedContentRange,
        evidenceRefs,
        complianceEventRefs,
        recipient,
      }),
    },
    recipient,
    localSignature: {
      status: "signed",
      signedAt: input.createdAt,
      sealId: input.sealId ?? `local-v0:${input.manifestId}`,
    },
  };

  const manifestValidation = validateAuditExportManifestV0(manifest);
  if (!manifestValidation.ok) {
    throw new Error(`Invalid audit export manifest: ${manifestValidation.errors.join(", ")}`);
  }

  const generatedEvent = buildAuditExportEvent({
    eventId: generatedEventId,
    workspaceId: input.workspaceId,
    actorId: input.createdById,
    occurredAt: input.createdAt,
    subjectRef,
    recordId: manifest.id,
    evidenceRefs,
    outcome: "generated",
    summary: buildGeneratedSummary(manifest),
  });

  await input.store.put("audit_export_manifest", manifest);
  await input.store.recordEvent(toStoredEventRecord(generatedEvent, input.sourceCommand ?? "compliance.audit-export"));

  return {
    ok: true,
    manifest,
    generatedEvent,
  };
}

function buildAuditExportEvent(input: {
  eventId: string;
  workspaceId: string;
  actorId: string;
  occurredAt: string;
  subjectRef: ComplianceGovernedObjectRefV0;
  recordId: string;
  evidenceRefs: readonly string[];
  outcome: string;
  summary: string;
}): ComplianceActionEventV0 {
  const event: ComplianceActionEventV0 = {
    schema: "pluto.compliance.action-event",
    schemaVersion: 0,
    id: input.eventId,
    workspaceId: input.workspaceId,
    action: "audit_export_generated",
    outcome: input.outcome,
    actorId: input.actorId,
    subjectRef: input.subjectRef,
    recordId: input.recordId,
    evidenceRefs: uniqueStrings(input.evidenceRefs),
    occurredAt: input.occurredAt,
    summary: input.summary,
  };

  const validation = validateComplianceActionEventV0(event);
  if (!validation.ok) {
    throw new Error(`Invalid audit export event: ${validation.errors.join(", ")}`);
  }

  return event;
}

function validateGovernedChain(chain: readonly ComplianceGovernedObjectRefV0[]): string[] {
  if (chain.length === 0) {
    return ["governed chain must include at least one record"];
  }

  const errors: string[] = [];
  const byKind = new Map<string, ComplianceGovernedObjectRefV0[]>();
  const indexes = new Map<string, number>();

  chain.forEach((ref, index) => {
    const existing = byKind.get(ref.kind) ?? [];
    existing.push(ref);
    byKind.set(ref.kind, existing);
    indexes.set(ref.stableId, index);
  });

  for (const ref of chain) {
    if (ref.kind === "version" || ref.kind === "review" || ref.kind === "approval" || ref.kind === "publish_package") {
      const parent = findDocumentRef(chain, ref.documentId);
      if (!parent) {
        errors.push(`${ref.kind}:${ref.stableId} is missing document:${ref.documentId}`);
      } else if ((indexes.get(parent.stableId) ?? -1) >= (indexes.get(ref.stableId) ?? 0)) {
        errors.push(`${ref.kind}:${ref.stableId} must appear after document:${ref.documentId}`);
      }
    }

    if (ref.kind === "review" || ref.kind === "approval" || ref.kind === "publish_package") {
      const parent = findVersionRef(chain, ref.documentId, ref.versionId);
      if (!parent) {
        errors.push(`${ref.kind}:${ref.stableId} is missing version:${ref.versionId}`);
      } else if ((indexes.get(parent.stableId) ?? -1) >= (indexes.get(ref.stableId) ?? 0)) {
        errors.push(`${ref.kind}:${ref.stableId} must appear after version:${ref.versionId}`);
      }
    }
  }

  return uniqueStrings(errors);
}

function validateSelectedContentRange(
  range: AuditExportSelectedContentRangeV0,
  chain: readonly ComplianceGovernedObjectRefV0[],
): string[] {
  const ids = new Set(chain.map((ref) => ref.stableId));
  const errors: string[] = [];

  if (!ids.has(range.startRef)) {
    errors.push(`selected content range startRef is missing from governed chain: ${range.startRef}`);
  }
  if (!ids.has(range.endRef)) {
    errors.push(`selected content range endRef is missing from governed chain: ${range.endRef}`);
  }
  if (!Number.isInteger(range.itemCount) || range.itemCount <= 0) {
    errors.push("selected content range itemCount must be a positive integer");
  }
  if (range.summary.trim().length === 0) {
    errors.push("selected content range summary must be non-empty");
  }

  return errors;
}

function findDocumentRef(
  chain: readonly ComplianceGovernedObjectRefV0[],
  documentId: string,
): ComplianceGovernedObjectRefV0 | undefined {
  return chain.find((ref) => ref.kind === "document" && ref.documentId === documentId);
}

function findVersionRef(
  chain: readonly ComplianceGovernedObjectRefV0[],
  documentId: string,
  versionId: string,
): ComplianceGovernedObjectRefV0 | undefined {
  return chain.find(
    (ref) => ref.kind === "version" && ref.documentId === documentId && ref.versionId === versionId,
  );
}

function summarizeRetention(policies: readonly Pick<RetentionPolicyV0, "id" | "summary">[]): string {
  if (policies.length === 0) {
    return "No retention policies were attached to this local-only audit export.";
  }

  return policies.map((policy) => policy.summary.trim() || policy.id).join(" ");
}

function summarizeHolds(holds: readonly Pick<LegalHoldV0, "id" | "summary">[]): string {
  if (holds.length === 0) {
    return "No legal holds were attached to this local-only audit export.";
  }

  return holds.map((hold) => hold.summary.trim() || hold.id).join(" ");
}

function normalizeRecipient(recipient: CreateAuditExportInputV0["recipient"]): AuditExportManifestV0["recipient"] {
  const deliveryMethod = recipient?.deliveryMethod?.trim() || "local_download";
  const destination = recipient?.destination?.trim();

  return {
    name: recipient?.name?.trim() || "Local audit export",
    deliveryMethod,
    destination: destination && !destination.includes("://") ? destination : null,
  };
}

function buildGeneratedSummary(manifest: AuditExportManifestRecordV0): string {
  return [
    `Generated local-only audit export manifest ${manifest.id}.`,
    `Selected range ${manifest.selectedContentRange.startRef}..${manifest.selectedContentRange.endRef}.`,
    `Included ${manifest.governedChain.length} governed records and ${manifest.evidenceRefs.length} evidence refs.`,
  ].join(" ");
}

function createManifestDigest(value: {
  workspaceId: string;
  governedChain: readonly ComplianceGovernedObjectRefV0[];
  selectedContentRange: AuditExportSelectedContentRangeV0;
  evidenceRefs: readonly string[];
  complianceEventRefs: readonly string[];
  recipient: AuditExportManifestV0["recipient"];
}): string {
  return createHash("sha256").update(stableStringify(value)).digest("hex");
}

function stableStringify(value: unknown): string {
  return JSON.stringify(sortValue(value));
}

function sortValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((entry) => sortValue(entry));
  }

  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, entry]) => [key, sortValue(entry)]),
    );
  }

  return value;
}

function toStoredEventRecord(
  event: ComplianceActionEventV0,
  sourceCommand: string,
): StoredComplianceActionEventV0 {
  return {
    schema: "pluto.compliance.action-event",
    schemaVersion: 0,
    id: event.id,
    eventType: `compliance.${event.action}`,
    action: event.action,
    actor: {
      principalId: event.actorId,
      roleLabels: ["compliance"],
    },
    target: toStoredTargetRef(event.subjectRef, event.recordId ?? event.subjectRef.stableId),
    status: {
      before: null,
      after: event.outcome,
      summary: event.summary,
    },
    evidenceRefs: event.evidenceRefs,
    reason: event.outcome === "blocked" ? event.summary : null,
    createdAt: event.occurredAt,
    source: {
      command: sourceCommand,
      ref: event.recordId,
    },
  };
}

function toStoredTargetRef(
  ref: ComplianceGovernedObjectRefV0,
  recordId: string = ref.stableId,
): ComplianceTargetRefV0 {
  switch (ref.kind) {
    case "document":
      return {
        kind: ref.kind,
        recordId,
        workspaceId: ref.workspaceId,
        documentId: ref.documentId,
        summary: ref.summary,
      };
    case "version":
      return {
        kind: ref.kind,
        recordId,
        workspaceId: ref.workspaceId,
        documentId: ref.documentId,
        versionId: ref.versionId,
        summary: ref.summary,
      };
    case "review":
      return {
        kind: ref.kind,
        recordId,
        workspaceId: ref.workspaceId,
        documentId: ref.documentId,
        versionId: ref.versionId,
        summary: ref.summary,
      };
    case "approval":
      return {
        kind: ref.kind,
        recordId,
        workspaceId: ref.workspaceId,
        documentId: ref.documentId,
        versionId: ref.versionId,
        summary: ref.summary,
      };
    case "publish_package":
      return {
        kind: ref.kind,
        recordId,
        workspaceId: ref.workspaceId,
        documentId: ref.documentId,
        versionId: ref.versionId,
        packageId: ref.packageId,
        summary: ref.summary,
      };
    case "sealed_evidence":
      return {
        kind: ref.kind,
        recordId,
        workspaceId: ref.workspaceId,
        summary: ref.summary,
      };
  }
}

function fallbackSubjectRef(input: Pick<CreateAuditExportInputV0, "workspaceId">): ComplianceGovernedObjectRefV0 {
  return {
    schemaVersion: 0,
    kind: "document",
    stableId: "audit-export",
    workspaceId: input.workspaceId,
    documentId: "audit-export",
    summary: "Audit export placeholder subject",
  };
}

function uniqueStrings(values: readonly string[]): string[] {
  return [...new Set(values.filter((value) => value.trim().length > 0))];
}
