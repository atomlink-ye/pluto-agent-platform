import { describe, expect, it } from "vitest";

import {
  assertPortableBundleSafe,
  exportPortableWorkflowBundle,
  sanitizePortableBundle,
  sanitizePortableImportSource,
} from "@/portable-workflow/index.js";

describe("portable workflow export sanitization", () => {
  it("strips forbidden platform state and keeps names-only refs", () => {
    const sanitized = sanitizePortableBundle({
      schemaVersion: 0,
      manifest: {
        runtime: {
          envRefs: { required: ["OPENCODE_BASE_URL"] },
          secretRefs: { required: ["OPENCODE_API_KEY"] },
        },
      },
      review: { status: "approved" },
      approval: { approver: "team" },
      publishPackage: { id: "pkg-123" },
      runHistory: [{ runId: "run-123" }],
      credentials: { apiKey: "[REDACTED]" },
      workspacePath: "[REDACTED:workspace-path]",
      tenantId: "tenant-123",
      hostedEndpoint: "[REDACTED:endpoint]",
      queueId: "queue-123",
      providerSession: { sessionId: "agent-123" },
      note: "[REDACTED]",
    }) as Record<string, unknown>;

    expect(sanitized["review"]).toBeUndefined();
    expect(sanitized["approval"]).toBeUndefined();
    expect(sanitized["publishPackage"]).toBeUndefined();
    expect(sanitized["runHistory"]).toBeUndefined();
    expect(sanitized["credentials"]).toBeUndefined();
    expect(sanitized["workspacePath"]).toBeUndefined();
    expect(sanitized["tenantId"]).toBeUndefined();
    expect(sanitized["hostedEndpoint"]).toBeUndefined();
    expect(sanitized["queueId"]).toBeUndefined();
    expect(sanitized["providerSession"]).toBeUndefined();
    expect(sanitized["note"]).toBe("[REDACTED]");

    const manifest = sanitized["manifest"] as { runtime: { envRefs: { required: string[] }; secretRefs: { required: string[] } } };
    expect(manifest.runtime.envRefs.required).toEqual(["OPENCODE_BASE_URL"]);
    expect(manifest.runtime.secretRefs.required).toEqual(["OPENCODE_API_KEY"]);
  });

  it("rejects unsanitized secret and platform-state content", () => {
    expect(() =>
      assertPortableBundleSafe({
        schemaVersion: 0,
        manifest: {
          endpoint: "[REDACTED:endpoint]",
        },
        rawSecret: "[REDACTED]",
        path: "[REDACTED:workspace-path]",
      }),
    ).toThrow(/portable_bundle_unsafe/);
  });

  it("accepts the canonical exported bundle", () => {
    const bundle = exportPortableWorkflowBundle({ exportedAt: "2026-04-30T00:00:00.000Z" });
    expect(() => assertPortableBundleSafe(bundle)).not.toThrow();
  });

  it("redacts absolute import source paths while keeping the bundle filename", () => {
    expect(
      sanitizePortableImportSource({
        path: "[REDACTED:workspace-path]/bundle.json",
      }),
    ).toEqual({ path: "bundle.json" });

    expect(
      sanitizePortableImportSource({
        path: "fixtures/default-bundle.json",
      }),
    ).toEqual({ path: "fixtures/default-bundle.json" });
  });
});
