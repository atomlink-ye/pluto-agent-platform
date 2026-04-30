import { createHash } from "node:crypto";

import type { AgentEvent } from "../contracts/types.js";

export type AdapterCallbackStatus =
  | "in_progress"
  | "blocked"
  | "completed"
  | "failed";

export interface AdapterCallbackIdentity {
  source: string;
  batchId: string;
  eventId: string;
  lineageKey: string;
  status: AdapterCallbackStatus;
}

export function buildAdapterCallbackIdentity(input: {
  source: string;
  batchId: string;
  lineageKey: string;
  status: AdapterCallbackStatus;
  dedupeParts: ReadonlyArray<unknown>;
}): AdapterCallbackIdentity {
  return {
    source: input.source,
    batchId: input.batchId,
    lineageKey: input.lineageKey,
    status: input.status,
    eventId: hashIdentityParts(input.dedupeParts),
  };
}

export class CallbackNormalizer {
  private readonly seenEventIds = new Set<string>();
  private readonly terminalByLineage = new Map<string, AdapterCallbackStatus>();

  normalize(events: readonly AgentEvent[]): AgentEvent[] {
    const normalized: AgentEvent[] = [];
    for (const event of events) {
      const callback = getCallbackIdentity(event);
      if (this.seenEventIds.has(callback.eventId)) {
        continue;
      }
      const priorTerminal = this.terminalByLineage.get(callback.lineageKey);
      if (priorTerminal && isTerminalStatus(callback.status)) {
        continue;
      }
      this.seenEventIds.add(callback.eventId);
      if (isTerminalStatus(callback.status)) {
        this.terminalByLineage.set(callback.lineageKey, callback.status);
      }
      normalized.push(withCallbackIdentity(event, callback));
    }
    return normalized;
  }
}

export function getCallbackIdentity(event: AgentEvent): AdapterCallbackIdentity {
  return event.transient?.callback ?? inferCallbackIdentity(event);
}

function withCallbackIdentity(event: AgentEvent, callback: AdapterCallbackIdentity): AgentEvent {
  return {
    ...event,
    transient: {
      ...event.transient,
      callback,
    },
  };
}

function inferCallbackIdentity(event: AgentEvent): AdapterCallbackIdentity {
  const status = inferCallbackStatus(event);
  return buildAdapterCallbackIdentity({
    source: "legacy_adapter",
    batchId: `legacy:${event.runId}:${event.type}`,
    lineageKey: inferLineageKey(event),
    status,
    dedupeParts: [
      event.runId,
      event.type,
      event.roleId ?? null,
      event.sessionId ?? null,
      event.transient?.rawPayload ?? null,
      event.payload,
    ],
  });
}

function inferCallbackStatus(event: AgentEvent): AdapterCallbackStatus {
  if (event.type === "blocker") return "blocked";
  if (event.type === "run_failed") return "failed";
  if (
    event.type === "run_completed" ||
    event.type === "worker_completed" ||
    (event.type === "lead_message" && event.payload?.["kind"] === "summary")
  ) {
    return "completed";
  }
  return "in_progress";
}

function inferLineageKey(event: AgentEvent): string {
  if (event.type === "run_completed" || event.type === "run_failed") {
    return `run:${event.runId}`;
  }
  if (event.type === "artifact_created") {
    return `artifact:${event.runId}:${String(event.payload?.["path"] ?? "")}`;
  }
  if (event.type === "blocker") {
    return `blocker:${event.runId}:${String(event.payload?.["reason"] ?? "")}:${String(event.payload?.["sourceRole"] ?? event.roleId ?? "")}`;
  }
  if (event.type === "worker_started" || event.type === "worker_completed") {
    return `worker:${event.runId}:${event.roleId ?? ""}:${String(event.payload?.["attempt"] ?? 1)}`;
  }
  if (event.type === "lead_message" && event.payload?.["kind"] === "summary") {
    return `lead_summary:${event.runId}:${event.sessionId ?? ""}`;
  }
  if (event.type === "worker_requested") {
    return `worker_request:${event.runId}:${String(event.payload?.["targetRole"] ?? event.roleId ?? "")}`;
  }
  return `${event.type}:${event.runId}:${event.roleId ?? ""}:${event.sessionId ?? ""}`;
}

function isTerminalStatus(status: AdapterCallbackStatus): boolean {
  return status === "completed" || status === "failed";
}

function hashIdentityParts(parts: ReadonlyArray<unknown>): string {
  return createHash("sha1").update(stableStringify(parts)).digest("hex");
}

function stableStringify(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableStringify(item)).join(",")}]`;
  }
  if (value && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>).sort(([a], [b]) =>
      a.localeCompare(b),
    );
    return `{${entries.map(([key, item]) => `${JSON.stringify(key)}:${stableStringify(item)}`).join(",")}}`;
  }
  return JSON.stringify(value);
}
