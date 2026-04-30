import { describe, expect, it } from "vitest";

import type { RedactedTraceV0 } from "@/contracts/observability.js";
import { redactObservabilityRecordV0 } from "@/observability/redaction.js";

describe("observability redaction", () => {
  it("scrubs secret-shaped values, stderr, credentials, provider session ids, and external payloads", () => {
    const record: RedactedTraceV0 & {
      details: {
        providerStderr: string;
        credentialValue: string;
        providerSessionId: string;
        rawPayload: { nested: string };
      };
    } = {
      schema: "pluto.observability.redacted-trace",
      schemaVersion: 0,
      kind: "redacted_trace",
      id: "trace-1",
      workspaceId: "workspace-1",
      createdAt: "2026-04-30T00:00:00.000Z",
      updatedAt: "2026-04-30T00:00:01.000Z",
      audit: {
        eventId: "audit-1",
        eventType: "redacted_trace.recorded",
        recordedAt: "2026-04-30T00:00:00.000Z",
        correlationId: "corr-1",
        actorId: "user-1",
        principalId: "svc-1",
        action: "trace.capture",
        target: "trace-1",
        outcome: "recorded",
        reasonCode: null,
        redaction: clearRedaction(),
      },
      traceId: "trace-1",
      runId: "run-1",
      spanCount: 2,
      preview: "OPENAI_API_KEY=sk-ant-api03-abcdefghijklmnop",
      redaction: clearRedaction(),
      capturedAt: "2026-04-30T00:00:01.000Z",
      details: {
        providerStderr: "fatal ses_abcdef123456 token sk-ant-api03-qrstuvwxyzabcdef\nstack trace",
        credentialValue: "super-secret",
        providerSessionId: "sess-abcdef123456",
        rawPayload: { nested: "do-not-store" },
      },
    };
    const result = redactObservabilityRecordV0(record);

    expect(result.value.preview).toContain("[REDACTED]");
    expect(result.value.details.providerStderr).toContain("[stderr 2 lines]");
    expect(result.value.details.credentialValue).toBe("[REDACTED]");
    expect(result.value.details.providerSessionId).toBe("[REDACTED]");
    expect(result.value.details.rawPayload).toContain("[REDACTED:external-payload");
    expect(result.summary.state).toBe("redacted");
    expect(result.summary.redactedPaths).toEqual(expect.arrayContaining([
      "preview",
      "details.providerStderr",
      "details.credentialValue",
      "details.providerSessionId",
      "details.rawPayload",
    ]));
    expect(result.value.redaction.redactedPaths).toEqual(expect.arrayContaining(["preview"]));
  });
});

function clearRedaction() {
  return {
    containsSensitiveData: false,
    state: "clear",
    redactionCount: 0,
    redactedPaths: [],
  };
}
