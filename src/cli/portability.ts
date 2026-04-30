#!/usr/bin/env node
import { createHash } from "node:crypto";
import process from "node:process";

import { CatalogStore } from "../catalog/catalog-store.js";
import { evaluateDeletionDecisionFromStoreV0 } from "../compliance/deletion-decision.js";
import { ComplianceStore } from "../compliance/compliance-store.js";
import type { GovernedObjectRefV0 } from "../contracts/compliance.js";
import type {
  EvidenceSummaryExportV0,
  PortableAssetBundleV0,
  PortableAssetExportV0,
  PortableAssetLogicalRefV0,
  PortableCompatibilityMetadataV0,
  PortableChecksumV0,
  RedactionSummaryV0,
} from "../contracts/portability.js";
import { EvidenceGraphStore } from "../evidence/evidence-graph.js";
import { GovernanceStore } from "../governance/governance-store.js";
import { PortableBundleStore } from "../portability/bundle-store.js";
import { resolvePortabilityConflictV0 } from "../portability/conflicts.js";
import { validatePortableBundleImportV0 } from "../portability/import-validator.js";
import { DEFAULT_BUNDLE_TARGET, sealPortableBundleV0 } from "../portability/seal.js";
import { PublishStore } from "../publish/publish-store.js";

function usage(): never {
  console.error(`Usage:
  pnpm portability export <manifestId> [--bundle-id <id>] [--template-id <id>] [--json]
  pnpm portability list [--json]
  pnpm portability show <bundleId> [--json]
  pnpm portability validate <bundleId> [--secret-name <name>] [--capability <ref>] [--allowed-sensitivity <class>] [--resolved-ref <ref>] [--policy allow|deny:<reason>] [--json]
  pnpm portability conflicts <bundleId> [--asset-logical-id <id>] [--existing-kind <kind>] [--existing-logical-id <id>] [--existing-status <status>] [--resolution duplicate|fork|map|reject] [--json]`);
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

function checksum(value: unknown): PortableChecksumV0 {
  return {
    algorithm: "sha256",
    digest: createHash("sha256").update(JSON.stringify(value)).digest("hex"),
  };
}

function redactionSummary(summary: string): RedactionSummaryV0 {
  return {
    schema: "pluto.portability.redaction-summary",
    schemaVersion: 0,
    redactedFields: ["workspaceId"],
    redactedRefKinds: ["principal"],
    excludedContent: ["provider_payloads"],
    summary,
  };
}

function compatibilityMetadata(writtenAt: string): PortableCompatibilityMetadataV0 {
  return {
    schemaVersion: 0,
    bundle: {
      family: "pluto.portability.bundle",
      version: 0,
      writtenAt,
    },
    target: DEFAULT_BUNDLE_TARGET,
    dependencies: [],
  };
}

function documentLogicalRef(documentId: string, versionId: string): PortableAssetLogicalRefV0 {
  return {
    kind: "document",
    logicalId: `document:${documentId}`,
    sourceDocumentId: documentId,
    sourceVersionId: versionId,
  };
}

function packageLogicalRef(documentId: string, versionId: string, packageId: string): PortableAssetLogicalRefV0 {
  return {
    kind: "publish_package",
    logicalId: `publish-package:${packageId}`,
    sourceDocumentId: documentId,
    sourceVersionId: versionId,
    sourcePublishPackageId: packageId,
  };
}

function evidenceLogicalRef(evidenceId: string): PortableAssetLogicalRefV0 {
  return {
    kind: "evidence_summary",
    logicalId: `evidence:${evidenceId}`,
  };
}

function templateLogicalRef(templateId: string): PortableAssetLogicalRefV0 {
  return {
    kind: "template",
    logicalId: `template:${templateId}`,
    sourceTemplateId: templateId,
  };
}

export async function handlePortabilityExport(
  catalogStore: CatalogStore,
  governanceStore: GovernanceStore,
  publishStore: PublishStore,
  complianceStore: ComplianceStore,
  evidenceStore: EvidenceGraphStore,
  bundleStore: PortableBundleStore,
  manifestId: string | undefined,
  options: {
    bundleId?: string;
    templateId?: string;
    jsonMode?: boolean;
  } = {},
): Promise<void> {
  if (!manifestId) {
    fail("Missing <manifestId> argument for 'export'");
  }

  const manifest = await complianceStore.get("audit_export_manifest", manifestId);
  if (!manifest) {
    fail(`audit export manifest not found: ${manifestId}`);
  }

  const documentRef = manifest.governedChain.find((ref) => ref.kind === "document");
  const versionRef = manifest.governedChain.find((ref) => ref.kind === "version");
  const packageRef = manifest.governedChain.find((ref) => ref.kind === "publish_package");
  if (!documentRef?.documentId || !versionRef?.versionId || !packageRef?.packageId) {
    fail(`audit export manifest is incomplete: ${manifestId}`);
  }

  const [document, version, publishPackage, citations, sealedEvidenceRefs, template] = await Promise.all([
    governanceStore.get("document", documentRef.documentId),
    governanceStore.get("version", versionRef.versionId),
    publishStore.getPublishPackage(packageRef.packageId),
    evidenceStore.listCitationRefs(),
    evidenceStore.listSealedEvidenceRefs(),
    options.templateId ? catalogStore.read("templates", options.templateId) : Promise.resolve(null),
  ]);

  if (!document) {
    fail(`document not found for manifest: ${documentRef.documentId}`);
  }
  if (!version) {
    fail(`version not found for manifest: ${versionRef.versionId}`);
  }
  if (!publishPackage) {
    fail(`publish package not found for manifest: ${packageRef.packageId}`);
  }
  if (options.templateId && !template) {
    fail(`template not found for portability export: ${options.templateId}`);
  }

  const exportedAt = now();
  const bundleId = options.bundleId ?? `portable-${manifest.id}`;
  const compatibility = compatibilityMetadata(exportedAt);
  const assetRedaction = redactionSummary("Workspace-private fields removed from portability export.");
  const ids = { documentId: document.id, versionId: version.id, packageId: publishPackage.id };
  const selectedEvidence = sealedEvidenceRefs.filter((record) => manifest.evidenceRefs.includes(record.id));

  const documentAsset = {
    schema: "pluto.portability.document-export" as const,
    schemaVersion: 0 as const,
    kind: "document" as const,
    id: `${bundleId}:document:${document.id}`,
    logicalRef: documentLogicalRef(document.id, version.id),
    title: document.title,
    createdAt: document.createdAt,
    exportedAt,
    workflowRefs: [],
    compatibility,
    checksum: checksum({ documentId: document.id, versionId: version.id, title: document.title, label: version.label }),
    redactionSummary: assetRedaction,
    content: {
      format: "markdown" as const,
      body: `# ${document.title}\n\nVersion: ${version.label}\n\nPortable compliance export generated locally.`,
    },
    metadata: {
      label: version.label,
      tags: ["governance", "compliance-export"],
      lineageRefs: [manifest.id, publishPackage.id],
    },
  };

  const packageAsset = {
    schema: "pluto.portability.publish-package-export" as const,
    schemaVersion: 0 as const,
    kind: "publish_package" as const,
    id: `${bundleId}:package:${publishPackage.id}`,
    logicalRef: packageLogicalRef(document.id, version.id, publishPackage.id),
    title: `Publish package ${publishPackage.id}`,
    createdAt: publishPackage.createdAt,
    exportedAt,
    workflowRefs: [],
    compatibility,
    checksum: checksum({
      packageId: publishPackage.id,
      channelTargets: publishPackage.channelTargets,
      sourceVersionRefs: publishPackage.sourceVersionRefs,
      sealedEvidenceRefs: publishPackage.sealedEvidenceRefs,
    }),
    redactionSummary: assetRedaction,
    publishPackage: {
      channelTargets: publishPackage.channelTargets.map((target) => ({
        channelId: target.channelId,
        targetId: target.targetId,
        status: target.status,
        destinationSummary: target.destinationSummary,
      })),
      sourceVersionRefs: publishPackage.sourceVersionRefs.map((ref) => `${ref.documentId}:${ref.versionId}`),
      sealedEvidenceRefs: publishPackage.sealedEvidenceRefs.filter((ref) => manifest.evidenceRefs.includes(ref)),
    },
  };

  const evidenceAssets: EvidenceSummaryExportV0[] = selectedEvidence.map((record) => ({
    schema: "pluto.portability.evidence-summary-export",
    schemaVersion: 0,
    kind: "evidence_summary",
    id: `${bundleId}:evidence:${record.id}`,
    logicalRef: evidenceLogicalRef(record.id),
    title: `Evidence ${record.id}`,
    createdAt: record.sealedAt,
    exportedAt,
    workflowRefs: [],
    compatibility,
    checksum: checksum({ id: record.id, sealChecksum: record.sealChecksum, sealedAt: record.sealedAt }),
    redactionSummary: redactionSummary("Runtime-private evidence details were removed from the portable summary."),
    evidence: {
      sealedEvidenceId: record.id,
      citationRefs: citations
        .filter((citation) => citation.sealedEvidenceId === record.id)
        .map((citation) => ({
          citationId: citation.id,
          citationKind: citation.citationKind,
          locator: citation.locator,
          summary: citation.summary,
        })),
      validation: {
        outcome: record.validationSummary.outcome,
        reason: record.validationSummary.reason,
      },
      readiness: {
        status: record.redactionSummary.redactedAt ? "ready" : "blocked",
        blockedReasons: record.redactionSummary.redactedAt ? [] : ["redaction_missing"],
        summary: record.redactionSummary.redactedAt
          ? "Evidence summary is redacted and ready for export."
          : "Evidence summary cannot be exported until redaction is present.",
      },
    },
  }));

  const templateAsset = template
    ? {
        schema: "pluto.portability.template-export" as const,
        schemaVersion: 0 as const,
        kind: "template" as const,
        id: `${bundleId}:template:${template.id}`,
        logicalRef: templateLogicalRef(template.id),
        title: template.name,
        createdAt: template.versionMetadata.updatedAt,
        exportedAt,
        workflowRefs: [],
        compatibility,
        checksum: checksum({
          templateId: template.id,
          version: template.version,
          body: template.body,
          format: template.format,
          variables: template.variables,
        }),
        redactionSummary: assetRedaction,
        template: {
          body: template.body,
          variables: template.variables.map((variable) => variable.name),
          outputFormat: template.format,
        },
        metadata: {
          category: template.targetKind,
          lineageRefs: [manifest.id, template.id],
        },
      }
    : null;

  const assets: PortableAssetExportV0[] = [documentAsset, ...(templateAsset ? [templateAsset] : []), packageAsset, ...evidenceAssets];
  const bundle: PortableAssetBundleV0 = {
    schema: "pluto.portability.bundle",
    schemaVersion: 0,
    bundleId,
    manifest: {
      schema: "pluto.portability.manifest",
      schemaVersion: 0,
      bundleId,
      bundleVersion: "0.1.0",
      exportedAt,
      assetKinds: [...new Set(assets.map((asset) => asset.kind))],
      logicalRefs: assets.map((asset) => asset.logicalRef),
      workflowRefs: [],
      compatibility,
      checksums: assets.map((asset) => asset.checksum),
      importRequirements: [],
      redactionSummary: assetRedaction,
    },
    assets,
  };

  const sensitivityEntries = assets.map((asset) => ({ assetLogicalId: asset.logicalRef.logicalId, sensitivityClass: "internal" }));
  const exportTargets = await Promise.all(manifest.governedChain
    .map(async (ref) => ({
      ref,
      evaluation: await evaluateDeletionDecisionFromStoreV0({
        store: complianceStore,
        targetRef: ref,
        requestedAt: exportedAt,
        mode: "hard_delete",
      }),
    })));
  const holdBlockedIds = assets
    .filter((asset) => assetMatchesBlockedTarget(asset.logicalRef, exportTargets, "legal_hold"))
    .map((asset) => asset.logicalRef.logicalId);
  const retentionChecks = assets.map((asset) => ({
    assetLogicalId: asset.logicalRef.logicalId,
    blockingReasons: exportTargets
      .filter(({ evaluation }) => evaluation.retention.blockReason !== null)
      .filter(({ ref }) => assetMatchesGovernedTarget(asset.logicalRef, ref))
      .map(({ evaluation }) => evaluation.retention.blockReason as string),
  }));

  const sealed = sealPortableBundleV0(bundle, {
    authorization: { allowed: true },
    exportPolicy: { allowed: true },
    target: DEFAULT_BUNDLE_TARGET,
    sensitivity: {
      allowedClasses: ["internal"],
      assetClasses: sensitivityEntries,
    },
    retention: retentionChecks,
    legalHoldActiveLogicalIds: holdBlockedIds,
    prohibitedContentFindings: [],
  }, { sealedAt: exportedAt });

  if (!sealed.ok) {
    fail(sealed.errors.join("; "));
  }

  const record = await bundleStore.writeBundle(sealed.value);
  const output = {
    schemaVersion: 0,
    bundleRef: record.bundleRef,
    record,
  };

  if (options.jsonMode) {
    console.log(JSON.stringify(output, null, 2));
    return;
  }

  console.log(`Bundle: ${record.bundleId}`);
  console.log(`Ref: ${record.bundleRef}`);
  console.log(`Assets: ${record.sealedBundle.bundle.assets.length}`);
  console.log(`Manifest checksum: ${record.sealedBundle.seal.manifestChecksum.digest}`);
}

export async function handlePortabilityList(bundleStore: PortableBundleStore, jsonMode: boolean): Promise<void> {
  const items = await bundleStore.listBundles();
  if (jsonMode) {
    console.log(JSON.stringify({ schemaVersion: 0, items }, null, 2));
    return;
  }

  if (items.length === 0) {
    console.log("No portable bundles found.");
    return;
  }

  for (const item of items) {
    console.log(`${item.bundleId} ${item.sealedAt} ${item.manifestChecksum}`);
  }
}

export async function handlePortabilityShow(
  bundleStore: PortableBundleStore,
  bundleId: string | undefined,
  jsonMode: boolean,
): Promise<void> {
  if (!bundleId) {
    fail("Missing <bundleId> argument for 'show'");
  }

  const record = await bundleStore.readBundle(bundleId);
  if (!record) {
    fail(`portable bundle not found: ${bundleId}`);
  }

  const output = {
    schemaVersion: 0,
    record,
  };

  if (jsonMode) {
    console.log(JSON.stringify(output, null, 2));
    return;
  }

  console.log(`Bundle: ${record.bundleId}`);
  console.log(`Ref: ${record.bundleRef}`);
  console.log(`Sealed at: ${record.sealedBundle.seal.sealedAt}`);
  console.log(`Kinds: ${record.sealedBundle.bundle.manifest.assetKinds.join(", ")}`);
  console.log(`Manifest checksum: ${record.sealedBundle.seal.manifestChecksum.digest}`);
  console.log(`Redaction summary: ${record.sealedBundle.bundle.manifest.redactionSummary.summary}`);
}

export async function handlePortabilityValidate(
  bundleStore: PortableBundleStore,
  bundleId: string | undefined,
  flags: Record<string, string | boolean>,
  jsonMode: boolean,
): Promise<void> {
  if (!bundleId) {
    fail("Missing <bundleId> argument for 'validate'");
  }

  const record = await bundleStore.readBundle(bundleId);
  if (!record) {
    fail(`portable bundle not found: ${bundleId}`);
  }

  const bundle = record.sealedBundle.bundle;
  const allowedSensitivity = readCsvFlag(flags, "allowed-sensitivity", ["internal"]);
  const result = validatePortableBundleImportV0(bundle, {
    support: {
      schemaFamilies: [bundle.manifest.compatibility.bundle.family],
      schemaVersions: [bundle.manifest.compatibility.bundle.version],
      capabilityRefs: readCsvFlag(flags, "capability"),
      secretNames: readCsvFlag(flags, "secret-name"),
      allowedSensitivityClasses: allowedSensitivity,
      resolvedRefs: readCsvFlag(flags, "resolved-ref", collectBundleRefs(bundle)),
      policy: readPolicyFlag(flags["policy"]),
    },
    assetSensitivities: bundle.assets.map((asset) => ({
      assetLogicalId: asset.logicalRef.logicalId,
      sensitivityClass: allowedSensitivity[0] ?? "internal",
    })),
  });

  if (jsonMode) {
    console.log(JSON.stringify({ schemaVersion: 0, bundleId, ...result }, null, 2));
    return;
  }

  if (result.ok) {
    console.log(`Validation: ok for ${bundleId}`);
    return;
  }

  fail(result.errors.join("; "));
}

export async function handlePortabilityConflicts(
  bundleStore: PortableBundleStore,
  bundleId: string | undefined,
  flags: Record<string, string | boolean>,
  jsonMode: boolean,
): Promise<void> {
  if (!bundleId) {
    fail("Missing <bundleId> argument for 'conflicts'");
  }

  const record = await bundleStore.readBundle(bundleId);
  if (!record) {
    fail(`portable bundle not found: ${bundleId}`);
  }

  const assetLogicalId = typeof flags["asset-logical-id"] === "string" ? flags["asset-logical-id"] : undefined;
  const asset = assetLogicalId
    ? record.sealedBundle.bundle.assets.find((entry) => entry.logicalRef.logicalId === assetLogicalId)
    : record.sealedBundle.bundle.assets[0];
  if (!asset) {
    fail(assetLogicalId ? `bundle asset not found: ${assetLogicalId}` : `bundle has no assets: ${bundleId}`);
  }

  const conflict = resolvePortabilityConflictV0({
    incoming: asset.logicalRef,
    existing: {
      assetKind: (typeof flags["existing-kind"] === "string" ? flags["existing-kind"] : asset.kind) as typeof asset.kind,
      logicalId: typeof flags["existing-logical-id"] === "string" ? flags["existing-logical-id"] : asset.logicalRef.logicalId,
      status: typeof flags["existing-status"] === "string" ? flags["existing-status"] : "published",
    },
    resolution: typeof flags["resolution"] === "string" ? flags["resolution"] as "duplicate" | "fork" | "map" | "reject" : undefined,
  });

  if (jsonMode) {
    console.log(JSON.stringify({ schemaVersion: 0, bundleId, conflict }, null, 2));
    return;
  }

  console.log(`Conflict: ${conflict.code}`);
  console.log(`Outcome: ${conflict.outcome}`);
  console.log(`Resolution: ${conflict.resolution}`);
  console.log(conflict.message);
}

function readCsvFlag(flags: Record<string, string | boolean>, key: string, fallback: string[] = []): string[] {
  const value = flags[key];
  if (typeof value !== "string") {
    return [...fallback];
  }

  return value
    .split(",")
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
}

function readPolicyFlag(value: string | boolean | undefined): { allowed: boolean; reason?: string } {
  if (typeof value !== "string" || value === "allow") {
    return { allowed: true };
  }
  if (value.startsWith("deny:")) {
    return { allowed: false, reason: value.slice("deny:".length) || "import policy denied" };
  }
  if (value === "deny") {
    return { allowed: false, reason: "import policy denied" };
  }
  return { allowed: true };
}

function collectBundleRefs(bundle: PortableAssetBundleV0): string[] {
  const refs = new Set<string>();
  for (const workflowRef of bundle.manifest.workflowRefs) {
    refs.add(workflowRef.bundleRef);
  }
  for (const logicalRef of bundle.manifest.logicalRefs) {
    if (logicalRef.sourceDocumentId) {
      refs.add(`document:${logicalRef.sourceDocumentId}`);
    }
    if (logicalRef.sourceVersionId) {
      refs.add(`version:${logicalRef.sourceVersionId}`);
    }
    if (logicalRef.sourceTemplateId) {
      refs.add(`template:${logicalRef.sourceTemplateId}`);
    }
    if (logicalRef.sourcePublishPackageId) {
      refs.add(`publish_package:${logicalRef.sourcePublishPackageId}`);
    }
  }
  return [...refs];
}

function assetMatchesBlockedTarget(
  logicalRef: PortableAssetLogicalRefV0,
  targets: Array<{ ref: GovernedObjectRefV0; evaluation: Awaited<ReturnType<typeof evaluateDeletionDecisionFromStoreV0>> }>,
  blocker: "legal_hold",
): boolean {
  return targets.some(({ ref, evaluation }) => blocker === "legal_hold" && evaluation.legalHoldActive && assetMatchesGovernedTarget(logicalRef, ref));
}

function assetMatchesGovernedTarget(logicalRef: PortableAssetLogicalRefV0, ref: GovernedObjectRefV0): boolean {
  return logicalRef.sourceDocumentId === ("documentId" in ref ? ref.documentId : undefined)
    || logicalRef.sourceVersionId === ("versionId" in ref ? ref.versionId : undefined)
    || logicalRef.sourcePublishPackageId === ("packageId" in ref ? ref.packageId : undefined);
}

async function main(): Promise<void> {
  const dataDir = process.env["PLUTO_DATA_DIR"] ?? ".pluto";
  const catalogStore = new CatalogStore({ dataDir });
  const governanceStore = new GovernanceStore({ dataDir });
  const publishStore = new PublishStore({ dataDir });
  const complianceStore = new ComplianceStore({ dataDir });
  const evidenceStore = new EvidenceGraphStore({ dataDir });
  const bundleStore = new PortableBundleStore({ dataDir });
  const { subcommand, positional, flags } = parseArgs(process.argv.slice(2));

  if (!subcommand) usage();

  const jsonMode = flags["json"] === true;
  switch (subcommand) {
    case "export":
      return handlePortabilityExport(catalogStore, governanceStore, publishStore, complianceStore, evidenceStore, bundleStore, positional[0], {
        bundleId: typeof flags["bundle-id"] === "string" ? flags["bundle-id"] : undefined,
        templateId: typeof flags["template-id"] === "string" ? flags["template-id"] : undefined,
        jsonMode,
      });
    case "list":
      return handlePortabilityList(bundleStore, jsonMode);
    case "show":
      return handlePortabilityShow(bundleStore, positional[0], jsonMode);
    case "validate":
      return handlePortabilityValidate(bundleStore, positional[0], flags, jsonMode);
    case "conflicts":
      return handlePortabilityConflicts(bundleStore, positional[0], flags, jsonMode);
    default:
      fail(`Unknown subcommand: ${subcommand}`);
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack : String(error));
  process.exitCode = 1;
});
