#!/usr/bin/env node
import process from "node:process";
import { resolve } from "node:path";

import { CatalogStore } from "../catalog/catalog-store.js";
import {
  approveCatalogAsset,
  deprecateCatalogAsset,
} from "../catalog/lifecycle.js";
import {
  CATALOG_KINDS,
  type CatalogKind,
  type CatalogListItemV0,
  type CatalogListOutputV0,
  type CatalogRecord,
  type PolicyPackV0,
  type SkillCatalogEntryV0,
} from "../catalog/contracts.js";

function usage(): never {
  console.error(`Usage:
  pnpm catalog list [kind] [--json]
  pnpm catalog show <kind> <id> [--version VERSION] [--json]
  pnpm catalog approve <entryId> [--version VERSION] [--json]
  pnpm catalog deprecate <entryId> [--version VERSION] [--replacement-entry-id ID] [--sunset-at ISO] [--note TEXT] [--json]`);
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

async function main() {
  const dataDir = resolve(process.env["PLUTO_DATA_DIR"] ?? ".pluto");
  const store = new CatalogStore({ dataDir });
  const { subcommand, positional, flags } = parseArgs(process.argv.slice(2));
  const jsonMode = flags["json"] === true;

  if (!subcommand) usage();

  switch (subcommand) {
    case "list":
      return handleList(store, positional[0], jsonMode);
    case "show":
      return handleShow(store, positional[0], positional[1], flags, jsonMode);
    case "approve":
      return handleApprove(store, positional[0], flags, jsonMode);
    case "deprecate":
      return handleDeprecate(store, positional[0], flags, jsonMode);
    default:
      fail(`Unknown subcommand: ${subcommand}`);
  }
}

async function handleList(store: CatalogStore, kindArg: string | undefined, jsonMode: boolean): Promise<void> {
  const kinds = kindArg ? [parseKind(kindArg)] : [...CATALOG_KINDS];
  const items = await collectItems(store, kinds);

  if (jsonMode) {
    const output: CatalogListOutputV0 = {
      schema: "pluto.catalog.list-output",
      schemaVersion: 0,
      items,
    };
    console.log(JSON.stringify(output, null, 2));
    return;
  }

  if (items.length === 0) {
    console.log("No catalog records found.");
    return;
  }

  console.log(`${"Kind".padEnd(14)} ${"ID".padEnd(28)} ${"Version".padEnd(10)} ${"State".padEnd(10)} Review`);
  console.log("-".repeat(80));
  for (const item of items) {
    console.log(
      `${item.kind.padEnd(14)} ${item.id.slice(0, 28).padEnd(28)} ${item.version.padEnd(10)} ${item.state.padEnd(10)} ${item.reviewStatus ?? "-"}`,
    );
  }
}

async function handleShow(
  store: CatalogStore,
  kindArg: string | undefined,
  id: string | undefined,
  flags: Record<string, string | boolean>,
  jsonMode: boolean,
): Promise<void> {
  if (!kindArg || !id) {
    fail("Missing <kind> or <id> argument for 'show'");
  }

  const kind = parseKind(kindArg);
  const record = await store.read(kind, id, asOptionalString(flags["version"]));
  if (!record) {
    const version = asOptionalString(flags["version"]);
    fail(version ? `Catalog record not found: ${kind}/${id}@${version}` : `Catalog record not found: ${kind}/${id}`);
  }

  const item = summarizeRecord(kind, record);

  if (jsonMode) {
    console.log(JSON.stringify({ schemaVersion: 0, item, record }, null, 2));
    return;
  }

  console.log(`Kind: ${item.kind}`);
  console.log(`ID: ${item.id}`);
  console.log(`Version: ${item.version}`);
  console.log(`State: ${item.state}`);
  console.log(`Status: ${item.status}`);
  if (item.reviewStatus) console.log(`Review: ${item.reviewStatus}`);
  if (item.visibility) console.log(`Visibility: ${item.visibility}`);
  if (item.trustTier) console.log(`Trust tier: ${item.trustTier}`);
  if (item.name) console.log(`Name: ${item.name}`);
  if (item.summary) console.log(`Summary: ${item.summary}`);
}

async function handleApprove(
  store: CatalogStore,
  entryId: string | undefined,
  flags: Record<string, string | boolean>,
  jsonMode: boolean,
): Promise<void> {
  if (!entryId) {
    fail("Missing <entryId> argument for 'approve'");
  }

  const record = await approveCatalogAsset({
    store,
    assetId: entryId,
    version: asOptionalString(flags["version"]),
  });
  await printMutationResult(record, jsonMode);
}

async function handleDeprecate(
  store: CatalogStore,
  entryId: string | undefined,
  flags: Record<string, string | boolean>,
  jsonMode: boolean,
): Promise<void> {
  if (!entryId) {
    fail("Missing <entryId> argument for 'deprecate'");
  }

  const record = await deprecateCatalogAsset({
    store,
    assetId: entryId,
    version: asOptionalString(flags["version"]),
    replacementEntryId: asOptionalString(flags["replacement-entry-id"]),
    sunsetAt: asOptionalString(flags["sunset-at"]),
    note: asOptionalString(flags["note"]),
  });
  await printMutationResult(record, jsonMode);
}

async function printMutationResult(record: SkillCatalogEntryV0, jsonMode: boolean): Promise<void> {
  const item = summarizeRecord("entries", record);
  if (jsonMode) {
    console.log(JSON.stringify({ schemaVersion: 0, item, record }, null, 2));
    return;
  }

  console.log(`${record.id} -> ${item.state}`);
}

async function collectItems(store: CatalogStore, kinds: CatalogKind[]): Promise<CatalogListItemV0[]> {
  const grouped = await Promise.all(kinds.map(async (kind) => {
    const records = await store.list(kind);
    return records.map((record) => summarizeRecord(kind, record));
  }));

  return grouped
    .flat()
    .sort((a, b) => `${a.kind}:${a.id}@${a.version}`.localeCompare(`${b.kind}:${b.id}@${b.version}`));
}

function summarizeRecord(kind: CatalogKind, record: CatalogRecord): CatalogListItemV0 {
  return {
    kind,
    id: record.id,
    version: record.version,
    state: deriveState(kind, record),
    status: deriveStatus(kind, record),
    name: "name" in record ? record.name : null,
    summary: "summary" in record ? record.summary : "description" in record ? record.description : null,
    reviewStatus: isCatalogEntry(record) ? record.reviewStatus : null,
    visibility: isCatalogEntry(record) ? record.visibility : null,
    trustTier: isCatalogEntry(record) ? record.trustTier : null,
    labels: "labels" in record && Array.isArray(record.labels) ? [...record.labels] : [],
  };
}

function deriveState(kind: CatalogKind, record: CatalogRecord): CatalogListItemV0["state"] {
  if (kind === "policy-packs") {
    return (record as PolicyPackV0).status === "blocked" ? "blocked" : "active";
  }

  if (record.status === "deprecated") {
    return "deprecated";
  }

  if (isCatalogEntry(record) && record.reviewStatus !== "approved") {
    return "blocked";
  }

  return "active";
}

function deriveStatus(kind: CatalogKind, record: CatalogRecord): string {
  if (kind === "policy-packs") {
    return (record as PolicyPackV0).status;
  }
  if (isCatalogEntry(record)) {
    return `${record.status}/${record.reviewStatus}`;
  }
  return record.status;
}

function isCatalogEntry(record: CatalogRecord): record is SkillCatalogEntryV0 {
  return record.schema === "pluto.catalog.skill-entry";
}

function parseKind(value: string): CatalogKind {
  if ((CATALOG_KINDS as readonly string[]).includes(value)) {
    return value as CatalogKind;
  }
  fail(`Unknown catalog kind: ${value}`);
}

function asOptionalString(value: string | boolean | undefined): string | undefined {
  return typeof value === "string" ? value : undefined;
}

main().catch((err) => {
  console.error(err instanceof Error ? err.stack : String(err));
  process.exitCode = 1;
});
