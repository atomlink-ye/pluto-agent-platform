#!/usr/bin/env node
import process from "node:process";

import type { ApprovalRequestV0, ReviewRequestV0 } from "../contracts/review.js";
import { EvidenceGraphStore } from "../evidence/evidence-graph.js";
import { buildVersionDecisionProjection } from "../governance/release-projections.js";
import { GovernanceStore } from "../governance/governance-store.js";
import { buildApprovalQueue, buildReviewQueue } from "../review/queues.js";
import { ReviewStore } from "../review/review-store.js";

function usage(): never {
  console.error(`Usage:\n  pnpm review queue [--actor <id>] [--roles <csv>] [--json]\n  pnpm review approval-queue [--actor <id>] [--roles <csv>] [--json]\n  pnpm review decision-history <requestId> [--json]`);
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

function parseRoleLabels(value: string | boolean | undefined): string[] {
  if (typeof value !== "string") {
    return [];
  }

  return value
    .split(",")
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
}

function renderTarget(target: ReviewRequestV0["target"] | ApprovalRequestV0["target"]): string {
  switch (target.kind) {
    case "document":
      return `document:${target.documentId}`;
    case "version":
      return `version:${target.versionId}`;
    case "section":
      return `section:${target.sectionId}`;
    case "publish_package":
      return `publish_package:${target.packageId}`;
  }
}

function formatReasons(reasons: readonly string[]): string {
  return reasons.length === 0 ? "none" : reasons.join(", ");
}

async function loadSealedEvidenceByRef(store: EvidenceGraphStore): Promise<Record<string, Awaited<ReturnType<typeof store.listSealedEvidenceRefs>>[number]>> {
  const records = await store.listSealedEvidenceRefs();
  return Object.fromEntries(records.flatMap((record) => [[record.id, record], [record.packetId, record]]));
}

export async function handleReviewQueue(
  reviewStore: ReviewStore,
  evidenceStore: EvidenceGraphStore,
  jsonMode: boolean,
  actorId?: string,
  roleLabels: string[] = [],
): Promise<void> {
  const [requests, assignments, delegations, overlays, sealedEvidenceByRef] = await Promise.all([
    reviewStore.listReviewRequests(),
    reviewStore.listAssignments(),
    reviewStore.listDelegations(),
    reviewStore.listSlaOverlays(),
    loadSealedEvidenceByRef(evidenceStore),
  ]);
  const items = buildReviewQueue({
    requests,
    actor: actorId ? { actorId, roleLabels } : undefined,
    assignments,
    delegations,
    slaOverlays: overlays,
    sealedEvidenceByRef,
  });

  if (jsonMode) {
    console.log(JSON.stringify({ schemaVersion: 0, kind: "review_queue", items }, null, 2));
    return;
  }

  if (items.length === 0) {
    console.log("No review queue items found.");
    return;
  }

  for (const item of items) {
    console.log(`${item.requestId} ${item.status} target=${renderTarget(item.target)} role=${item.roleLabel ?? "unassigned"}`);
    console.log(`  blockedReasons: ${formatReasons(item.blockedReasons)}`);
  }
}

export async function handleApprovalQueue(
  reviewStore: ReviewStore,
  evidenceStore: EvidenceGraphStore,
  jsonMode: boolean,
  actorId?: string,
  roleLabels: string[] = [],
): Promise<void> {
  const [requests, assignments, delegations, overlays, sealedEvidenceByRef] = await Promise.all([
    reviewStore.listApprovalRequests(),
    reviewStore.listAssignments(),
    reviewStore.listDelegations(),
    reviewStore.listSlaOverlays(),
    loadSealedEvidenceByRef(evidenceStore),
  ]);
  const items = buildApprovalQueue({
    requests,
    actor: actorId ? { actorId, roleLabels } : undefined,
    assignments,
    delegations,
    slaOverlays: overlays,
    sealedEvidenceByRef,
  });

  if (jsonMode) {
    console.log(JSON.stringify({ schemaVersion: 0, kind: "approval_queue", items }, null, 2));
    return;
  }

  if (items.length === 0) {
    console.log("No approval queue items found.");
    return;
  }

  for (const item of items) {
    console.log(`${item.requestId} ${item.status} target=${renderTarget(item.target)} role=${item.roleLabel ?? "unassigned"}`);
    console.log(`  blockedReasons: ${formatReasons(item.blockedReasons)}`);
  }
}

export async function handleDecisionHistory(
  reviewStore: ReviewStore,
  governanceStore: GovernanceStore,
  evidenceStore: EvidenceGraphStore,
  requestId: string | undefined,
  jsonMode: boolean,
): Promise<void> {
  if (!requestId) {
    fail("Missing <requestId> argument for 'decision-history'");
  }

  const [decisions, reviewRequest, approvalRequest, versions, sealedEvidenceByRef] = await Promise.all([
    reviewStore.listDecisions(),
    reviewStore.getReviewRequest(requestId),
    reviewStore.getApprovalRequest(requestId),
    governanceStore.list("version"),
    loadSealedEvidenceByRef(evidenceStore),
  ]);
  const request = reviewRequest ?? approvalRequest;
  if (!request) {
    fail(`review request not found: ${requestId}`);
  }

  const versionId = getTargetVersionId(request.target);
  const version = versionId
    ? versions.find((entry) => entry.id === versionId) ?? null
    : null;
  const projection = version
    ? buildVersionDecisionProjection({
        version,
        reviewRequests: reviewRequest ? [reviewRequest] : [],
        approvalRequests: approvalRequest ? [approvalRequest] : [],
        decisions,
        sealedEvidenceByRef,
      })
    : null;
  const items = decisions
    .filter((decision) => decision.requestId === requestId)
    .sort((left, right) => left.recordedAt.localeCompare(right.recordedAt) || left.id.localeCompare(right.id));

  if (jsonMode) {
    console.log(JSON.stringify({
      schemaVersion: 0,
      kind: "decision_history",
      requestId,
      target: request.target,
      blockedReasons: projection?.blockedReasons ?? [],
      items,
    }, null, 2));
    return;
  }

  if (items.length === 0) {
    console.log("No decision records found.");
    return;
  }

  console.log(`Request: ${requestId}`);
  console.log(`Target: ${renderTarget(request.target)}`);
  console.log(`Blocked reasons: ${formatReasons(projection?.blockedReasons ?? [])}`);
  for (const item of items) {
    console.log(`${item.recordedAt} ${item.event} actor=${item.actorId} comment=${item.comment ?? ""}`.trim());
  }
}

function getTargetVersionId(target: ReviewRequestV0["target"] | ApprovalRequestV0["target"]): string | null {
  switch (target.kind) {
    case "document":
      return null;
    case "version":
    case "section":
    case "publish_package":
      return target.versionId;
  }
}

async function main(): Promise<void> {
  const dataDir = process.env["PLUTO_DATA_DIR"] ?? ".pluto";
  const reviewStore = new ReviewStore({ dataDir });
  const evidenceStore = new EvidenceGraphStore({ dataDir });
  const governanceStore = new GovernanceStore({ dataDir });
  const { subcommand, positional, flags } = parseArgs(process.argv.slice(2));
  const jsonMode = flags["json"] === true;
  const actorId = typeof flags["actor"] === "string" ? flags["actor"] : undefined;
  const roleLabels = parseRoleLabels(flags["roles"]);

  if (!subcommand) usage();

  switch (subcommand) {
    case "queue":
      return handleReviewQueue(reviewStore, evidenceStore, jsonMode, actorId, roleLabels);
    case "approval-queue":
      return handleApprovalQueue(reviewStore, evidenceStore, jsonMode, actorId, roleLabels);
    case "decision-history":
      return handleDecisionHistory(reviewStore, governanceStore, evidenceStore, positional[0], jsonMode);
    default:
      fail(`Unknown subcommand: ${subcommand}`);
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack : String(error));
  process.exitCode = 1;
});
