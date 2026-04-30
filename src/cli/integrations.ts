#!/usr/bin/env node
import process from "node:process";
import { resolve } from "node:path";

import {
  listInboundInspection,
  listOutboundInspection,
  listWebhookInspection,
  showInboundInspection,
  showOutboundInspection,
  showWebhookInspection,
} from "../integration/projections.js";
import { IntegrationStore } from "../integration/integration-store.js";

function usage(): never {
  console.error(`Usage:
  pnpm integrations inbound list [--json]
  pnpm integrations inbound show <recordId> [--json]
  pnpm integrations outbound list [--json]
  pnpm integrations outbound show <recordId> [--json]
  pnpm integrations webhooks list [--json]
  pnpm integrations webhooks show <recordId> [--json]`);
  process.exit(1);
}

function fail(message: string): never {
  console.error(`Error: ${message}`);
  process.exit(1);
}

function parseArgs(argv: string[]): {
  group: string;
  subcommand: string;
  positional: string[];
  flags: Record<string, string | boolean>;
} {
  const group = argv[0] ?? "";
  const subcommand = argv[1] ?? "";
  const positional: string[] = [];
  const flags: Record<string, string | boolean> = {};

  for (let i = 2; i < argv.length; i++) {
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

  return { group, subcommand, positional, flags };
}

async function main() {
  const dataDir = resolve(process.env["PLUTO_DATA_DIR"] ?? ".pluto");
  const store = new IntegrationStore({ dataDir });
  const { group, subcommand, positional, flags } = parseArgs(process.argv.slice(2));
  const jsonMode = flags["json"] === true;

  if (!group || !subcommand) usage();

  switch (`${group}:${subcommand}`) {
    case "inbound:list":
      return handleInboundList(store, jsonMode);
    case "inbound:show":
      return handleInboundShow(store, positional[0], jsonMode);
    case "outbound:list":
      return handleOutboundList(store, jsonMode);
    case "outbound:show":
      return handleOutboundShow(store, positional[0], jsonMode);
    case "webhooks:list":
      return handleWebhooksList(store, jsonMode);
    case "webhooks:show":
      return handleWebhooksShow(store, positional[0], jsonMode);
    default:
      fail(`Unknown command: ${group} ${subcommand}`);
  }
}

async function handleInboundList(store: IntegrationStore, jsonMode: boolean): Promise<void> {
  const items = await listInboundInspection(store);
  if (jsonMode) {
    console.log(JSON.stringify({ schemaVersion: 0, items }, null, 2));
    return;
  }

  if (items.length === 0) {
    console.log("No local inbound integration records found.");
    return;
  }

  console.log(`${"Inbound ID".padEnd(24)} ${"Status".padEnd(24)} Received`);
  console.log("-".repeat(80));
  for (const item of items) {
    console.log(`${item.inboundRef.recordId.padEnd(24)} ${item.status.padEnd(24)} ${item.receivedAt}`);
  }
}

async function handleInboundShow(store: IntegrationStore, recordId: string | undefined, jsonMode: boolean): Promise<void> {
  if (!recordId) {
    fail("Missing <recordId> argument for 'inbound show'");
  }

  const item = await showInboundInspection(store, recordId);
  if (item === null) {
    fail(`Inbound record not found: ${recordId}`);
  }

  if (jsonMode) {
    console.log(JSON.stringify(item, null, 2));
    return;
  }

  console.log(`Inbound: ${item.inboundRef.recordId}`);
  console.log(`Workspace: ${item.inboundRef.workspaceId}`);
  console.log(`Status: ${item.status}`);
  console.log(`Provider item: ${item.providerItemRef.externalId}`);
  console.log(`Received: ${item.receivedAt}`);
  console.log(`Processed: ${item.processedAt ?? "-"}`);
}

async function handleOutboundList(store: IntegrationStore, jsonMode: boolean): Promise<void> {
  const items = await listOutboundInspection(store);
  if (jsonMode) {
    console.log(JSON.stringify({ schemaVersion: 0, items }, null, 2));
    return;
  }

  if (items.length === 0) {
    console.log("No local outbound integration records found.");
    return;
  }

  console.log(`${"Outbound ID".padEnd(24)} ${"Status".padEnd(12)} ${"Operation".padEnd(20)} Attempted`);
  console.log("-".repeat(88));
  for (const item of items) {
    console.log(`${item.outboundRef.recordId.padEnd(24)} ${item.status.padEnd(12)} ${item.operation.padEnd(20)} ${item.attemptedAt}`);
  }
}

async function handleOutboundShow(store: IntegrationStore, recordId: string | undefined, jsonMode: boolean): Promise<void> {
  if (!recordId) {
    fail("Missing <recordId> argument for 'outbound show'");
  }

  const item = await showOutboundInspection(store, recordId);
  if (item === null) {
    fail(`Outbound record not found: ${recordId}`);
  }

  if (jsonMode) {
    console.log(JSON.stringify(item, null, 2));
    return;
  }

  console.log(`Outbound: ${item.outboundRef.recordId}`);
  console.log(`Status: ${item.status}`);
  console.log(`Operation: ${item.operation}`);
  console.log(`Target: ${item.targetRef.summary}`);
  console.log(`Attempted: ${item.attemptedAt}`);
  console.log(`Completed: ${item.completedAt ?? "-"}`);
}

async function handleWebhooksList(store: IntegrationStore, jsonMode: boolean): Promise<void> {
  const items = await listWebhookInspection(store);
  if (jsonMode) {
    console.log(JSON.stringify({ schemaVersion: 0, items }, null, 2));
    return;
  }

  if (items.length === 0) {
    console.log("No local webhook subscriptions found.");
    return;
  }

  console.log(`${"Subscription ID".padEnd(24)} ${"Status".padEnd(12)} ${"Topic".padEnd(20)} Latest attempt`);
  console.log("-".repeat(92));
  for (const item of items) {
    console.log(
      `${item.subscriptionRef.recordId.padEnd(24)} ${item.status.padEnd(12)} ${item.topic.slice(0, 20).padEnd(20)} ${item.latestAttemptAt ?? "-"}`,
    );
  }
}

async function handleWebhooksShow(store: IntegrationStore, recordId: string | undefined, jsonMode: boolean): Promise<void> {
  if (!recordId) {
    fail("Missing <recordId> argument for 'webhooks show'");
  }

  const item = await showWebhookInspection(store, recordId);
  if (item === null) {
    fail(`Webhook subscription not found: ${recordId}`);
  }

  if (jsonMode) {
    console.log(JSON.stringify(item, null, 2));
    return;
  }

  console.log(`Webhook: ${item.subscriptionRef.recordId}`);
  console.log(`Status: ${item.status}`);
  console.log(`Topic: ${item.topic}`);
  console.log(`Endpoint ref: ${item.endpointRef}`);
  console.log(`Attempts: ${item.attempts.length}`);
}

main().catch((error) => fail(error instanceof Error ? error.message : String(error)));
