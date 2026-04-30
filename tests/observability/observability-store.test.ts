import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { AdapterHealthSummaryV0, RunHealthSummaryV0 } from "@/contracts/observability.js";
import { ObservabilityStore } from "@/observability/observability-store.js";

let workDir: string;
let dataDir: string;

beforeEach(async () => {
  workDir = await mkdtemp(join(tmpdir(), "pluto-observability-store-test-"));
  dataDir = join(workDir, ".pluto");
});

afterEach(async () => {
  await rm(workDir, { recursive: true, force: true });
});

describe("ObservabilityStore", () => {
  it("persists redacted observability records and reads them back", async () => {
    const store = new ObservabilityStore({ dataDir });

    await store.put(makeRunHealthRecord({
      id: "run-health-1",
      runId: "run-1",
      status: "blocked",
      blockerReason: "runtime_timeout",
      summary: "dotenv OPENAI_API_KEY=sk-ant-api03-abcdefghijklmnop",
      audit: {
        eventId: "audit-1",
        eventType: "run_health_summary.recorded",
        recordedAt: "2026-04-30T00:00:01.000Z",
        correlationId: "corr-1",
        actorId: "user-1",
        principalId: "svc-1",
        reasonCode: "operator_approved",
        redaction: {
          containsSensitiveData: false,
          state: "clear",
          redactionCount: 0,
          redactedPaths: [],
        },
        action: "run.observe",
        target: "run-1",
        outcome: "blocked",
        scheduleId: "nightly",
        costClass: "premium",
      },
      traceRef: { kind: "redacted_trace", id: "trace-1" },
      evidenceRefs: ["evidence:1"],
      observedAt: "2026-04-30T00:00:02.000Z",
      details: {
        providerStderr: "fatal session ses_123456789 token sk-ant-api03-qrstuvwxyzabcdef",
        providerSessionId: "ses_123456789",
        credentialValue: "db-password",
        externalPayload: { raw: "should-not-persist" },
      },
    }));

    const stored = await store.get("run_health_summary", "run-health-1") as RunHealthSummaryV0 | null;
    expect(stored).not.toBeNull();
    expect(stored?.summary).toContain("[REDACTED]");
    expect(JSON.stringify(stored)).not.toContain("sk-ant-api03-abcdefghijklmnop");
    expect(JSON.stringify(stored)).not.toContain("should-not-persist");
    expect(stored?.audit.redaction.state).toBe("redacted");
    expect(stored?.audit.redaction.redactedPaths).toEqual(expect.arrayContaining([
      "summary",
      "details.providerStderr",
      "details.providerSessionId",
      "details.credentialValue",
      "details.externalPayload",
    ]));

    const raw = await readFile(
      join(dataDir, "observability", "local-v0", "run_health_summary", "run-health-1.json"),
      "utf8",
    );
    expect(raw).not.toContain("sk-ant-api03-abcdefghijklmnop");
    expect(raw).not.toContain("should-not-persist");
  });

  it("queries records by workspace, time range, audit envelope, and compatibility helper fields", async () => {
    const store = new ObservabilityStore({ dataDir });

    await store.put(makeRunHealthRecord({
      id: "run-health-1",
      runId: "run-1",
      workspaceId: "workspace-1",
      status: "blocked",
      blockerReason: "runtime_timeout",
      observedAt: "2026-04-30T00:10:00.000Z",
      audit: {
        eventId: "audit-1",
        eventType: "run_health_summary.recorded",
        recordedAt: "2026-04-30T00:09:59.000Z",
        correlationId: "corr-1",
        actorId: "user-1",
        principalId: "svc-1",
        reasonCode: "operator_approved",
        redaction: clearRedaction(),
        action: "run.observe",
        target: "run-1",
        outcome: "blocked",
        scheduleId: "nightly",
        costClass: "premium",
      },
    }));
    await store.put(makeRunHealthRecord({
      id: "run-health-2",
      runId: "run-2",
      workspaceId: "workspace-2",
      status: "succeeded",
      blockerReason: null,
      observedAt: "2026-04-30T00:20:00.000Z",
      audit: {
        eventId: "audit-2",
        eventType: "run_health_summary.recorded",
        recordedAt: "2026-04-30T00:19:59.000Z",
        correlationId: "corr-2",
        actorId: "user-2",
        principalId: "svc-2",
        reasonCode: null,
        redaction: clearRedaction(),
        action: "run.observe",
        target: "run-2",
        outcome: "succeeded",
        scheduleId: "hourly",
        costClass: "standard",
      },
    }));
    await store.put(makeAdapterHealthRecord({
      id: "adapter-health-1",
      adapterKind: "paseo-opencode",
      observedAt: "2026-04-30T00:15:00.000Z",
      audit: {
        eventId: "audit-3",
        eventType: "adapter_health_summary.recorded",
        recordedAt: "2026-04-30T00:14:59.000Z",
        correlationId: "corr-3",
        actorId: "system",
        principalId: "svc-1",
        reasonCode: null,
        redaction: clearRedaction(),
        action: "adapter.observe",
        target: "paseo-opencode",
        outcome: "degraded",
      },
    }));

    expect((await store.query({ workspaceId: "workspace-1" })).map((record) => record.id)).toEqual([
      "adapter-health-1",
      "run-health-1",
    ]);
    expect((await store.query({ correlationId: "corr-1" })).map((record) => record.id)).toEqual(["run-health-1"]);
    expect((await store.query({ actorId: "user-2", target: "run-2", outcome: "succeeded" })).map((record) => record.id)).toEqual(["run-health-2"]);
    expect((await store.query({ schedule: "nightly", costClass: "premium" })).map((record) => record.id)).toEqual(["run-health-1"]);
    expect((await store.query({ adapter: "paseo-opencode" })).map((record) => record.id)).toEqual(["adapter-health-1"]);
    expect((await store.query({ runStatus: "blocked", blockerReason: "runtime_timeout" })).map((record) => record.id)).toEqual(["run-health-1"]);
    expect((await store.query({ from: "2026-04-30T00:12:00.000Z", to: "2026-04-30T00:16:00.000Z" })).map((record) => record.id)).toEqual(["adapter-health-1"]);
  });
});

function makeRunHealthRecord(overrides: Record<string, unknown>): RunHealthSummaryV0 {
  return {
    schema: "pluto.observability.run-health-summary",
    schemaVersion: 0,
    kind: "run_health_summary",
    id: "run-health-default",
    workspaceId: "workspace-1",
    createdAt: "2026-04-30T00:00:00.000Z",
    updatedAt: "2026-04-30T00:00:01.000Z",
    audit: {
      eventId: "audit-default",
      eventType: "run_health_summary.recorded",
      recordedAt: "2026-04-30T00:00:00.000Z",
      correlationId: "corr-default",
      actorId: "user-default",
      principalId: "svc-default",
      action: "run.observe",
      target: "run-default",
      outcome: "running",
      reasonCode: null,
      redaction: clearRedaction(),
    },
    runId: "run-default",
    status: "running",
    severity: "warn",
    blockerReason: null,
    summary: "Run summary",
    traceRef: null,
    evidenceRefs: [],
    observedAt: "2026-04-30T00:00:02.000Z",
    ...overrides,
  } as unknown as RunHealthSummaryV0;
}

function makeAdapterHealthRecord(overrides: Record<string, unknown>): AdapterHealthSummaryV0 {
  return {
    schema: "pluto.observability.adapter-health-summary",
    schemaVersion: 0,
    kind: "adapter_health_summary",
    id: "adapter-default",
    workspaceId: "workspace-1",
    createdAt: "2026-04-30T00:00:00.000Z",
    updatedAt: "2026-04-30T00:00:01.000Z",
    audit: {
      eventId: "audit-adapter-default",
      eventType: "adapter_health_summary.recorded",
      recordedAt: "2026-04-30T00:00:00.000Z",
      correlationId: "corr-adapter-default",
      actorId: "system",
      principalId: "svc-default",
      action: "adapter.observe",
      target: "adapter-1",
      outcome: "healthy",
      reasonCode: null,
      redaction: clearRedaction(),
    },
    adapterId: "adapter-1",
    adapterKind: "fake",
    status: "healthy",
    severity: "info",
    summary: "Adapter is healthy.",
    observedAt: "2026-04-30T00:00:02.000Z",
    ...overrides,
  } as unknown as AdapterHealthSummaryV0;
}

function clearRedaction() {
  return {
    containsSensitiveData: false,
    state: "clear",
    redactionCount: 0,
    redactedPaths: [],
  };
}
