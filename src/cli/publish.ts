#!/usr/bin/env node
import process from "node:process";

import { EvidenceGraphStore } from "../evidence/evidence-graph.js";
import {
  buildPublishReadinessProjection,
  type PublishReadinessProjectionV0,
} from "../governance/release-projections.js";
import { PublishStore } from "../publish/publish-store.js";
import { ReleaseStore } from "../release/release-store.js";
import { ReviewStore } from "../review/review-store.js";
import type { DecisionRecordV0 } from "../contracts/review.js";

function usage(): never {
  console.error(`Usage:\n  pnpm publish packages [<packageId>] [--json]\n  pnpm publish readiness <packageId> [--json]`);
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

function formatReasons(reasons: readonly string[]): string {
  return reasons.length === 0 ? "none" : reasons.join(", ");
}

async function loadSealedEvidenceByRef(store: EvidenceGraphStore): Promise<Record<string, Awaited<ReturnType<typeof store.listSealedEvidenceRefs>>[number]>> {
  const records = await store.listSealedEvidenceRefs();
  return Object.fromEntries(records.flatMap((record) => [[record.id, record], [record.packetId, record]]));
}

async function buildProjection(
  publishStore: PublishStore,
  releaseStore: ReleaseStore,
  reviewStore: ReviewStore,
  evidenceStore: EvidenceGraphStore,
  packageId: string,
): Promise<PublishReadinessProjectionV0> {
  const [publishPackage, exportAssets, publishAttempts, rollbackHistory, reports, decisions, sealedEvidenceByRef] = await Promise.all([
    publishStore.getPublishPackage(packageId),
    publishStore.listExportAssetRecords(),
    publishStore.listPublishAttempts(),
    publishStore.listRollbackRetractRecords(),
    releaseStore.listReadinessReports(),
    reviewStore.listDecisions(),
    loadSealedEvidenceByRef(evidenceStore),
  ]);
  if (!publishPackage) {
    fail(`publish package not found: ${packageId}`);
  }

  const readinessReport = reports
    .filter((report) => report.packageId === packageId)
    .sort((left, right) => right.generatedAt.localeCompare(left.generatedAt) || right.id.localeCompare(left.id))[0] ?? null;

  return buildPublishReadinessProjection({
    publishPackage,
    approvals: deriveApprovedApprovalRefs(decisions),
    sealedEvidenceByRef,
    exportAssets,
    publishAttempts,
    rollbackHistory,
    readinessReport,
  });
}

function deriveApprovedApprovalRefs(decisions: readonly DecisionRecordV0[]): string[] {
  const latestByRequestId = new Map<string, DecisionRecordV0>();
  for (const decision of decisions) {
    if (decision.requestKind !== "approval") {
      continue;
    }

    const current = latestByRequestId.get(decision.requestId);
    if (!current || current.recordedAt < decision.recordedAt || (current.recordedAt === decision.recordedAt && current.id < decision.id)) {
      latestByRequestId.set(decision.requestId, decision);
    }
  }

  return [...latestByRequestId.values()]
    .filter((decision) => decision.event === "approved")
    .map((decision) => decision.requestId)
    .sort((left, right) => left.localeCompare(right));
}

export async function handlePublishPackages(
  publishStore: PublishStore,
  releaseStore: ReleaseStore,
  reviewStore: ReviewStore,
  evidenceStore: EvidenceGraphStore,
  packageId: string | undefined,
  jsonMode: boolean,
): Promise<void> {
  if (packageId) {
    const projection = await buildProjection(publishStore, releaseStore, reviewStore, evidenceStore, packageId);
    if (jsonMode) {
      console.log(JSON.stringify(projection, null, 2));
      return;
    }

    renderProjection(projection);
    return;
  }

  const packages = await publishStore.listPublishPackages();
  if (jsonMode) {
    console.log(JSON.stringify({ schemaVersion: 0, kind: "publish_packages", items: packages }, null, 2));
    return;
  }

  if (packages.length === 0) {
    console.log("No publish packages found.");
    return;
  }

  for (const item of packages) {
    console.log(`${item.id} ${item.status} target=${item.targetId} blockedReasons=${formatReasons(item.publishReadyBlockedReasons)}`);
  }
}

export async function handlePublishReadiness(
  publishStore: PublishStore,
  releaseStore: ReleaseStore,
  reviewStore: ReviewStore,
  evidenceStore: EvidenceGraphStore,
  packageId: string | undefined,
  jsonMode: boolean,
): Promise<void> {
  if (!packageId) {
    fail("Missing <packageId> argument for 'readiness'");
  }

  const projection = await buildProjection(publishStore, releaseStore, reviewStore, evidenceStore, packageId);
  if (jsonMode) {
    console.log(JSON.stringify(projection, null, 2));
    return;
  }

  renderProjection(projection);
}

function renderProjection(projection: PublishReadinessProjectionV0): void {
  console.log(`Package: ${projection.publishPackage.id}`);
  console.log(`Status: ${projection.readiness.status}`);
  console.log(`Blocked reasons: ${formatReasons(projection.blockedReasons)}`);
  for (const summary of projection.redactedSummaries.channelDestinations) {
    console.log(`Channel summary: ${summary}`);
  }
  for (const summary of projection.redactedSummaries.exportAssets) {
    console.log(`Export redaction: ${summary}`);
  }
  for (const summary of projection.redactedSummaries.attempts) {
    console.log(`Attempt summary: ${summary}`);
  }
}

async function main(): Promise<void> {
  const dataDir = process.env["PLUTO_DATA_DIR"] ?? ".pluto";
  const publishStore = new PublishStore({ dataDir });
  const releaseStore = new ReleaseStore({ dataDir });
  const reviewStore = new ReviewStore({ dataDir });
  const evidenceStore = new EvidenceGraphStore({ dataDir });
  const { subcommand, positional, flags } = parseArgs(process.argv.slice(2));
  const jsonMode = flags["json"] === true;

  if (!subcommand) usage();

  switch (subcommand) {
    case "packages":
      return handlePublishPackages(publishStore, releaseStore, reviewStore, evidenceStore, positional[0], jsonMode);
    case "readiness":
      return handlePublishReadiness(publishStore, releaseStore, reviewStore, evidenceStore, positional[0], jsonMode);
    default:
      fail(`Unknown subcommand: ${subcommand}`);
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack : String(error));
  process.exitCode = 1;
});
