import { mkdir, writeFile, appendFile, readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import { existsSync } from "node:fs";
import type {
  AgentEvent,
  BlockerReasonV0,
  EvidencePacketV0,
  FinalArtifact,
  RunsEventV0,
  RunsListItemV0,
} from "../contracts/types.js";
import { redactEventPayload, redactSecrets, validateEvidencePacketV0 } from "./evidence.js";
import { normalizeBlockerReason } from "./blocker-classifier.js";

/**
 * Disk-backed run state. MVP keeps it minimal:
 *   .pluto/runs/<runId>/events.jsonl   — append-only event log
 *   .pluto/runs/<runId>/artifact.md    — final artifact (overwritten once)
 *
 * The store is process-local and synchronous-ish; it is acceptable for a
 * single-tenant control plane that runs one team at a time.
 */
export class RunStore {
  private readonly dataDir: string;

  constructor(opts: { dataDir?: string } = {}) {
    this.dataDir = opts.dataDir ?? process.env.PLUTO_DATA_DIR ?? ".pluto";
  }

  runDir(runId: string): string {
    return join(this.dataDir, "runs", runId);
  }

  async ensure(runId: string): Promise<void> {
    await mkdir(this.runDir(runId), { recursive: true });
  }

  async appendEvent(event: AgentEvent): Promise<void> {
    await this.ensure(event.runId);
    const persistedEvent = sanitizeEventForPersistence(event);
    await appendFile(
      join(this.runDir(event.runId), "events.jsonl"),
      JSON.stringify(persistedEvent) + "\n",
      "utf8",
    );
  }

  async writeArtifact(artifact: FinalArtifact): Promise<string> {
    await this.ensure(artifact.runId);
    const path = join(this.runDir(artifact.runId), "artifact.md");
    await writeFile(path, redactSecrets(artifact.markdown), "utf8");
    return path;
  }

  async listRunDirs(): Promise<string[]> {
    const runsDir = join(this.dataDir, "runs");
    try {
      const entries = await readdir(runsDir, { withFileTypes: true });
      return entries.filter((e) => e.isDirectory()).map((e) => e.name);
    } catch {
      return [];
    }
  }

  async readRunMeta(runId: string): Promise<RunsListItemV0 | null> {
    const dir = this.runDir(runId);
    const eventsPath = join(dir, "events.jsonl");

    let eventsRaw: string;
    try {
      eventsRaw = await readFile(eventsPath, "utf8");
    } catch {
      return null;
    }

    const events: AgentEvent[] = [];
    let parseWarnings = 0;
    for (const line of eventsRaw.split("\n")) {
      if (!line.trim()) continue;
      try {
        events.push(JSON.parse(line) as AgentEvent);
      } catch {
        parseWarnings++;
        continue;
      }
    }

    if (events.length === 0) return null;

    const startEvent = events.find((e) => e.type === "run_started");
    const endEvent = events.find(
      (e) => e.type === "run_completed" || e.type === "run_failed",
    );

    const evidence = await this.readEvidence(runId);
    const taskTitle = String(
      evidence.json?.taskTitle ?? startEvent?.payload?.["title"] ?? startEvent?.payload?.["taskId"] ?? startEvent?.payload?.["prompt"] ?? runId,
    ).slice(0, 100);
    const workerCount = events.filter((e) => e.type === "worker_completed").length;
    const artifactPresent = existsSync(join(dir, "artifact.md"));
    const evidencePresent = existsSync(join(dir, "evidence.json"));

    let status: RunsListItemV0["status"] = "running";
    let blockerReason: BlockerReasonV0 | null = null;

    if (endEvent?.type === "run_completed") {
      status = "done";
    } else if (endEvent?.type === "run_failed") {
      const blockerEvent = [...events].reverse().find((e) => e.type === "blocker");
      if (blockerEvent) {
        status = "blocked";
        const context = typeof blockerEvent.payload?.["message"] === "string" ? blockerEvent.payload["message"] : "";
        blockerReason = normalizeBlockerReason(blockerEvent.payload?.["reason"], context) ?? "unknown";
      } else {
        status = "failed";
        const failMsg = String(endEvent.payload?.["message"] ?? "");
        if (failMsg.includes("timeout")) {
          blockerReason = "runtime_timeout";
          status = "blocked";
        }
      }
    }

    return {
      schemaVersion: 0,
      runId,
      taskTitle,
      status,
      blockerReason,
      startedAt: events[0]!.ts,
      finishedAt: endEvent?.ts ?? null,
      parseWarnings,
      workerCount,
      artifactPresent,
      evidencePresent,
    };
  }

  async *readEventsRaw(runId: string): AsyncIterable<AgentEvent> {
    const eventsPath = join(this.runDir(runId), "events.jsonl");
    let content: string;
    try {
      content = await readFile(eventsPath, "utf8");
    } catch {
      return;
    }
    for (const line of content.trim().split("\n")) {
      if (!line) continue;
      yield JSON.parse(line) as AgentEvent;
    }
  }

  async *readEventsJSONL(runId: string): AsyncIterable<RunsEventV0> {
    for await (const ev of this.readEventsRaw(runId)) {
      const payload = redactEventPayload(normalizeEventPayload(ev));
      yield {
        schemaVersion: 0,
        runId: ev.runId,
        eventId: ev.id,
        occurredAt: ev.ts,
        role: ev.roleId ?? null,
        kind: ev.type,
        attempt: (ev.payload?.["attempt"] as number) ?? 1,
        payload,
      };
    }
  }

  async readArtifact(runId: string): Promise<string | null> {
    const path = join(this.runDir(runId), "artifact.md");
    try {
      return redactSecrets(await readFile(path, "utf8"));
    } catch {
      return null;
    }
  }

  async readEvidence(runId: string): Promise<{ md: string | null; json: EvidencePacketV0 | null }> {
    const dir = this.runDir(runId);
    let md: string | null = null;
    let json: EvidencePacketV0 | null = null;

    try {
      md = await readFile(join(dir, "evidence.md"), "utf8");
    } catch { /* absent */ }

    try {
      const raw = await readFile(join(dir, "evidence.json"), "utf8");
      const parsed: unknown = JSON.parse(raw);
      if (validateEvidencePacketV0(parsed).ok) {
        json = {
          ...(parsed as EvidencePacketV0),
          blockerReason: normalizeBlockerReason((parsed as EvidencePacketV0).blockerReason),
        };
      }
    } catch { /* absent */ }

    return { md, json };
  }
}

export function sanitizeEventForPersistence(event: AgentEvent): AgentEvent {
  const { transient: _transient, ...persistableEvent } = event;
  return {
    ...persistableEvent,
    payload: redactEventPayload(persistableEvent.payload) as AgentEvent["payload"],
  };
}

function normalizeEventPayload(ev: AgentEvent): unknown {
  if (ev.type !== "blocker" || typeof ev.payload !== "object" || ev.payload === null) return ev.payload;
  const context = typeof ev.payload["message"] === "string" ? ev.payload["message"] : "";
  return {
    ...ev.payload,
    reason: normalizeBlockerReason(ev.payload["reason"], context) ?? "unknown",
  };
}
