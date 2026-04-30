#!/usr/bin/env node
import process from "node:process";

import { GovernanceEventStore } from "../audit/governance-event-store.js";

function usage(): never {
  console.error(`Usage:
  pnpm audit list [--event-type <type>] [--target-kind <kind>] [--target-id <id>] [--actor <id>] [--json]`);
  process.exit(1);
}

function fail(message: string): never {
  console.error(`Error: ${message}`);
  process.exit(1);
}

function parseArgs(argv: string[]): {
  subcommand: string;
  flags: Record<string, string | boolean>;
} {
  const subcommand = argv[0] ?? "";
  const flags: Record<string, string | boolean> = {};

  for (let i = 1; i < argv.length; i++) {
    const arg = argv[i]!;
    if (!arg.startsWith("--")) {
      fail(`Unexpected argument: ${arg}`);
    }

    const key = arg.slice(2);
    const next = argv[i + 1];
    if (next && !next.startsWith("--")) {
      flags[key] = next;
      i++;
    } else {
      flags[key] = true;
    }
  }

  return { subcommand, flags };
}

export async function handleGovernanceAudit(
  store: GovernanceEventStore,
  options: {
    eventType?: string;
    targetKind?: string;
    targetRecordId?: string;
    actorId?: string;
    jsonMode?: boolean;
  } = {},
): Promise<void> {
  const events = await store.list({
    eventType: options.eventType,
    targetKind: options.targetKind,
    targetRecordId: options.targetRecordId,
    actorId: options.actorId,
  });

  if (options.jsonMode) {
    console.log(JSON.stringify({ schemaVersion: 0, items: events }, null, 2));
    return;
  }

  if (events.length === 0) {
    console.log("No governance audit events found.");
    return;
  }

  console.log(`${"Time".padEnd(24)} ${"Type".padEnd(20)} ${"Actor".padEnd(18)} Target`);
  console.log("-".repeat(96));
  for (const event of events) {
    console.log(
      `${event.createdAt.padEnd(24)} ${event.eventType.padEnd(20)} ${event.actor.principalId.padEnd(18)} ${event.target.kind}:${event.target.recordId}`,
    );
  }
}

async function main(): Promise<void> {
  const store = new GovernanceEventStore({
    dataDir: process.env["PLUTO_DATA_DIR"] ?? ".pluto",
  });
  const { subcommand, flags } = parseArgs(process.argv.slice(2));
  if (!subcommand) usage();

  switch (subcommand) {
    case "list":
      return handleGovernanceAudit(store, {
        eventType: typeof flags["event-type"] === "string" ? flags["event-type"] : undefined,
        targetKind: typeof flags["target-kind"] === "string" ? flags["target-kind"] : undefined,
        targetRecordId: typeof flags["target-id"] === "string" ? flags["target-id"] : undefined,
        actorId: typeof flags["actor"] === "string" ? flags["actor"] : undefined,
        jsonMode: flags["json"] === true,
      });
    default:
      fail(`Unknown subcommand: ${subcommand}`);
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack : String(error));
  process.exitCode = 1;
});
