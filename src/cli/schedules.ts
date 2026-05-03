#!/usr/bin/env node
import process from "node:process";

import { GovernanceStore } from "../governance/governance-store.js";
import { projectScheduleDetail, projectScheduleHistory, listScheduleProjections } from "../schedule/projections.js";
import { ScheduleStore } from "../schedule/schedule-store.js";
import { parseSubcommandArgs, resolvePlutoDataDir } from "./shared/flags.js";

function usage(): never {
  console.error(`Usage:
  pnpm schedules list [--json]
  pnpm schedules show <scheduleId> [--json]
  pnpm schedules history <scheduleId> [--json]`);
  process.exit(1);
}

function fail(message: string): never {
  console.error(`Error: ${message}`);
  process.exit(1);
}

async function main() {
  const dataDir = resolvePlutoDataDir();
  const governanceStore = new GovernanceStore({ dataDir });
  const scheduleStore = new ScheduleStore({ dataDir });
  const { subcommand, positional, flags } = parseSubcommandArgs(process.argv.slice(2));
  const jsonMode = flags["json"] === true;

  if (!subcommand) usage();

  switch (subcommand) {
    case "list":
      return handleList(governanceStore, scheduleStore, jsonMode);
    case "show":
      return handleShow(governanceStore, scheduleStore, positional[0], jsonMode);
    case "history":
      return handleHistory(governanceStore, scheduleStore, positional[0], jsonMode);
    default:
      fail(`Unknown subcommand: ${subcommand}`);
  }
}

async function handleList(governanceStore: GovernanceStore, scheduleStore: ScheduleStore, jsonMode: boolean): Promise<void> {
  const items = await listScheduleProjections({ governanceStore, scheduleStore });
  if (jsonMode) {
    console.log(JSON.stringify({ schemaVersion: 0, items }, null, 2));
    return;
  }

  if (items.length === 0) {
    console.log("No local schedules found.");
    return;
  }

  console.log(`${"Schedule ID".padEnd(24)} ${"Status".padEnd(10)} ${"Cadence".padEnd(16)} Latest fire`);
  console.log("-".repeat(72));
  for (const item of items) {
    console.log(
      `${item.scheduleRef.recordId.padEnd(24)} ${item.status.padEnd(10)} ${item.cadence.slice(0, 16).padEnd(16)} ${item.latestFireAt ?? "-"}`,
    );
  }
}

async function handleShow(
  governanceStore: GovernanceStore,
  scheduleStore: ScheduleStore,
  scheduleId: string | undefined,
  jsonMode: boolean,
): Promise<void> {
  if (!scheduleId) {
    fail("Missing <scheduleId> argument for 'show'");
  }

  const projection = await projectScheduleDetail({ governanceStore, scheduleStore, scheduleId });
  if (projection === null) {
    fail(`Schedule not found: ${scheduleId}`);
  }

  if (jsonMode) {
    console.log(JSON.stringify(projection, null, 2));
    return;
  }

  console.log(`Schedule: ${projection.scheduleRef.recordId}`);
  console.log(`Workspace: ${projection.scheduleRef.workspaceId}`);
  console.log(`Status: ${projection.status}`);
  console.log(`Cadence: ${projection.cadence}`);
  console.log(`Scenario: ${projection.scenarioId}`);
  console.log(`Playbook: ${projection.playbookId}`);
  console.log(`Owner: ${projection.ownerId}`);
  console.log(`Triggers: ${projection.triggerRefs.length}`);
  console.log(`Subscriptions: ${projection.subscriptionRefs.length}`);
  console.log(`Recent local history: ${projection.latestHistory.length}`);
}

async function handleHistory(
  governanceStore: GovernanceStore,
  scheduleStore: ScheduleStore,
  scheduleId: string | undefined,
  jsonMode: boolean,
): Promise<void> {
  if (!scheduleId) {
    fail("Missing <scheduleId> argument for 'history'");
  }

  const projection = await projectScheduleHistory({ governanceStore, scheduleStore, scheduleId });
  if (projection === null) {
    fail(`Schedule not found: ${scheduleId}`);
  }

  if (jsonMode) {
    console.log(JSON.stringify(projection, null, 2));
    return;
  }

  if (projection.entries.length === 0) {
    console.log(`No local history for schedule ${projection.scheduleRef.recordId}.`);
    return;
  }

  console.log(`${"Kind".padEnd(12)} ${"Status".padEnd(10)} ${"Occurred".padEnd(24)} Ref`);
  console.log("-".repeat(88));
  for (const entry of projection.entries) {
    const ref = entry.runId ?? entry.fireRecordId ?? "-";
    console.log(`${entry.historyKind.padEnd(12)} ${entry.status.padEnd(10)} ${entry.occurredAt.padEnd(24)} ${ref}`);
  }
}

main().catch((error) => fail(error instanceof Error ? error.message : String(error)));
