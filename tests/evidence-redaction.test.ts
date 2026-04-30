import { describe, expect, it } from "vitest";
import { redactSecrets } from "@/orchestrator/evidence.js";

describe("evidence redaction", () => {
  it("redacts known secret env name values when present in process.env", () => {
    const original = process.env["CLAUDE_CODE_OAUTH_TOKEN"];
    process.env["CLAUDE_CODE_OAUTH_TOKEN"] = "super-secret-token-value-12345";
    try {
      const text = "The token is super-secret-token-value-12345 and was used";
      const result = redactSecrets(text);
      expect(result).not.toContain("super-secret-token-value-12345");
      expect(result).toContain("[REDACTED:CLAUDE_CODE_OAUTH_TOKEN]");
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
      "DATABASE_PASSWORD=p@ssw0rd!",
      "SERVICE_TOKEN=tok_12345",
    ];
    for (const input of cases) {
      const result = redactSecrets(input);
      expect(result).toContain("[REDACTED]");
      const key = input.split("=")[0]!;
      expect(result).toContain(key);
    }
  });

  it("redacts JWT-like tokens", () => {
    const jwt = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8U";
    const result = redactSecrets(`Bearer ${jwt}`);
    expect(result).not.toContain(jwt);
  });

  it("redacts GitHub token patterns", () => {
    const ghToken = "ghp_ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklm";
    const result = redactSecrets(`token: ${ghToken}`);
    expect(result).not.toContain(ghToken);
  });

  it("redacts sk-prefixed API keys", () => {
    const apiKey = "sk-ant-api03-abcdefghijklmnop";
    const result = redactSecrets(`key: ${apiKey}`);
    expect(result).not.toContain(apiKey);
  });

  it("preserves normal text without secrets", () => {
    const text = "This is a normal log message about run processing";
    const result = redactSecrets(text);
    expect(result).toBe(text);
  });

  it("redacts raw provider stderr content", () => {
    const stderrContent = "ANTHROPIC_API_KEY=sk-ant-real-key-here stderr output";
    const result = redactSecrets(stderrContent);
    expect(result).not.toContain("sk-ant-real-key-here");
    expect(result).toContain("[REDACTED]");
  });

  it("redacts multiple secrets in same string", () => {
    const text = "OPENROUTER_API_KEY=or-key-123 and also DAYTONA_API_KEY=dayt-456";
    const result = redactSecrets(text);
    expect(result).not.toContain("or-key-123");
    expect(result).not.toContain("dayt-456");
    expect(result).toContain("OPENROUTER_API_KEY=[REDACTED]");
    expect(result).toContain("DAYTONA_API_KEY=[REDACTED]");
  });
});
