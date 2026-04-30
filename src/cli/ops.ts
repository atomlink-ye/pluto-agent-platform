#!/usr/bin/env node
import process from "node:process";
import { pathToFileURL } from "node:url";

import {
  UPGRADE_GATE_KEYS_V0,
  type UpgradeGateKeyV0,
  type UpgradeGateStatusLikeV0,
  type UpgradeGateV0,
  type UpgradeReadinessItemV0,
  validateUpgradeReadinessItemV0,
} from "../contracts/ops.js";
import type { UpgradeLocalEventTypeV0 } from "../ops/upgrade-events.js";
import { UpgradeStore } from "../ops/upgrade-store.js";

interface ReadinessQuery {
  workspaceId?: string;
  planId?: string;
  upgradeRunId?: string;
  status?: string;
}

function usage(): never {
  console.error(`Usage:
  pnpm ops plans [--workspace ID] [--status STATUS] [--json]
  pnpm ops runs [--workspace ID] [--plan ID] [--status STATUS] [--json]
  pnpm ops backup [--workspace ID] [--plan ID] [--run ID] [--json]
  pnpm ops health [--workspace ID] [--plan ID] [--run ID] [--status STATUS] [--json]
  pnpm ops rollback [--workspace ID] [--plan ID] [--run ID] [--json]
  pnpm ops audit [--plan ID] [--run ID] [--event-type TYPE] [--actor ID] [--since ISO] [--until ISO] [--json]
  pnpm ops readiness [--workspace ID] [--plan ID] [--run ID] [--status STATUS] [--json]`);
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

async function main(): Promise<void> {
  const store = new UpgradeStore({
    dataDir: process.env["PLUTO_DATA_DIR"] ?? ".pluto",
  });
  const { subcommand, flags } = parseArgs(process.argv.slice(2));

  if (!subcommand) usage();

  const jsonMode = flags["json"] === true;

  switch (subcommand) {
    case "plans":
      return handlePlans(store, flags, jsonMode);
    case "runs":
      return handleRuns(store, flags, jsonMode);
    case "backup":
      return handleBackup(store, flags, jsonMode);
    case "health":
      return handleHealth(store, flags, jsonMode);
    case "rollback":
      return handleRollback(store, flags, jsonMode);
    case "audit":
      return handleAudit(store, flags, jsonMode);
    case "readiness":
      return handleReadiness(store, flags, jsonMode);
    default:
      fail(`Unknown subcommand: ${subcommand}`);
  }
}

async function handlePlans(
  store: UpgradeStore,
  flags: Record<string, string | boolean>,
  jsonMode: boolean,
): Promise<void> {
  let items = await store.list("pluto.ops.upgrade-plan", asOptionalString(flags["workspace"]));
  const status = asOptionalString(flags["status"]);
  if (status) {
    items = items.filter((item) => item.status === status);
  }

  items.sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));

  if (jsonMode) {
    console.log(JSON.stringify({ schemaVersion: 0, items }, null, 2));
    return;
  }

  if (items.length === 0) {
    console.log("No upgrade plans found.");
    return;
  }

  console.log(`${"Plan ID".padEnd(20)} ${"Status".padEnd(12)} ${"Runtime".padEnd(28)} Summary`);
  console.log("-".repeat(96));
  for (const item of items) {
    const runtime = `${item.sourceRuntimeVersion} -> ${item.targetRuntimeVersion}`;
    console.log(`${item.id.padEnd(20)} ${item.status.padEnd(12)} ${runtime.padEnd(28)} ${item.summary}`);
  }
}

async function handleRuns(
  store: UpgradeStore,
  flags: Record<string, string | boolean>,
  jsonMode: boolean,
): Promise<void> {
  let items = await store.list("pluto.ops.upgrade-run", asOptionalString(flags["workspace"]));
  const planId = asOptionalString(flags["plan"]);
  const status = asOptionalString(flags["status"]);
  if (planId) {
    items = items.filter((item) => item.planId === planId);
  }
  if (status) {
    items = items.filter((item) => item.status === status);
  }

  items.sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));

  if (jsonMode) {
    console.log(JSON.stringify({ schemaVersion: 0, items }, null, 2));
    return;
  }

  if (items.length === 0) {
    console.log("No upgrade runs found.");
    return;
  }

  console.log(`${"Run ID".padEnd(20)} ${"Status".padEnd(12)} ${"Plan".padEnd(20)} Transition`);
  console.log("-".repeat(84));
  for (const item of items) {
    console.log(`${item.id.padEnd(20)} ${item.status.padEnd(12)} ${item.planId.padEnd(20)} ${item.lastTransitionAt}`);
  }
}

async function handleBackup(
  store: UpgradeStore,
  flags: Record<string, string | boolean>,
  jsonMode: boolean,
): Promise<void> {
  let items = await store.list("pluto.ops.backup-manifest", asOptionalString(flags["workspace"]));
  const planId = asOptionalString(flags["plan"]);
  const runId = asOptionalString(flags["run"]);
  if (planId) {
    items = items.filter((item) => item.planId === planId);
  }
  if (runId) {
    items = items.filter((item) => item.upgradeRunId === runId);
  }

  items.sort((left, right) => right.createdAt.localeCompare(left.createdAt));

  if (jsonMode) {
    console.log(JSON.stringify({
      schemaVersion: 0,
      items: items.map((item) => ({
        ...item,
        verified: item.evidenceRefs.length > 0 && item.backupRefs.includes(item.manifestRef),
      })),
    }, null, 2));
    return;
  }

  if (items.length === 0) {
    console.log("No backup manifests found.");
    return;
  }

  console.log(`${"Backup ID".padEnd(20)} ${"Run".padEnd(20)} ${"Verified".padEnd(10)} Manifest`);
  console.log("-".repeat(92));
  for (const item of items) {
    const verified = item.evidenceRefs.length > 0 && item.backupRefs.includes(item.manifestRef);
    console.log(`${item.id.padEnd(20)} ${item.upgradeRunId.padEnd(20)} ${String(verified).padEnd(10)} ${item.manifestRef}`);
  }
}

async function handleHealth(
  store: UpgradeStore,
  flags: Record<string, string | boolean>,
  jsonMode: boolean,
): Promise<void> {
  let items = await store.list("pluto.ops.health-signal", asOptionalString(flags["workspace"]));
  const planId = asOptionalString(flags["plan"]);
  const runId = asOptionalString(flags["run"]);
  const status = asOptionalString(flags["status"]);
  if (planId) {
    items = items.filter((item) => item.planId === planId);
  }
  if (runId) {
    items = items.filter((item) => item.upgradeRunId === runId);
  }
  if (status) {
    items = items.filter((item) => item.status === status);
  }

  items.sort((left, right) => right.recordedAt.localeCompare(left.recordedAt));

  if (jsonMode) {
    console.log(JSON.stringify({ schemaVersion: 0, items }, null, 2));
    return;
  }

  if (items.length === 0) {
    console.log("No health signals found.");
    return;
  }

  console.log(`${"Signal ID".padEnd(22)} ${"Run".padEnd(20)} ${"Status".padEnd(10)} Summary`);
  console.log("-".repeat(96));
  for (const item of items) {
    console.log(`${item.id.padEnd(22)} ${item.upgradeRunId.padEnd(20)} ${item.status.padEnd(10)} ${item.summary}`);
  }
}

async function handleRollback(
  store: UpgradeStore,
  flags: Record<string, string | boolean>,
  jsonMode: boolean,
): Promise<void> {
  let items = await store.list("pluto.ops.rollback-playbook", asOptionalString(flags["workspace"]));
  const planId = asOptionalString(flags["plan"]);
  const runId = asOptionalString(flags["run"]);
  if (planId) {
    items = items.filter((item) => item.planId === planId);
  }
  if (runId) {
    items = items.filter((item) => item.upgradeRunId === runId);
  }

  items.sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));

  if (jsonMode) {
    console.log(JSON.stringify({ schemaVersion: 0, items }, null, 2));
    return;
  }

  if (items.length === 0) {
    console.log("No rollback playbooks found.");
    return;
  }

  console.log(`${"Playbook ID".padEnd(20)} ${"Run".padEnd(20)} ${"Steps".padEnd(6)} Trigger / Steps`);
  console.log("-".repeat(120));
  for (const item of items) {
    console.log(
      `${item.id.padEnd(20)} ${item.upgradeRunId.padEnd(20)} ${String(item.steps.length).padEnd(6)} ${item.triggerSummary} | ${item.steps.join(" -> ")}`,
    );
  }
}

async function handleAudit(
  store: UpgradeStore,
  flags: Record<string, string | boolean>,
  jsonMode: boolean,
): Promise<void> {
  const items = await store.listEvents({
    planId: asOptionalString(flags["plan"]),
    upgradeRunId: asOptionalString(flags["run"]),
    eventType: asOptionalString(flags["event-type"]) as UpgradeLocalEventTypeV0 | undefined,
    actorId: asOptionalString(flags["actor"]),
    since: asOptionalString(flags["since"]),
    until: asOptionalString(flags["until"]),
  });

  if (jsonMode) {
    console.log(JSON.stringify({ schemaVersion: 0, items }, null, 2));
    return;
  }

  if (items.length === 0) {
    console.log("No upgrade audit events found.");
    return;
  }

  console.log(`${"Time".padEnd(24)} ${"Type".padEnd(32)} ${"Actor".padEnd(12)} Object`);
  console.log("-".repeat(108));
  for (const item of items) {
    console.log(
      `${item.occurredAt.padEnd(24)} ${item.eventType.padEnd(32)} ${item.actorId.padEnd(12)} ${item.objectRef.kind}:${item.objectRef.id}`,
    );
  }
}

async function handleReadiness(
  store: UpgradeStore,
  flags: Record<string, string | boolean>,
  jsonMode: boolean,
): Promise<void> {
  const items = await buildUpgradeReadinessItems(store, {
    workspaceId: asOptionalString(flags["workspace"]),
    planId: asOptionalString(flags["plan"]),
    upgradeRunId: asOptionalString(flags["run"]),
    status: asOptionalString(flags["status"]),
  });

  if (jsonMode) {
    console.log(JSON.stringify({ schemaVersion: 0, items }, null, 2));
    return;
  }

  if (items.length === 0) {
    console.log("No readiness records found.");
    return;
  }

  console.log(`${"Run ID".padEnd(20)} ${"Status".padEnd(12)} ${"Ready".padEnd(6)} ${"Backup".padEnd(8)} ${"Health".padEnd(10)} ${"Rollback".padEnd(10)} Gates`);
  console.log("-".repeat(120));
  for (const item of items) {
    const gateSummary = item.blockingGateKeys.length > 0
      ? `blocked:${item.blockingGateKeys.join(",")}`
      : item.pendingGateKeys.length > 0
        ? `pending:${item.pendingGateKeys.join(",")}`
        : "passed";
    console.log(
      `${item.upgradeRunId.padEnd(20)} ${item.runStatus.padEnd(12)} ${String(item.ready).padEnd(6)} ${String(item.backupVerified).padEnd(8)} ${(item.latestHealthStatus ?? "missing").padEnd(10)} ${String(item.rollbackPrepared).padEnd(10)} ${gateSummary}`,
    );
  }
}

export async function buildUpgradeReadinessItems(
  store: UpgradeStore,
  query: ReadinessQuery = {},
): Promise<UpgradeReadinessItemV0[]> {
  let runs = await store.list("pluto.ops.upgrade-run", query.workspaceId);
  if (query.planId) {
    runs = runs.filter((run) => run.planId === query.planId);
  }
  if (query.upgradeRunId) {
    runs = runs.filter((run) => run.id === query.upgradeRunId);
  }
  if (query.status) {
    runs = runs.filter((run) => run.status === query.status);
  }

  const workspaceId = query.workspaceId;
  const [plans, backups, healthSignals, rollbackPlaybooks, gates, events] = await Promise.all([
    store.list("pluto.ops.upgrade-plan", workspaceId),
    store.list("pluto.ops.backup-manifest", workspaceId),
    store.list("pluto.ops.health-signal", workspaceId),
    store.list("pluto.ops.rollback-playbook", workspaceId),
    store.list("pluto.ops.upgrade-gate", workspaceId),
    store.listEvents(),
  ]);

  const planById = new Map(plans.map((plan) => [plan.id, plan]));
  const backupsByRunId = groupBy(backups, (item) => item.upgradeRunId);
  const healthByRunId = groupBy(healthSignals, (item) => item.upgradeRunId);
  const rollbackByRunId = groupBy(rollbackPlaybooks, (item) => item.upgradeRunId);
  const eventsByRunId = groupBy(events.filter((item) => item.upgradeRunId !== null), (item) => item.upgradeRunId as string);

  const latestGateByRunAndKey = new Map<string, Map<UpgradeGateKeyV0, UpgradeGateV0>>();
  for (const gate of gates) {
    if (!UPGRADE_GATE_KEYS_V0.includes(gate.gateKey as UpgradeGateKeyV0)) {
      continue;
    }

    const gateKey = gate.gateKey as UpgradeGateKeyV0;
    let byKey = latestGateByRunAndKey.get(gate.upgradeRunId);
    if (!byKey) {
      byKey = new Map<UpgradeGateKeyV0, UpgradeGateV0>();
      latestGateByRunAndKey.set(gate.upgradeRunId, byKey);
    }
    const existing = byKey.get(gateKey);
    if (!existing || existing.checkedAt < gate.checkedAt) {
      byKey.set(gateKey, gate);
    }
  }

  return runs
    .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
    .map((run) => {
      const plan = planById.get(run.planId) ?? null;
      const runBackups = backupsByRunId.get(run.id) ?? [];
      const runHealth = sortByTimestamp(healthByRunId.get(run.id) ?? [], (item) => item.recordedAt);
      const latestHealth = runHealth.at(-1) ?? null;
      const runRollbacks = rollbackByRunId.get(run.id) ?? [];
      const runEvents = sortByTimestamp(eventsByRunId.get(run.id) ?? [], (item) => item.occurredAt);
      const gateMap = latestGateByRunAndKey.get(run.id) ?? new Map<UpgradeGateKeyV0, UpgradeGateV0>();

      const verifiedBackups = runBackups.filter((item) => item.evidenceRefs.length > 0 && item.backupRefs.includes(item.manifestRef));
      const gateStatus = Object.fromEntries(
        UPGRADE_GATE_KEYS_V0.map((key) => [key, gateMap.get(key)?.status ?? "missing"]),
      ) as Record<UpgradeGateKeyV0, UpgradeGateStatusLikeV0 | "missing">;
      const blockingGateKeys = UPGRADE_GATE_KEYS_V0.filter((key) => gateStatus[key] === "blocked");
      const pendingGateKeys = UPGRADE_GATE_KEYS_V0.filter((key) => gateStatus[key] !== "passed" && gateStatus[key] !== "blocked");
      const rollbackPrepared = run.rollbackRefs.length > 0 || runRollbacks.length > 0;
      const evidenceRefs = uniqueStrings([
        ...run.evidenceRefs,
        ...run.backupRefs,
        ...run.healthRefs,
        ...run.rollbackRefs,
        ...verifiedBackups.flatMap((item) => item.evidenceRefs),
        ...runHealth.flatMap((item) => item.evidenceRefs),
        ...runRollbacks.flatMap((item) => item.evidenceRefs),
        ...runEvents.flatMap((item) => item.evidenceRefs),
      ]);

      const item = {
        schemaVersion: 0,
        workspaceId: run.workspaceId,
        planId: run.planId,
        upgradeRunId: run.id,
        planStatus: plan?.status ?? null,
        runStatus: run.status,
        backupVerified: verifiedBackups.length > 0,
        verifiedBackupCount: verifiedBackups.length,
        latestHealthStatus: latestHealth?.status ?? null,
        rollbackPrepared,
        rollbackPlaybookCount: runRollbacks.length,
        gateStatus,
        blockingGateKeys,
        pendingGateKeys,
        recentEventTypes: runEvents.map((item) => item.eventType),
        evidenceRefs,
        ready: verifiedBackups.length > 0
          && rollbackPrepared
          && blockingGateKeys.length === 0
          && pendingGateKeys.length === 0
          && latestHealth?.status !== "degraded"
          && latestHealth?.status !== "failed",
      } satisfies UpgradeReadinessItemV0;

      const validation = validateUpgradeReadinessItemV0(item);
      if (!validation.ok) {
        throw new Error(`Invalid upgrade readiness item: ${validation.errors.join(", ")}`);
      }

      return validation.value;
    });
}

function groupBy<T>(items: readonly T[], getKey: (item: T) => string): Map<string, T[]> {
  const grouped = new Map<string, T[]>();
  for (const item of items) {
    const key = getKey(item);
    const existing = grouped.get(key);
    if (existing) {
      existing.push(item);
    } else {
      grouped.set(key, [item]);
    }
  }
  return grouped;
}

function sortByTimestamp<T>(items: readonly T[], getTimestamp: (item: T) => string): T[] {
  return [...items].sort((left, right) => getTimestamp(left).localeCompare(getTimestamp(right)));
}

function uniqueStrings(items: readonly string[]): string[] {
  return [...new Set(items.filter((item) => item.length > 0))];
}

function asOptionalString(value: string | boolean | undefined): string | undefined {
  return typeof value === "string" ? value : undefined;
}

const invokedPath = process.argv[1];
if (invokedPath && import.meta.url === pathToFileURL(invokedPath).href) {
  void main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  });
}
