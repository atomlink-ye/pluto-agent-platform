#!/usr/bin/env node
import { watchFile, unwatchFile } from "node:fs";
import { readFile } from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";
import process from "node:process";
import { RunStore } from "../orchestrator/run-store.js";
import type {
  RunsListOutputV0,
  RunsShowOutputV0,
  RunsEventV0,
  EvidencePacketV0,
} from "../contracts/types.js";
import { renderEvidenceMarkdown } from "../orchestrator/evidence.js";
import { parseSubcommandArgs, resolvePlutoDataDir } from "./shared/flags.js";

const VALID_ROLES = ["lead", "planner", "generator", "evaluator"] as const;
const VALID_KINDS = [
  "dispatch", "message", "artifact", "summary", "blocker", "retry",
  "run_started", "lead_started", "worker_requested", "worker_started",
  "worker_completed", "lead_message",
  "artifact_created", "run_completed", "run_failed",
] as const;
const FOLLOW_POLL_INTERVAL_MS = 250;
const FOLLOW_DRAIN_MS = 5_000;
const TERMINAL_KINDS = new Set(["run_completed", "run_failed"]);

function usage(): never {
  console.error(`Usage:
  pnpm runs list [--limit N] [--status STATUS] [--json]
  pnpm runs show <runId> [--json]
  pnpm runs events <runId> [--follow] [--role ROLE] [--kind KIND] [--since EVENT_ID|TIMESTAMP] [--json]
  pnpm runs artifact <runId>
  pnpm runs evidence <runId> [--json]`);
  process.exit(1);
}

function fail(msg: string): never {
  console.error(`Error: ${msg}`);
  process.exit(1);
}

async function main() {
  const dataDir = resolvePlutoDataDir();
  const store = new RunStore({ dataDir });
  const { subcommand, positional, flags } = parseSubcommandArgs(process.argv.slice(2));

  if (!subcommand) usage();

  const jsonMode = flags["json"] === true;

  switch (subcommand) {
    case "list":
      return handleList(store, flags, jsonMode);
    case "show":
      return handleShow(store, positional[0], jsonMode);
    case "events":
      return handleEvents(store, positional[0], flags, jsonMode);
    case "artifact":
      return handleArtifact(store, positional[0]);
    case "evidence":
      return handleEvidence(store, positional[0], jsonMode);
    default:
      fail(`Unknown subcommand: ${subcommand}`);
  }
}

async function handleList(
  store: RunStore,
  flags: Record<string, string | boolean>,
  jsonMode: boolean,
): Promise<void> {
  const limit = parseLimitFlag(flags["limit"]);
  const statusFilter = typeof flags["status"] === "string" ? flags["status"] : undefined;

  const dirs = await store.listRunDirs();
  let items: RunsListOutputV0["items"] = [];

  for (const runId of dirs) {
    const meta = await store.readRunMeta(runId);
    if (!meta) continue;
    if (statusFilter && meta.status !== statusFilter) continue;
    items.push(meta);
  }

  items.sort((a, b) => (a.startedAt > b.startedAt ? -1 : 1));
  if (limit !== undefined && limit > 0) {
    items = items.slice(0, limit);
  }

  if (jsonMode) {
    const output: RunsListOutputV0 = { schemaVersion: 0, items };
    console.log(JSON.stringify(output, null, 2));
  } else {
    if (items.length === 0) {
      console.log("No runs found.");
      return;
    }
    console.log(`${"Run ID".padEnd(40)} ${"Status".padEnd(10)} ${"Title".padEnd(30)} Blocker`);
    console.log("-".repeat(90));
    for (const item of items) {
      console.log(
        `${item.runId.padEnd(40)} ${item.status.padEnd(10)} ${item.taskTitle.slice(0, 30).padEnd(30)} ${item.blockerReason ?? ""}`,
      );
    }
  }
}

async function handleShow(
  store: RunStore,
  runId: string | undefined,
  jsonMode: boolean,
): Promise<void> {
  if (!runId) fail("Missing <runId> argument for 'show'");

  const meta = await store.readRunMeta(runId);
  if (!meta) fail(`Run not found: ${runId}`);

  const events = await readStoredEvents(store, runId);
  const evidence = await store.readEvidence(runId);

  const workerMap = new Map<string, {
    sessionId: string | null;
    status: "pending" | "running" | "done" | "failed" | "timed_out";
    contributionSummary: string | null;
  }>();

  for (const worker of evidence.json?.workers ?? []) {
    workerMap.set(worker.role, {
      sessionId: worker.sessionId,
      status: "done",
      contributionSummary: worker.contributionSummary,
    });
  }

  for (const ev of events) {
    const role = String(ev.role ?? "");
    if (!role) continue;
    if (ev.kind === "worker_requested") {
      workerMap.set(role, {
        sessionId: workerMap.get(role)?.sessionId ?? null,
        status: "pending",
        contributionSummary: workerMap.get(role)?.contributionSummary ?? null,
      });
    } else if (ev.kind === "worker_started") {
      workerMap.set(role, {
        sessionId: workerMap.get(role)?.sessionId ?? null,
        status: "running",
        contributionSummary: workerMap.get(role)?.contributionSummary ?? null,
      });
    } else if (ev.kind === "worker_completed") {
      const payload = asRecord(ev.payload);
      const contributionSummary = typeof payload?.["output"] === "string"
        ? payload["output"].slice(0, 200) || null
        : typeof payload?.["summary"] === "string"
          ? payload["summary"].slice(0, 200) || null
        : null;
      const existing = workerMap.get(role);
      if (existing) {
        existing.status = "done";
        existing.contributionSummary = contributionSummary;
      } else {
        workerMap.set(role, {
          sessionId: null,
          status: "done",
          contributionSummary,
        });
      }
    } else if (ev.kind === "blocker") {
      const reason = asRecord(ev.payload)?.["reason"];
      if (reason === "runtime_timeout") {
        const existing = workerMap.get(role);
        if (existing) existing.status = "timed_out";
      }
    }
  }

  const artifactContent = await store.readArtifact(runId);
  let blockerEvent: RunsEventV0 | undefined;
  for (let i = events.length - 1; i >= 0; i--) {
    if (events[i]!.kind === "blocker") {
      blockerEvent = events[i];
      break;
    }
  }
  const blockerPayload = asRecord(blockerEvent?.payload);
  const blockerMessage = typeof blockerPayload?.["message"] === "string"
    ? blockerPayload["message"]
    : null;

  if (jsonMode) {
    const output: RunsShowOutputV0 = {
      schemaVersion: 0,
      runId,
      taskTitle: meta.taskTitle,
      status: meta.status,
      blockerReason: meta.blockerReason,
      startedAt: meta.startedAt,
      finishedAt: meta.finishedAt,
      parseWarnings: meta.parseWarnings,
      workspace: evidence.json?.workspace ?? null,
      workers: Array.from(workerMap.entries()).map(([role, info]) => ({
        role,
        sessionId: info.sessionId,
        status: info.status,
        contributionSummary: info.contributionSummary,
      })),
      artifactPath: artifactContent ? formatRunFileRef(store, runId, "artifact.md") : null,
      evidencePath: evidence.json ? formatRunFileRef(store, runId, "evidence.json") : null,
    };
    console.log(JSON.stringify(output, null, 2));
  } else {
    console.log(`Run: ${runId}`);
    console.log(`Title: ${meta.taskTitle}`);
    console.log(`Status: ${meta.status}`);
    if (meta.blockerReason) {
      console.log(`Blocker: ${meta.blockerReason}${blockerMessage ? ` — ${blockerMessage}` : ""}`);
    }
    console.log(`Started: ${meta.startedAt}`);
    console.log(`Finished: ${meta.finishedAt ?? "(in progress)"}`);
    console.log(`Workers: ${workerMap.size}`);
    console.log(`Artifact: ${artifactContent ? "present" : "absent"}`);
    console.log(`Evidence: ${evidence.json ? "present" : "absent"}`);
  }
}

function parseLimitFlag(limitFlag: string | boolean | undefined): number | undefined {
  if (typeof limitFlag !== "string") return undefined;
  if (!/^\d+$/.test(limitFlag)) {
    fail(`Invalid --limit '${limitFlag}'. Expected a positive integer.`);
  }

  const limit = Number.parseInt(limitFlag, 10);
  if (limit < 1) {
    fail(`Invalid --limit '${limitFlag}'. Expected a positive integer.`);
  }

  return limit;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null ? value as Record<string, unknown> : null;
}

function formatRunFileRef(store: RunStore, runId: string, fileName: string): string {
  const displayDataDir = basename(dirname(dirname(store.runDir(runId))));
  return join(displayDataDir, "runs", runId, fileName);
}

async function handleEvents(
  store: RunStore,
  runId: string | undefined,
  flags: Record<string, string | boolean>,
  jsonMode: boolean,
): Promise<void> {
  if (!runId) fail("Missing <runId> argument for 'events'");

  const roleFilter = typeof flags["role"] === "string" ? flags["role"] : undefined;
  const kindFilter = typeof flags["kind"] === "string" ? flags["kind"] : undefined;
  const sinceFilter = typeof flags["since"] === "string" ? flags["since"] : undefined;

  if (roleFilter && !(VALID_ROLES as readonly string[]).includes(roleFilter)) {
    fail(`Unknown role '${roleFilter}'. Accepted values: ${VALID_ROLES.join(", ")}`);
  }
  if (kindFilter && !(VALID_KINDS as readonly string[]).includes(kindFilter)) {
    fail(`Unknown kind '${kindFilter}'. Accepted values: ${VALID_KINDS.join(", ")}`);
  }

  const follow = flags["follow"] === true;
  const allRawEvents = await readStoredEvents(store, runId);
  const allEvents = filterEvents(allRawEvents, roleFilter, kindFilter, sinceFilter);

  if (follow) {
    await followEvents({
      store,
      runId,
      jsonMode,
      roleFilter,
      kindFilter,
      sinceFilter,
      initialEvents: allRawEvents,
      initialFilteredEvents: allEvents,
    });
    return;
  }

  if (jsonMode) {
    console.log(JSON.stringify(allEvents, null, 2));
  } else {
    if (allEvents.length === 0) {
      console.log("No events found.");
      return;
    }
    for (const ev of allEvents) {
      const role = ev.role ?? "-";
      console.log(`[${ev.occurredAt}] ${ev.kind.padEnd(30)} role=${role} attempt=${ev.attempt}`);
    }
  }
}

async function followEvents(opts: {
  store: RunStore;
  runId: string;
  jsonMode: boolean;
  roleFilter?: string;
  kindFilter?: string;
  sinceFilter?: string;
  initialEvents: RunsEventV0[];
  initialFilteredEvents: RunsEventV0[];
}): Promise<void> {
  const eventsPath = join(opts.store.runDir(opts.runId), "events.jsonl");
  const emittedEventIds = new Set<string>();
  let terminalDrainTimer: NodeJS.Timeout | null = null;
  let settled = false;
  let pollInFlight = false;
  let rawEvents = opts.initialEvents;

  const emitEvents = (events: RunsEventV0[]) => {
    for (const ev of events) {
      if (emittedEventIds.has(ev.eventId)) continue;
      emittedEventIds.add(ev.eventId);
      if (opts.jsonMode) {
        console.log(JSON.stringify(ev));
      } else {
        const role = ev.role ?? "-";
        console.log(`[${ev.occurredAt}] ${ev.kind.padEnd(30)} role=${role} attempt=${ev.attempt}`);
      }
    }
  };

  const scheduleTerminalDrain = () => {
    if (terminalDrainTimer) return;
    terminalDrainTimer = setTimeout(() => {
      settled = true;
      unwatchFile(eventsPath, onWatch);
      resolveFollow();
    }, FOLLOW_DRAIN_MS);
  };

  const maybeScheduleTerminalDrain = (events: RunsEventV0[]) => {
    if (events.some((ev) => TERMINAL_KINDS.has(ev.kind))) {
      scheduleTerminalDrain();
    }
  };

  const pollForUpdates = async () => {
    if (settled || pollInFlight) return;
    pollInFlight = true;
    try {
      rawEvents = await readStoredEvents(opts.store, opts.runId);
      const filteredEvents = filterEvents(rawEvents, opts.roleFilter, opts.kindFilter, opts.sinceFilter);
      emitEvents(filteredEvents);
      maybeScheduleTerminalDrain(rawEvents);
    } finally {
      pollInFlight = false;
    }
  };

  const onWatch = () => {
    void pollForUpdates();
  };

  let resolveFollow = () => {};
  const done = new Promise<void>((resolve) => {
    resolveFollow = resolve;
  });

  emitEvents(opts.initialFilteredEvents);
  maybeScheduleTerminalDrain(rawEvents);
  watchFile(eventsPath, { interval: FOLLOW_POLL_INTERVAL_MS }, onWatch);

  try {
    await done;
  } finally {
    settled = true;
    if (terminalDrainTimer) clearTimeout(terminalDrainTimer);
    unwatchFile(eventsPath, onWatch);
  }
}

async function readStoredEvents(store: RunStore, runId: string): Promise<RunsEventV0[]> {
  const events: RunsEventV0[] = [];
  for await (const ev of store.readEventsJSONL(runId)) {
    events.push(ev);
  }
  return events;
}

function filterEvents(
  events: RunsEventV0[],
  roleFilter: string | undefined,
  kindFilter: string | undefined,
  sinceFilter: string | undefined,
): RunsEventV0[] {
  return applySinceFilter(events, sinceFilter).filter((ev) => {
    if (roleFilter && ev.role !== roleFilter) return false;
    if (kindFilter && ev.kind !== kindFilter) return false;
    return true;
  });
}

function applySinceFilter(events: RunsEventV0[], sinceFilter: string | undefined): RunsEventV0[] {
  if (!sinceFilter) return events;

  if (isTimestampLike(sinceFilter)) {
    const sinceMs = Date.parse(sinceFilter);
    return events.filter((ev) => Date.parse(ev.occurredAt) > sinceMs);
  }

  const index = events.findIndex((ev) => ev.eventId === sinceFilter);
  return index >= 0 ? events.slice(index + 1) : [];
}

function isTimestampLike(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}T/.test(value) && !Number.isNaN(Date.parse(value));
}

async function handleArtifact(
  store: RunStore,
  runId: string | undefined,
): Promise<void> {
  if (!runId) fail("Missing <runId> argument for 'artifact'");

  const content = await store.readArtifact(runId);
  if (content === null) {
    fail(`No artifact found for run: ${runId}`);
  }
  console.log(content);
}

async function handleEvidence(
  store: RunStore,
  runId: string | undefined,
  jsonMode: boolean,
): Promise<void> {
  if (!runId) fail("Missing <runId> argument for 'evidence'");

  const evidence = await store.readEvidence(runId);

  if (!evidence.md && !evidence.json) {
    console.log(`No evidence packet for this run (pre-MVP-beta run): ${runId}`);
    return;
  }

  if (jsonMode) {
    if (!evidence.json) {
      console.log(`No evidence packet for this run (pre-MVP-beta run): ${runId}`);
      return;
    }
    console.log(JSON.stringify(evidence.json, null, 2));
  } else {
    if (evidence.json) {
      console.log(renderEvidenceMarkdown(evidence.json));
      return;
    }
    if (!evidence.md) {
      console.log(`No evidence packet for this run (pre-MVP-beta run): ${runId}`);
      return;
    }
    console.log(evidence.md);
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.stack : String(err));
  process.exitCode = 1;
});
