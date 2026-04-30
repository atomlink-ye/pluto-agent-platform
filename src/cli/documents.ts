#!/usr/bin/env node
import process from "node:process";

import { GovernanceStore } from "../governance/governance-store.js";
import {
  buildActionState,
  buildDocumentDetailProjection,
  buildDocumentSummary,
  buildPageState,
} from "../governance/projections.js";

interface DocumentsListOutputV0 {
  schemaVersion: 0;
  pageState: "ready" | "empty";
  items: ReturnType<typeof buildDocumentSummary>[];
}

interface DocumentShowOutputV0 {
  schemaVersion: 0;
  item: NonNullable<ReturnType<typeof buildDocumentDetailProjection>>;
  actions: {
    requestReview: ReturnType<typeof buildActionState>;
    publish: ReturnType<typeof buildActionState>;
  };
}

function usage(): never {
  console.error(`Usage:
  pnpm documents list [--json]
  pnpm documents show <documentId> [--json]`);
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

function readRuntimeAvailable(): boolean {
  return process.env["PLUTO_RUNTIME_AVAILABLE"] !== "false";
}

function renderTextValue(value: unknown): string {
  if (value === null) return "null";
  if (typeof value === "string") return value;
  return JSON.stringify(value);
}

async function loadProjectionInputs(store: GovernanceStore) {
  const [documents, versions, reviews, approvals, publishPackages] = await Promise.all([
    store.list("document"),
    store.list("version"),
    store.list("review"),
    store.list("approval"),
    store.list("publish_package"),
  ]);

  return { documents, versions, reviews, approvals, publishPackages };
}

function buildDocumentActions(detail: NonNullable<ReturnType<typeof buildDocumentDetailProjection>>, runtimeAvailable: boolean) {
  const hasCurrentVersion = detail.currentVersion !== null;
  const hasApproval = detail.approvals.length > 0;
  const hasEvidence = detail.evidence.length > 0;

  return {
    requestReview: buildActionState({
      hasCurrentVersion,
      runtimeAvailable,
    }),
    publish: buildActionState({
      hasCurrentVersion,
      hasApproval,
      hasEvidence,
      runtimeAvailable,
    }),
  };
}

export async function handleListDocuments(store: GovernanceStore, jsonMode: boolean): Promise<void> {
  const { documents, versions, reviews, approvals, publishPackages } = await loadProjectionInputs(store);
  const items = documents.map((document) =>
    buildDocumentSummary({
      document,
      currentVersion: versions.find((version) => version.id === document.currentVersionId) ?? null,
      reviews,
      approvals,
      publishPackages,
    })
  );
  const pageState = buildPageState({ hasItems: items.length > 0 }) as "ready" | "empty";

  if (jsonMode) {
    const output: DocumentsListOutputV0 = {
      schemaVersion: 0,
      pageState,
      items,
    };
    console.log(JSON.stringify(output, null, 2));
    return;
  }

  if (items.length === 0) {
    console.log("No documents found.");
    return;
  }

  console.log(`${"ID".padEnd(24)} ${"Status".padEnd(10)} ${"Version".padEnd(12)} Title`);
  console.log("-".repeat(84));
  for (const item of items) {
    console.log(
      `${item.documentId.padEnd(24)} ${item.governanceStatus.padEnd(10)} ${(item.currentVersion?.label ?? "-").padEnd(12)} ${item.title}`,
    );
  }
}

export async function handleShowDocument(
  store: GovernanceStore,
  documentId: string | undefined,
  jsonMode: boolean,
): Promise<void> {
  if (!documentId) {
    fail("Missing <documentId> argument for 'show'");
  }

  const runtimeAvailable = readRuntimeAvailable();
  const { documents, versions, reviews, approvals, publishPackages } = await loadProjectionInputs(store);
  const document = documents.find((item) => item.id === documentId) ?? null;
  const detail = buildDocumentDetailProjection({
    document,
    versions,
    reviews,
    approvals,
    publishPackages,
    runtimeAvailable,
  });

  if (!detail) {
    fail(`document not found: ${documentId}`);
  }

  const actions = buildDocumentActions(detail, runtimeAvailable);

  if (jsonMode) {
    const output: DocumentShowOutputV0 = {
      schemaVersion: 0,
      item: detail,
      actions,
    };
    console.log(JSON.stringify(output, null, 2));
    return;
  }

  console.log(`Document: ${detail.document.title}`);
  console.log(`ID: ${detail.document.id}`);
  console.log(`Page state: ${detail.pageState}`);
  console.log(`Governance status: ${detail.governanceStatus}`);
  console.log(`Current version: ${detail.currentVersion?.label ?? "none"}`);
  console.log(`Reviews: ${detail.reviews.length}`);
  console.log(`Approvals: ${detail.approvals.length}`);
  console.log(`Publish packages: ${detail.publishPackages.length}`);
  console.log(`Request review action: ${renderTextValue(actions.requestReview)}`);
  console.log(`Publish action: ${renderTextValue(actions.publish)}`);
}

async function main(): Promise<void> {
  const store = new GovernanceStore({
    dataDir: process.env["PLUTO_DATA_DIR"] ?? ".pluto",
  });
  const { subcommand, positional, flags } = parseArgs(process.argv.slice(2));

  if (!subcommand) usage();

  const jsonMode = flags["json"] === true;

  switch (subcommand) {
    case "list":
      return handleListDocuments(store, jsonMode);
    case "show":
      return handleShowDocument(store, positional[0], jsonMode);
    default:
      fail(`Unknown subcommand: ${subcommand}`);
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack : String(error));
  process.exitCode = 1;
});
