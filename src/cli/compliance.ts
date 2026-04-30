#!/usr/bin/env node
import process from "node:process";

import { createAuditExportV0 } from "../compliance/audit-export.js";
import { ComplianceStore } from "../compliance/compliance-store.js";
import {
  toGovernedDocumentRefV0,
  toGovernedPublishPackageRefV0,
  toGovernedVersionRefV0,
} from "../contracts/compliance.js";
import { GovernanceStore } from "../governance/governance-store.js";
import { PublishStore } from "../publish/publish-store.js";

function usage(): never {
  console.error(`Usage:
  pnpm compliance export <publishPackageId> [--manifest-id <id>] [--actor <id>] [--json]
  pnpm compliance list <retention_policy|legal_hold|deletion_attempt|evidence|audit_export_manifest|events> [--json]
  pnpm compliance show [<retention_policy|legal_hold|deletion_attempt|evidence|audit_export_manifest|event>] <id> [--json]`);
  process.exit(1);
}

function fail(message: string): never {
  console.error(`Error: ${message}`);
  process.exit(1);
}

function parseArgs(argv: string[]): {
  subcommand: string;
  positional: string[];
  flags: Record<string, string | boolean>;
} {
  const subcommand = argv[0] ?? "";
  const positional: string[] = [];
  const flags: Record<string, string | boolean> = {};

  for (let i = 1; i < argv.length; i++) {
    const arg = argv[i]!;
    if (arg.startsWith("--")) {
      const key = arg.slice(2);
      const next = argv[i + 1];
      if (next && !next.startsWith("--")) {
        flags[key] = next;
        i++;
      } else {
        flags[key] = true;
      }
      continue;
    }

    positional.push(arg);
  }

  return { subcommand, positional, flags };
}

function now(): string {
  return process.env["PLUTO_NOW"] ?? new Date().toISOString();
}

function matchesRecordId(
  targetRef: { stableId?: string; documentId?: string; versionId?: string; packageId?: string },
  ids: { documentId: string; versionId: string; packageId: string },
): boolean {
  return targetRef.stableId === ids.documentId
    || targetRef.stableId === ids.versionId
    || targetRef.stableId === ids.packageId
    || targetRef.documentId === ids.documentId
    || targetRef.versionId === ids.versionId
    || targetRef.packageId === ids.packageId;
}

export async function handleComplianceExport(
  governanceStore: GovernanceStore,
  publishStore: PublishStore,
  complianceStore: ComplianceStore,
  publishPackageId: string | undefined,
  options: {
    manifestId?: string;
    actorId?: string;
    jsonMode?: boolean;
  } = {},
): Promise<void> {
  if (!publishPackageId) {
    fail("Missing <publishPackageId> argument for 'export'");
  }

  const publishPackage = await publishStore.getPublishPackage(publishPackageId);
  if (!publishPackage) {
    fail(`publish package not found: ${publishPackageId}`);
  }

  const [document, version] = await Promise.all([
    governanceStore.get("document", publishPackage.documentId),
    governanceStore.get("version", publishPackage.versionId),
  ]);

  if (!document) {
    fail(`document not found for publish package: ${publishPackage.documentId}`);
  }
  if (!version) {
    fail(`version not found for publish package: ${publishPackage.versionId}`);
  }

  const ids = {
    documentId: document.id,
    versionId: version.id,
    packageId: publishPackage.id,
  };
  const [retentionPolicies, legalHolds, evidence, priorEvents] = await Promise.all([
    complianceStore.list("retention_policy"),
    complianceStore.list("legal_hold"),
    complianceStore.list("evidence"),
    complianceStore.listEvents({ targetRecordId: publishPackage.id }),
  ]);

  const relevantPolicies = retentionPolicies.filter((policy) =>
    policy.governedRefs.some((ref) => matchesRecordId(ref, ids))
  );
  const relevantHolds = legalHolds.filter((hold) =>
    hold.governedRefs.some((ref) => matchesRecordId(ref, ids))
  );
  const relevantEvidence = evidence.filter((record) => matchesRecordId(record.subjectRef, ids));
  const evidenceRefs = [
    ...relevantEvidence.map((record) => record.id),
    ...relevantEvidence.flatMap((record) => record.evidenceRefs),
    ...publishPackage.sealedEvidenceRefs,
  ];

  const manifestId = options.manifestId ?? `audit-export-${publishPackage.id}`;
  const createdAt = now();
  const result = await createAuditExportV0({
    store: complianceStore,
    manifestId,
    workspaceId: publishPackage.workspaceId,
    createdById: options.actorId ?? "compliance-cli",
    createdAt,
    governedChain: [
      toGovernedDocumentRefV0({
        documentId: document.id,
        workspaceId: document.workspaceId,
        summary: document.title,
      }),
      toGovernedVersionRefV0({
        documentId: document.id,
        versionId: version.id,
        workspaceId: version.workspaceId,
        summary: version.label,
      }),
      toGovernedPublishPackageRefV0({
        id: publishPackage.id,
        documentId: publishPackage.documentId,
        versionId: publishPackage.versionId,
        workspaceId: publishPackage.workspaceId,
        summary: `Publish package for ${document.title}`,
      }),
    ],
    selectedContentRange: {
      startRef: document.id,
      endRef: publishPackage.id,
      itemCount: 3,
      summary: `Governed release chain for ${document.title}`,
    },
    evidenceRefs,
    complianceEvents: priorEvents.map((event) => ({ id: event.id })),
    retentionPolicies: relevantPolicies.map((policy) => ({ id: policy.id, summary: policy.summary })),
    legalHolds: relevantHolds.map((hold) => ({ id: hold.id, summary: hold.summary })),
    recipient: { name: "Local compliance export" },
    sourceCommand: "cli.compliance.export",
  });

  if (!result.ok) {
    fail(result.errors.join("; "));
  }

  const output = {
    schemaVersion: 0,
    manifest: result.manifest,
    generatedEvent: result.generatedEvent,
  };

  if (options.jsonMode) {
    console.log(JSON.stringify(output, null, 2));
    return;
  }

  console.log(`Manifest: ${result.manifest.id}`);
  console.log(`Status: ${result.manifest.status}`);
  console.log(`Checksum: ${result.manifest.checksumSummary.digest}`);
  console.log(`Evidence refs: ${result.manifest.evidenceRefs.join(", ") || "none"}`);
  console.log(`Compliance events: ${result.manifest.complianceEventRefs.join(", ")}`);
}

export async function handleComplianceList(
  complianceStore: ComplianceStore,
  kind: string | undefined,
  jsonMode: boolean,
): Promise<void> {
  const normalizedKind = normalizeComplianceReadKind(kind);
  if (!normalizedKind) {
    fail(`Unknown compliance list kind: ${kind ?? ""}`);
  }

  if (normalizedKind === "events") {
    const events = await complianceStore.listEvents();
    if (jsonMode) {
      console.log(JSON.stringify({ schemaVersion: 0, kind: normalizedKind, items: events }, null, 2));
      return;
    }

    if (events.length === 0) {
      console.log("No compliance events found.");
      return;
    }

    for (const event of events) {
      console.log(`${event.id} ${event.action} ${event.target.kind}:${event.target.recordId}`);
    }
    return;
  }

  const items = await complianceStore.list(normalizedKind);
  if (jsonMode) {
    console.log(JSON.stringify({ schemaVersion: 0, kind: normalizedKind, items }, null, 2));
    return;
  }

  if (items.length === 0) {
    console.log(`No ${normalizedKind} records found.`);
    return;
  }

  for (const item of items) {
    console.log(`${item.id} ${describeComplianceRecordStatus(item)} ${describeComplianceRecordSummary(item)}`);
  }
}

export async function handleComplianceShow(
  complianceStore: ComplianceStore,
  kindOrId: string | undefined,
  maybeId: string | undefined,
  jsonMode: boolean,
): Promise<void> {
  const explicitEventShow = kindOrId === "event" || kindOrId === "events";
  const normalizedKind = explicitEventShow ? "events" : normalizeComplianceReadKind(kindOrId);
  const legacyManifestId = normalizedKind === null ? kindOrId : undefined;
  const id = explicitEventShow ? maybeId : normalizedKind === null ? legacyManifestId : maybeId;

  if (!id) {
    fail("Missing <id> argument for 'show'");
  }

  if (normalizedKind === "events" || kindOrId === "event") {
    const event = await complianceStore.getEvent(id);
    if (!event) {
      fail(`compliance event not found: ${id}`);
    }

    if (jsonMode) {
      console.log(JSON.stringify({ schemaVersion: 0, event }, null, 2));
      return;
    }

    console.log(`Event: ${event.id}`);
    console.log(`Action: ${event.action}`);
    console.log(`Target: ${event.target.kind}:${event.target.recordId}`);
    console.log(`Reason: ${event.reason ?? "none"}`);
    return;
  }

  const recordKind = normalizedKind ?? "audit_export_manifest";
  const record = await complianceStore.get(recordKind, id);
  if (!record) {
    fail(`${recordKind} not found: ${id}`);
  }

  const events = await complianceStore.listEvents({ targetRecordId: id });

  const output = {
    schemaVersion: 0,
    kind: recordKind,
    record,
    events,
  };

  if (jsonMode) {
    console.log(JSON.stringify(output, null, 2));
    return;
  }

  console.log(`${recordKind === "audit_export_manifest" ? "Manifest" : "Record"}: ${record.id}`);
  console.log(`Kind: ${recordKind}`);
  console.log(`Status: ${describeComplianceRecordStatus(record)}`);
  if (record.schema === "pluto.compliance.audit-export-manifest") {
    console.log(`Targets: ${record.governedChain.map((ref) => `${ref.kind}:${ref.stableId}`).join(", ")}`);
    console.log(`Evidence refs: ${record.evidenceRefs.join(", ") || "none"}`);
  }
  if (record.schema === "pluto.compliance.evidence") {
    console.log(`Target: ${record.subjectRef.kind}:${record.subjectRef.stableId}`);
    console.log(`Evidence refs: ${record.evidenceRefs.join(", ") || "none"}`);
  }
  if (record.schema === "pluto.compliance.deletion-attempt") {
    console.log(`Target: ${record.targetRef.kind}:${record.targetRef.stableId}`);
    console.log(`Block reason: ${record.blockReason ?? "none"}`);
  }
  console.log(`Events: ${events.map((event) => event.id).join(", ") || "none"}`);
}

function describeComplianceRecordStatus(
  record: Awaited<ReturnType<ComplianceStore["get"]>> extends infer T ? Exclude<T, null> : never,
): string {
  switch (record.schema) {
    case "pluto.compliance.deletion-attempt":
      return record.outcome;
    case "pluto.compliance.evidence":
      return record.validationOutcome;
    default:
      return record.status;
  }
}

function describeComplianceRecordSummary(
  record: Awaited<ReturnType<ComplianceStore["get"]>> extends infer T ? Exclude<T, null> : never,
): string {
  switch (record.schema) {
    case "pluto.compliance.audit-export-manifest":
      return `targets=${record.governedChain.length} evidence=${record.evidenceRefs.length}`;
    default:
      return record.summary;
  }
}

function normalizeComplianceReadKind(kind: string | undefined): "retention_policy" | "legal_hold" | "deletion_attempt" | "evidence" | "audit_export_manifest" | "events" | null {
  switch (kind) {
    case "retention_policy":
    case "legal_hold":
    case "deletion_attempt":
    case "evidence":
    case "audit_export_manifest":
    case "events":
      return kind;
    default:
      return null;
  }
}

async function main(): Promise<void> {
  const dataDir = process.env["PLUTO_DATA_DIR"] ?? ".pluto";
  const governanceStore = new GovernanceStore({ dataDir });
  const publishStore = new PublishStore({ dataDir });
  const complianceStore = new ComplianceStore({ dataDir });
  const { subcommand, positional, flags } = parseArgs(process.argv.slice(2));

  if (!subcommand) usage();

  const jsonMode = flags["json"] === true;
  switch (subcommand) {
    case "export":
      return handleComplianceExport(governanceStore, publishStore, complianceStore, positional[0], {
        manifestId: typeof flags["manifest-id"] === "string" ? flags["manifest-id"] : undefined,
        actorId: typeof flags["actor"] === "string" ? flags["actor"] : undefined,
        jsonMode,
      });
    case "list":
      return handleComplianceList(complianceStore, positional[0], jsonMode);
    case "show":
      return handleComplianceShow(complianceStore, positional[0], positional[1], jsonMode);
    default:
      fail(`Unknown subcommand: ${subcommand}`);
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack : String(error));
  process.exitCode = 1;
});
