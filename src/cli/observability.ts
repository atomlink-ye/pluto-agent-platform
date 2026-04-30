#!/usr/bin/env node
import process from "node:process";
import { resolve } from "node:path";

import { EvidenceGraphStore } from "../evidence/evidence-graph.js";
import { ObservabilityStore } from "../observability/observability-store.js";
import { queryObservabilityRecords, type ObservabilityRecordV0 } from "../observability/query.js";

interface EvidenceReadinessQueryItemV0 {
  schemaVersion: 0;
  runId: string;
  status: string;
  packetStatus: string | null;
  validationOutcome: string | null;
  sealed: boolean;
  redacted: boolean;
  governanceReady: boolean | null;
  ingestionOk: boolean | null;
  readiness: "ready" | "degraded" | "blocked";
  ready: boolean;
}

function usage(): never {
  console.error(`Usage:
  pnpm observability run-health [--workspace ID] [--status STATUS] [--json]
  pnpm observability adapter-health [--workspace ID] [--adapter ID] [--json]
  pnpm observability evidence-readiness [--workspace ID] [--json]
  pnpm observability alerts [--workspace ID] [--lifecycle STATE] [--json]
  pnpm observability usage [--workspace ID] [--subject ID] [--json]
  pnpm observability budget-decisions [--workspace ID] [--behavior MODE] [--json]`);
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
  const store = new ObservabilityStore({ dataDir });
  const evidenceStore = new EvidenceGraphStore({ dataDir });
  const { subcommand, flags } = parseArgs(process.argv.slice(2));
  const jsonMode = flags["json"] === true;

  if (!subcommand) usage();

  switch (subcommand) {
    case "run-health":
      return handleRunHealth(store, flags, jsonMode);
    case "adapter-health":
      return handleAdapterHealth(store, flags, jsonMode);
    case "evidence-readiness":
      return handleEvidenceReadiness(store, evidenceStore, flags, jsonMode);
    case "alerts":
      return handleAlerts(store, flags, jsonMode);
    case "usage":
      return handleUsage(store, flags, jsonMode);
    case "budget-decisions":
      return handleBudgetDecisions(store, flags, jsonMode);
    default:
      fail(`Unknown subcommand: ${subcommand}`);
  }
}

async function handleRunHealth(
  store: ObservabilityStore,
  flags: Record<string, string | boolean>,
  jsonMode: boolean,
): Promise<void> {
  const items = await store.query({
    kind: "run_health_summary",
    workspaceId: asOptionalString(flags["workspace"]),
    runStatus: asOptionalString(flags["status"]) ?? undefined,
  });
  if (jsonMode) {
    console.log(JSON.stringify({ schemaVersion: 0, items }, null, 2));
    return;
  }
  printRecords(items, (record) => [
    record.id,
    readField(record, "runId"),
    readField(record, "status"),
    readField(record, "blockerReason") || "-",
  ]);
}

async function handleAdapterHealth(
  store: ObservabilityStore,
  flags: Record<string, string | boolean>,
  jsonMode: boolean,
): Promise<void> {
  const items = await store.query({
    kind: "adapter_health_summary",
    workspaceId: asOptionalString(flags["workspace"]),
    adapter: asOptionalString(flags["adapter"]) ?? undefined,
  });
  if (jsonMode) {
    console.log(JSON.stringify({ schemaVersion: 0, items }, null, 2));
    return;
  }
  printRecords(items, (record) => [record.id, readField(record, "adapterKind"), readField(record, "status"), readField(record, "severity")]);
}

async function handleEvidenceReadiness(
  store: ObservabilityStore,
  evidenceStore: EvidenceGraphStore,
  flags: Record<string, string | boolean>,
  jsonMode: boolean,
): Promise<void> {
  const runHealthItems = await store.query({
    kind: "run_health_summary",
    workspaceId: asOptionalString(flags["workspace"]),
  });
  const sealedEvidenceByRunId = toLatestSealedEvidenceByRunId(await evidenceStore.listSealedEvidenceRefs());
  const items = runHealthItems.map((record) => {
    const runId = readField(record, "runId");
    const sealedEvidence = sealedEvidenceByRunId[runId] ?? null;
    const packetStatus = sealedEvidence?.immutablePacket.status ?? null;
    const validationOutcome = sealedEvidence?.validationSummary.outcome ?? sealedEvidence?.immutablePacket.validation.outcome ?? null;
    const sealed = sealedEvidence !== null;
    const redacted = sealedEvidence?.redactionSummary.redactedAt !== null && sealedEvidence !== null;
    const governanceReady = readBooleanValue(record, ["governanceReady"])
      ?? readBooleanValue(record, ["readiness", "governanceReady"])
      ?? readBooleanValue(record, ["metadata", "evidenceReadiness", "governanceReady"]);
    const ingestionOk = readBooleanValue(record, ["ingestionOk"])
      ?? readBooleanValue(record, ["readiness", "ingestionOk"])
      ?? readBooleanValue(record, ["metadata", "evidenceReadiness", "ingestionOk"]);
    const readiness = getEvidenceReadiness(packetStatus, validationOutcome, sealed, redacted, governanceReady, ingestionOk);

    const item = {
      schemaVersion: 0,
      runId,
      status: readField(record, "status"),
      packetStatus,
      validationOutcome,
      sealed,
      redacted,
      governanceReady,
      ingestionOk,
      readiness,
      ready: readiness === "ready",
    } satisfies EvidenceReadinessQueryItemV0;

    validateEvidenceReadinessQueryItem(item);
    return item;
  });
  if (jsonMode) {
    console.log(JSON.stringify({ schemaVersion: 0, items }, null, 2));
    return;
  }
  if (items.length === 0) {
    console.log("No records found.");
    return;
  }
  console.log(`${"Run ID".padEnd(16)} ${"Status".padEnd(12)} ${"Readiness".padEnd(10)} ${"Sealed".padEnd(8)} ${"Redacted".padEnd(10)} Validation`);
  console.log("-".repeat(78));
  for (const item of items) {
    console.log(
      `${item.runId.padEnd(16)} ${item.status.padEnd(12)} ${item.readiness.padEnd(10)} ${String(item.sealed).padEnd(8)} ${String(item.redacted).padEnd(10)} ${item.validationOutcome ?? "unknown"}`,
    );
  }
}

function validateEvidenceReadinessQueryItem(item: EvidenceReadinessQueryItemV0): void {
  if (typeof item.runId !== "string" || typeof item.status !== "string") {
    throw new Error("Invalid evidence readiness item: runId and status are required");
  }
}

function toLatestSealedEvidenceByRunId(
  records: Awaited<ReturnType<EvidenceGraphStore["listSealedEvidenceRefs"]>>,
): Record<string, Awaited<ReturnType<EvidenceGraphStore["listSealedEvidenceRefs"]>>[number]> {
  const latest: Record<string, Awaited<ReturnType<EvidenceGraphStore["listSealedEvidenceRefs"]>>[number]> = {};
  for (const record of records) {
    const existing = latest[record.runId];
    if (!existing || existing.sealedAt.localeCompare(record.sealedAt) < 0) {
      latest[record.runId] = record;
    }
  }
  return latest;
}

async function handleAlerts(
  store: ObservabilityStore,
  flags: Record<string, string | boolean>,
  jsonMode: boolean,
): Promise<void> {
  let items = await store.query({ kind: "alert", workspaceId: asOptionalString(flags["workspace"]) });
  const lifecycle = asOptionalString(flags["lifecycle"]);
  if (lifecycle) {
    items = queryObservabilityRecords(items, { kind: "alert" }).filter((record) => readField(record, "lifecycle") === lifecycle);
  }
  if (jsonMode) {
    console.log(JSON.stringify({ schemaVersion: 0, items }, null, 2));
    return;
  }
  printRecords(items, (record) => [record.id, readField(record, "alertKey"), readField(record, "lifecycle"), readField(record, "severity")]);
}

async function handleUsage(
  store: ObservabilityStore,
  flags: Record<string, string | boolean>,
  jsonMode: boolean,
): Promise<void> {
  const subject = asOptionalString(flags["subject"]);
  let items = await store.query({ kind: "usage_meter", workspaceId: asOptionalString(flags["workspace"]) });
  if (subject) {
    items = items.filter((record) => readField(record, "subjectRef.id") === subject);
  }
  if (jsonMode) {
    console.log(JSON.stringify({ schemaVersion: 0, items }, null, 2));
    return;
  }
  printRecords(items, (record) => [record.id, readField(record, "meterKey"), String(readValue(record, "quantity") ?? ""), readField(record, "unit")]);
}

async function handleBudgetDecisions(
  store: ObservabilityStore,
  flags: Record<string, string | boolean>,
  jsonMode: boolean,
): Promise<void> {
  let items = await store.query({ kind: "budget_decision", workspaceId: asOptionalString(flags["workspace"]) });
  const behavior = asOptionalString(flags["behavior"]);
  if (behavior) {
    items = items.filter((record) => readField(record, "behavior") === behavior);
  }
  if (jsonMode) {
    console.log(JSON.stringify({ schemaVersion: 0, items }, null, 2));
    return;
  }
  printRecords(items, (record) => [record.id, readField(record, "budgetId"), readField(record, "behavior"), readField(record, "reason")]);
}

function printRecords(records: readonly ObservabilityRecordV0[], render: (record: ObservabilityRecordV0) => string[]): void {
  if (records.length === 0) {
    console.log("No records found.");
    return;
  }
  for (const record of records) {
    console.log(render(record).join("\t"));
  }
}

function asOptionalString(value: string | boolean | undefined): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function readField(record: ObservabilityRecordV0, path: string): string {
  const value = readValue(record, path);
  return typeof value === "string" ? value : value === null || value === undefined ? "" : String(value);
}

function readBooleanValue(record: ObservabilityRecordV0, path: readonly string[]): boolean | null {
  const value = path.reduce<unknown>((current, segment) => {
    if (typeof current !== "object" || current === null) return undefined;
    return (current as Record<string, unknown>)[segment];
  }, record as unknown as Record<string, unknown>);
  return typeof value === "boolean" ? value : null;
}

function readValue(record: ObservabilityRecordV0, path: string): unknown {
  return path.split(".").reduce<unknown>((value, segment) => {
    if (typeof value !== "object" || value === null) return undefined;
    return (value as Record<string, unknown>)[segment];
  }, record as unknown as Record<string, unknown>);
}

function getEvidenceReadiness(
  packetStatus: string | null,
  validationOutcome: string | null,
  sealed: boolean,
  redacted: boolean,
  governanceReady: boolean | null,
  ingestionOk: boolean | null,
): "ready" | "degraded" | "blocked" {
  if (ingestionOk === false || validationOutcome === "fail" || packetStatus === "failed") {
    return "blocked";
  }
  if (governanceReady === true && ingestionOk === true && packetStatus === "done") {
    return "ready";
  }
  if (sealed && redacted) {
    return "degraded";
  }
  return "blocked";
}

void main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
