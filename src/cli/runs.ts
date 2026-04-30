#!/usr/bin/env node
import { readFile } from "node:fs/promises";
import { resolve, join } from "node:path";
import process from "node:process";
import { RunStore } from "../orchestrator/run-store.js";
import type {
  RunsListOutputV0,
  RunsShowOutputV0,
  RunsEventV0,
  EvidencePacketV0,
} from "../contracts/types.js";
import { renderEvidenceMarkdown } from "../orchestrator/evidence.js";

const VALID_ROLES = ["lead", "planner", "generator", "evaluator"] as const;
const VALID_KINDS = [
  "dispatch", "message", "artifact", "summary", "blocker", "retry",
  "run_started", "lead_started", "worker_requested", "worker_started",
  "worker_completed", "lead_message", "orchestrator_underdispatch_fallback",
  "artifact_created", "run_completed", "run_failed",
] as const;

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
    } else {
      positional.push(arg);
    }
  }

  return { subcommand, positional, flags };
}

async function main() {
  const dataDir = resolve(process.env["PLUTO_DATA_DIR"] ?? ".pluto");
  const store = new RunStore({ dataDir });
  const { subcommand, positional, flags } = parseArgs(process.argv.slice(2));

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
  const limit = typeof flags["limit"] === "string" ? parseInt(flags["limit"], 10) : undefined;
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

  const events: import("../contracts/types.js").AgentEvent[] = [];
  for await (const ev of store.readEventsRaw(runId)) {
    events.push(ev);
  }

  const workerMap = new Map<string, {
    sessionId: string | null;
    status: "pending" | "running" | "done" | "failed" | "timed_out";
    contributionSummary: string | null;
  }>();

  for (const ev of events) {
    const role = String(ev.roleId ?? "");
    if (!role) continue;
    if (ev.type === "worker_started") {
      workerMap.set(role, {
        sessionId: ev.sessionId ?? null,
        status: "running",
        contributionSummary: null,
      });
    } else if (ev.type === "worker_completed") {
      const existing = workerMap.get(role);
      if (existing) {
        existing.status = "done";
        existing.contributionSummary = String(ev.payload?.["output"] ?? "").slice(0, 200) || null;
      } else {
        workerMap.set(role, {
          sessionId: ev.sessionId ?? null,
          status: "done",
          contributionSummary: String(ev.payload?.["output"] ?? "").slice(0, 200) || null,
        });
      }
    }
  }

  const runDir = store.runDir(runId);
  const artifactContent = await store.readArtifact(runId);
  const evidence = await store.readEvidence(runId);
  let blockerEvent: import("../contracts/types.js").AgentEvent | undefined;
  for (let i = events.length - 1; i >= 0; i--) {
    if (events[i]!.type === "blocker") {
      blockerEvent = events[i];
      break;
    }
  }
  const blockerMessage = typeof blockerEvent?.payload?.["message"] === "string"
    ? blockerEvent.payload["message"]
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
      workspace: evidence.json?.workspace ?? null,
      workers: Array.from(workerMap.entries()).map(([role, info]) => ({
        role,
        sessionId: info.sessionId,
        status: info.status,
        contributionSummary: info.contributionSummary,
      })),
      artifactPath: artifactContent ? join(runDir, "artifact.md") : null,
      evidencePath: evidence.json ? join(runDir, "evidence.json") : null,
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
  const allRawEvents: RunsEventV0[] = [];
  for await (const ev of store.readEventsJSONL(runId)) {
    allRawEvents.push(ev);
  }

  const sinceEvents = applySinceFilter(allRawEvents, sinceFilter);
  const allEvents = sinceEvents.filter((ev) => {
    if (roleFilter && ev.role !== roleFilter) return false;
    if (kindFilter && ev.kind !== kindFilter) return false;
    return true;
  });

  if (jsonMode) {
    if (follow) {
      for (const ev of allEvents) {
        console.log(JSON.stringify(ev));
      }
    } else {
      console.log(JSON.stringify(allEvents, null, 2));
    }
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
