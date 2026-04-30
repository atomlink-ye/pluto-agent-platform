import { describe, expect, it } from "vitest";

import type { AgentEvent } from "@/contracts/types.js";
import {
  buildAdapterCallbackIdentity,
  CallbackNormalizer,
  getCallbackIdentity,
} from "@/runtime/callback-normalizer.js";

describe("CallbackNormalizer", () => {
  it("dedupes duplicate artifact, blocker, and completion callbacks by stable identity", () => {
    const normalizer = new CallbackNormalizer();
    const events = [
      event("artifact_created", { path: "/tmp/artifact.md" }, {
        batchId: "batch-artifact",
        lineageKey: "artifact:/tmp/artifact.md",
        status: "completed",
        dedupeParts: ["artifact_created", "/tmp/artifact.md"],
      }),
      duplicateOf(event("artifact_created", { path: "/tmp/artifact.md" }, {
        batchId: "batch-artifact",
        lineageKey: "artifact:/tmp/artifact.md",
        status: "completed",
        dedupeParts: ["artifact_created", "/tmp/artifact.md"],
      }), "event-2"),
      event("blocker", { reason: "validation_failed", message: "bad artifact" }, {
        batchId: "batch-blocker",
        lineageKey: "blocker:validation_failed",
        status: "blocked",
        dedupeParts: ["blocker", "validation_failed", "bad artifact"],
      }),
      duplicateOf(event("blocker", { reason: "validation_failed", message: "bad artifact" }, {
        batchId: "batch-blocker",
        lineageKey: "blocker:validation_failed",
        status: "blocked",
        dedupeParts: ["blocker", "validation_failed", "bad artifact"],
      }), "event-4"),
      event("run_completed", { workerCount: 2 }, {
        batchId: "batch-terminal",
        lineageKey: "run:run-1",
        status: "completed",
        dedupeParts: ["run_completed", 2],
      }),
      duplicateOf(event("run_completed", { workerCount: 2 }, {
        batchId: "batch-terminal",
        lineageKey: "run:run-1",
        status: "completed",
        dedupeParts: ["run_completed", 2],
      }), "event-6"),
    ];

    expect(normalizer.normalize(events).map((item) => item.type)).toEqual([
      "artifact_created",
      "blocker",
      "run_completed",
    ]);
  });

  it("preserves blocked as non-terminal and accepts a later completion for the same lineage", () => {
    const normalizer = new CallbackNormalizer();
    const blocked = event("blocker", { reason: "runtime_timeout", message: "still retrying" }, {
      batchId: "batch-1",
      lineageKey: "worker:planner:attempt:1",
      status: "blocked",
      dedupeParts: ["blocked", "planner", 1],
    });
    const completed = event("worker_completed", { output: "done", attempt: 1 }, {
      batchId: "batch-2",
      lineageKey: "worker:planner:attempt:1",
      status: "completed",
      dedupeParts: ["worker_completed", "planner", 1, "done"],
    });

    expect(normalizer.normalize([blocked, completed]).map((item) => item.type)).toEqual([
      "blocker",
      "worker_completed",
    ]);
  });

  it("allows only one effective terminal completion per lineage", () => {
    const normalizer = new CallbackNormalizer();
    const completed = event("lead_message", { kind: "summary", markdown: "first" }, {
      batchId: "batch-1",
      lineageKey: "lead_summary:lead-1",
      status: "completed",
      dedupeParts: ["lead_message", "lead-1", "summary", "first"],
    });
    const conflicting = event("lead_message", { kind: "summary", markdown: "second" }, {
      batchId: "batch-2",
      lineageKey: "lead_summary:lead-1",
      status: "completed",
      dedupeParts: ["lead_message", "lead-1", "summary", "second"],
    });

    const normalized = normalizer.normalize([completed, conflicting]);
    expect(normalized).toHaveLength(1);
    expect(normalized[0]?.payload["markdown"]).toBe("first");
  });

  it("falls back to inferred identity for legacy events without callback metadata", () => {
    const eventWithoutCallback: AgentEvent = {
      id: "legacy-1",
      runId: "run-1",
      ts: "2026-04-30T00:00:00.000Z",
      type: "worker_completed",
      roleId: "planner",
      sessionId: "planner-session",
      payload: { output: "done", attempt: 1 },
    };

    const identity = getCallbackIdentity(eventWithoutCallback);
    expect(identity.source).toBe("legacy_adapter");
    expect(identity.lineageKey).toBe("worker:run-1:planner:1");
  });
});

function event(
  type: AgentEvent["type"],
  payload: Record<string, unknown>,
  callback: {
    batchId: string;
    lineageKey: string;
    status: "in_progress" | "blocked" | "completed" | "failed";
    dedupeParts: ReadonlyArray<unknown>;
  },
): AgentEvent {
  return {
    id: `id-${callback.batchId}`,
    runId: "run-1",
    ts: "2026-04-30T00:00:00.000Z",
    type,
    payload,
    transient: {
      callback: buildAdapterCallbackIdentity({
        source: "test",
        batchId: callback.batchId,
        lineageKey: callback.lineageKey,
        status: callback.status,
        dedupeParts: callback.dedupeParts,
      }),
    },
  };
}

function duplicateOf(event: AgentEvent, id: string): AgentEvent {
  return {
    ...event,
    id,
  };
}
