import { describe, expect, it } from "vitest";

import { toVersionProvenanceRefsV0 } from "@/contracts/governance.js";

describe("governance backstage boundary", () => {
  it("does not leak provider session, adapter, or callback payloads into refs", () => {
    const rawProvenance = {
      latestRun: {
        runId: "run-1",
        status: "done",
        blockerReason: null,
        finishedAt: "2026-04-30T00:05:00.000Z",
        sessionId: "session-123",
        providerSessionId: "provider-session-456",
        adapter: { kind: "paseo-opencode" },
        callback: { url: "https://internal.invalid/callback" },
        rawPayload: { traceId: "secret-trace" },
      },
      latestEvidence: {
        runId: "run-1",
        evidencePath: ".pluto/runs/run-1/evidence.json",
        validation: { outcome: "pass" },
        provider: "internal-provider",
        session: { id: "session-123" },
        callbackPayload: { token: "secret" },
      },
      supportingRuns: [
        {
          runId: "run-0",
          status: "failed",
          blockerReason: "runtime_error",
          finishedAt: "2026-04-29T23:59:00.000Z",
          providerMetadata: { region: "us-test-1" },
        },
      ],
    };

    const refs = toVersionProvenanceRefsV0(rawProvenance);

    expect(Object.keys(refs.latestRun ?? {})).toEqual([
      "runId",
      "status",
      "blockerReason",
      "finishedAt",
    ]);
    expect(Object.keys(refs.latestEvidence ?? {})).toEqual([
      "runId",
      "evidencePath",
      "validationOutcome",
    ]);
    expect(Object.keys(refs.supportingRuns?.[0] ?? {})).toEqual([
      "runId",
      "status",
      "blockerReason",
      "finishedAt",
    ]);
  });
});
