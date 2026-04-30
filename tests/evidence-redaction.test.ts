import { describe, expect, it } from "vitest";
import {
  redactObject,
  redactString,
  redactWorkspacePath,
  summarizeProviderStderr,
} from "@/orchestrator/redactor.js";

describe("evidence redaction", () => {
  it("redacts known secret env name values when present in process.env", () => {
    const original = process.env["CLAUDE_CODE_OAUTH_TOKEN"];
    process.env["CLAUDE_CODE_OAUTH_TOKEN"] = "super-secret-token-value-12345";
    try {
      const text = "The token is super-secret-token-value-12345 and was used";
      const result = redactString(text);
      expect(result).not.toContain("super-secret-token-value-12345");
      expect(result).toContain("[REDACTED]");
    } finally {
      if (original !== undefined) {
        process.env["CLAUDE_CODE_OAUTH_TOKEN"] = original;
      } else {
        delete process.env["CLAUDE_CODE_OAUTH_TOKEN"];
      }
    }
  });

  it("redacts env-style KEY=VALUE patterns", () => {
    const cases = [
      "ANTHROPIC_API_KEY=sk-ant-1234567890abcdef",
      "OPENCODE_API_KEY=oc-key-abcdef12345",
      "MY_SECRET=hidden-value",
      "LARK_APP_ID=cli_a1b2c3d4e5f6",
      "FEISHU_APP_SECRET=feishu-secret-value",
      "DATABASE_URL=postgres://user:pass@host/db",
      "OPENAI_BASE_URL=https://example.internal/v1",
      "DATABASE_PASSWORD=p@ssw0rd!",
      "SERVICE_TOKEN=tok_12345",
    ];
    for (const input of cases) {
      const result = redactString(input);
      expect(result).toBe("[REDACTED]");
    }
  });

  it("redacts JWT-like tokens", () => {
    const jwt = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8U";
    const result = redactString(`Bearer ${jwt}`);
    expect(result).not.toContain(jwt);
  });

  it("redacts GitHub token patterns", () => {
    const ghToken = "ghp_ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklm";
    const result = redactString(`token: ${ghToken}`);
    expect(result).not.toContain(ghToken);
  });

  it("redacts sk-prefixed API keys", () => {
    const apiKey = "sk-ant-api03-abcdefghijklmnop";
    const result = redactString(`key: ${apiKey}`);
    expect(result).not.toContain(apiKey);
  });

  it("preserves normal text without secrets", () => {
    const text = "This is a normal log message about run processing";
    const result = redactString(text);
    expect(result).toBe(text);
  });

  it("does not over-redact lowercase prose assignments", () => {
    const text = "normal prose says key=value and path=relative/file";
    expect(redactString(text)).toBe(text);
  });

  it("redacts multiple secrets in same string", () => {
    const text = "OPENROUTER_API_KEY=or-key-123 and also DAYTONA_API_KEY=dayt-456";
    const result = redactString(text);
    expect(result).not.toContain("or-key-123");
    expect(result).not.toContain("dayt-456");
    expect(result).not.toContain("OPENROUTER_API_KEY");
    expect(result).not.toContain("DAYTONA_API_KEY");
    expect(result).toBe("[REDACTED] and also [REDACTED]");
  });

  it("redacts absolute workspace paths but preserves relative ones", () => {
    expect(redactWorkspacePath("/tmp/pluto/worktree")).toBe("[REDACTED:workspace-path]");
    expect(redactWorkspacePath("relative/worktree")).toBe("relative/worktree");
  });

  it("summarizes provider stderr to one line", () => {
    const stderr = [
      "provider failed with ANTHROPIC_API_KEY=sk-ant-real-key-here",
      "stack line 1",
      "stack line 2",
    ].join("\n");
    const result = summarizeProviderStderr(stderr);
    expect(result).not.toContain("sk-ant-real-key-here");
    expect(result).not.toContain("\n");
    expect(result).toContain("[stderr 3 lines]");
  });

  it("summarizes stderr-like object fields without collapsing normal strings", () => {
    const result = redactObject({
      stderr: "DATABASE_URL=postgres://user:pass@host/db\ntrace line",
      debug_output: "FEISHU_APP_SECRET=super-secret\nmore detail",
      note: "Plan step 1\nPlan step 2",
    }) as { stderr: string; debug_output: string; note: string };

    expect(result.stderr).toBe("[REDACTED] [stderr 2 lines]");
    expect(result.debug_output).toBe("[REDACTED] [stderr 2 lines]");
    expect(result.note).toBe("Plan step 1\nPlan step 2");
  });

  it("redacts absolute path fields without redacting ordinary prose", () => {
    const result = redactObject({
      path: "/tmp/pluto/runs/run-123/artifact.md",
      artifactPath: "/tmp/pluto/runs/run-123/artifact.md",
      workspacePath: "/tmp/pluto/worktree",
      note: "artifact written to /tmp/pluto/runs/run-123/artifact.md",
    }) as {
      path: string;
      artifactPath: string;
      workspacePath: string;
      note: string;
    };

    expect(result.path).toBe("[REDACTED:path]");
    expect(result.artifactPath).toBe("[REDACTED:path]");
    expect(result.workspacePath).toBe("[REDACTED:workspace-path]");
    expect(result.note).toBe("artifact written to /tmp/pluto/runs/run-123/artifact.md");
  });
});
