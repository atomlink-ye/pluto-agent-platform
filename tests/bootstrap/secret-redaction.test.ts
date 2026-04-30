import { describe, expect, it } from "vitest";

import {
  assertRedactionSafeV0,
  collectRawSecretLeaksV0,
  isRedactionSafeV0,
} from "@/bootstrap/redaction-checks.js";

const targets = [
  {
    envName: "OPENCODE_API_KEY",
    secretRef: "opencode://secrets/OPENCODE_API_KEY",
    rawValue: "sk-opencode-1234567890abcdefghijklmnop",
  },
];

describe("bootstrap secret redaction checks", () => {
  it("accepts workflow and audit surfaces that keep only env names and secret refs", () => {
    const safeRecord = {
      workflowRecord: {
        envRefs: ["OPENCODE_BASE_URL"],
        secretRefs: ["opencode://secrets/OPENCODE_API_KEY"],
      },
      runRequest: {
        prompt: "Use OPENCODE_API_KEY through opencode://secrets/OPENCODE_API_KEY only.",
      },
      artifact: {
        markdown: "Credential sourced from OPENCODE_API_KEY.",
      },
      evidence: {
        citedInputs: {
          taskPrompt: "Requires OPENCODE_API_KEY ref only.",
        },
      },
      auditSummary: {
        text: "Allowed secret ref opencode://secrets/OPENCODE_API_KEY.",
      },
      failureText: "Missing OPENCODE_API_KEY secret ref.",
    };

    expect(isRedactionSafeV0(safeRecord, targets)).toBe(true);
    expect(() => assertRedactionSafeV0(safeRecord, targets)).not.toThrow();
  });

  it("finds raw secret leaks across workflow records, run requests, artifacts, evidence, audit summaries, and failure text", () => {
    const unsafeRecord = {
      workflowRecord: {
        resolvedSecret: "sk-opencode-1234567890abcdefghijklmnop",
      },
      runRequest: {
        prompt: "Use sk-opencode-1234567890abcdefghijklmnop directly.",
      },
      artifact: {
        markdown: "Token sk-opencode-1234567890abcdefghijklmnop leaked.",
      },
      evidence: {
        validation: {
          reason: "Observed sk-opencode-1234567890abcdefghijklmnop in stdout.",
        },
      },
      auditSummary: {
        text: "audit saw sk-opencode-1234567890abcdefghijklmnop",
      },
      failureText: "credential sk-opencode-1234567890abcdefghijklmnop missing",
    };

    const leaks = collectRawSecretLeaksV0(unsafeRecord, targets);

    expect(leaks.map((entry) => entry.path)).toEqual([
      "$.workflowRecord.resolvedSecret",
      "$.runRequest.prompt",
      "$.artifact.markdown",
      "$.evidence.validation.reason",
      "$.auditSummary.text",
      "$.failureText",
    ]);
    expect(() => assertRedactionSafeV0(unsafeRecord, targets)).toThrow(
      /bootstrap_secret_redaction_failed/,
    );
  });
});
