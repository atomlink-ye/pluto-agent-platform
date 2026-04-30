#!/usr/bin/env node
import process from "node:process";
import type {
  GovernanceListOutputV0,
  GovernanceObjectKindV0,
  GovernanceRecordV0,
  GovernanceShowOutputV0,
} from "../contracts/governance.js";
import { GOVERNANCE_OBJECT_KINDS_V0 } from "../contracts/governance.js";
import { GovernanceStore } from "../governance/governance-store.js";

const VALID_KINDS = new Set<string>(GOVERNANCE_OBJECT_KINDS_V0);

function usage(): never {
  console.error(`Usage:
  pnpm governance list <kind> [--json]
  pnpm governance show <kind> <id> [--json]`);
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

function parseKind(value: string | undefined): GovernanceObjectKindV0 {
  if (!value) {
    fail("Missing <kind> argument");
  }

  if (!VALID_KINDS.has(value)) {
    fail(`Unknown kind '${value}'. Accepted values: ${GOVERNANCE_OBJECT_KINDS_V0.join(", ")}`);
  }

  return value as GovernanceObjectKindV0;
}

function summaryLabel(record: GovernanceRecordV0): string {
  switch (record.kind) {
    case "document":
    case "playbook":
    case "scenario":
      return record.title;
    case "version":
      return record.label;
    case "schedule":
      return record.cadence;
    case "review":
      return `${record.documentId} -> ${record.versionId}`;
    case "approval":
      return `${record.documentId} -> ${record.versionId}`;
    case "publish_package":
      return `${record.documentId} -> ${record.targetId}`;
  }
}

function renderTextValue(value: unknown): string {
  if (value === null) return "null";
  if (typeof value === "string") return value;
  return JSON.stringify(value);
}

export async function handleList(
  store: GovernanceStore,
  kind: GovernanceObjectKindV0,
  jsonMode: boolean,
): Promise<void> {
  const items = await store.list(kind);

  if (jsonMode) {
    const output: GovernanceListOutputV0 = {
      schemaVersion: 0,
      kind,
      items,
    };
    console.log(JSON.stringify(output, null, 2));
    return;
  }

  if (items.length === 0) {
    console.log(`No ${kind} records found.`);
    return;
  }

  console.log(`${"ID".padEnd(24)} ${"Status".padEnd(10)} Summary`);
  console.log("-".repeat(72));
  for (const item of items) {
    console.log(`${item.id.padEnd(24)} ${item.status.padEnd(10)} ${summaryLabel(item)}`);
  }
}

export async function handleShow(
  store: GovernanceStore,
  kind: GovernanceObjectKindV0,
  id: string | undefined,
  jsonMode: boolean,
): Promise<void> {
  if (!id) {
    fail("Missing <id> argument for 'show'");
  }

  const item = await store.get(kind, id);
  if (!item) {
    fail(`${kind} not found: ${id}`);
  }

  if (jsonMode) {
    const output: GovernanceShowOutputV0 = {
      schemaVersion: 0,
      kind,
      item,
    };
    console.log(JSON.stringify(output, null, 2));
    return;
  }

  console.log(`Kind: ${kind}`);
  for (const [key, value] of Object.entries(item)) {
    console.log(`${key}: ${renderTextValue(value)}`);
  }
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
      return handleList(store, parseKind(positional[0]), jsonMode);
    case "show":
      return handleShow(store, parseKind(positional[0]), positional[1], jsonMode);
    default:
      fail(`Unknown subcommand: ${subcommand}`);
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack : String(error));
  process.exitCode = 1;
});
