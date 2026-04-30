import { describe, expect, it } from "vitest";

import { applyRedactionPolicyV0 } from "@/security/redaction.js";

describe("applyRedactionPolicyV0", () => {
  it("redacts token-shaped strings, secret env names, and dotenv assignments", () => {
    const result = applyRedactionPolicyV0({
      workspaceId: "ws-1",
      sourceSensitivity: "restricted",
      stage: "persistence",
      value: {
        env: "OPENAI_API_KEY=sk-abcdefghijklmnop123456",
        nameOnly: "Missing SESSION_TOKEN in the local env",
        token: "ghp_ABCDEFGHIJKLMNOPQRSTUVWXYZ123456",
      },
      now: "2026-04-30T00:00:00.000Z",
    });

    expect(result.value).toEqual({
      env: "[REDACTED]",
      nameOnly: "Missing [REDACTED] in the local env",
      token: "[REDACTED]",
    });
    expect(result.record.outcome).toBe("redacted");
    expect(result.summary.categories).toEqual(expect.arrayContaining(["dotenv_assignment", "secret_env_name", "token"]));
  });

  it("summarizes raw provider stderr, private runtime refs, and transcript payloads", () => {
    const result = applyRedactionPolicyV0({
      workspaceId: "ws-1",
      sourceSensitivity: "confidential",
      stage: "display",
      value: {
        stderr: "provider failed for ses_12345678 with OPENAI_API_KEY=sk-abcdefghijklmnop123456\nstack line 1\nstack line 2",
        runtime: "run_12345678",
        transcript: [
          "user: first long line",
          "assistant: second long line",
          "assistant: third long line",
          "assistant: fourth long line",
          "assistant: fifth long line",
        ],
      },
      now: "2026-04-30T00:00:00.000Z",
    });

    const value = result.value as { stderr: string; runtime: string; transcript: string };
    expect(value.stderr).toContain("[stderr 3 lines]");
    expect(value.stderr).not.toContain("OPENAI_API_KEY");
    expect(value.stderr).not.toContain("ses_12345678");
    expect(value.runtime).toBe("[REDACTED]");
    expect(value.transcript).toContain("[transcript summary: 5 lines]");
    expect(result.summary.categories).toEqual(expect.arrayContaining(["provider_stderr", "private_runtime_ref", "transcript_summary"]));
  });
});
