import { describe, expect, it } from "vitest";

import { assertPortableAssetBundleSafe, validatePortableAssetBundleV0 } from "@/contracts/portability.js";

function makeMinimalSanitizedBundle() {
  return {
    schema: "pluto.portability.bundle" as const,
    schemaVersion: 0 as const,
    bundleId: "bundle-1",
    manifest: {
      schema: "pluto.portability.manifest" as const,
      schemaVersion: 0 as const,
      bundleId: "bundle-1",
      bundleVersion: "0.1.0",
      exportedAt: "2026-04-30T00:01:00.000Z",
      assetKinds: ["evidence_summary"],
      logicalRefs: [{ kind: "evidence_summary", logicalId: "evidence.bundle-1" }],
      workflowRefs: [{ kind: "portable_workflow_bundle" as const, workflowId: "workflow-1", bundleRef: "portable-workflow://bundle/workflow-1" }],
      compatibility: {
        schemaVersion: 0 as const,
        bundle: {
          family: "pluto.portability.bundle",
          version: 0,
          writtenAt: "2026-04-30T00:00:00.000Z",
        },
        target: {
          schemaFamilies: ["pluto.portability.bundle"],
          schemaVersions: [0],
        },
        dependencies: [{ id: "portable-workflow:1", resolved: true }],
      },
      checksums: [{ algorithm: "sha256" as const, digest: "bundle-checksum" }],
      importRequirements: [{
        schema: "pluto.portability.import-requirement" as const,
        schemaVersion: 0 as const,
        code: "secret-name",
        required: true,
        description: "Name-only secret requirement",
        secretNames: ["DOCS_TARGET_TOKEN"],
      }],
      redactionSummary: {
        schema: "pluto.portability.redaction-summary" as const,
        schemaVersion: 0 as const,
        redactedFields: ["ownerPrincipalRef"],
        redactedRefKinds: ["principal"],
        excludedContent: ["tenant_private_state", "provider_payloads"],
        summary: "Private references and provider payloads were removed.",
      },
    },
    assets: [{
      schema: "pluto.portability.evidence-summary-export" as const,
      schemaVersion: 0 as const,
      kind: "evidence_summary" as const,
      id: "evidence-export-1",
      logicalRef: { kind: "evidence_summary" as const, logicalId: "evidence.bundle-1" },
      title: "Evidence Summary",
      createdAt: "2026-04-30T00:00:00.000Z",
      exportedAt: "2026-04-30T00:01:00.000Z",
      workflowRefs: [{ kind: "portable_workflow_bundle" as const, workflowId: "workflow-1", bundleRef: "portable-workflow://bundle/workflow-1" }],
      compatibility: {
        schemaVersion: 0 as const,
        bundle: {
          family: "pluto.portability.bundle",
          version: 0,
          writtenAt: "2026-04-30T00:00:00.000Z",
        },
        target: {
          schemaFamilies: ["pluto.portability.bundle"],
          schemaVersions: [0],
        },
        dependencies: [{ id: "portable-workflow:1", resolved: true }],
      },
      checksum: { algorithm: "sha256" as const, digest: "evidence-checksum" },
      redactionSummary: {
        schema: "pluto.portability.redaction-summary" as const,
        schemaVersion: 0 as const,
        redactedFields: ["runPrivateRef"],
        redactedRefKinds: ["runtime"],
        excludedContent: ["raw_runtime_transcripts"],
        summary: "Runtime-private material removed.",
      },
      evidence: {
        sealedEvidenceId: "sealed-evidence-1",
        citationRefs: [{ citationId: "citation-1", citationKind: "validation", locator: "artifact.md#summary", summary: "Validation evidence" }],
        validation: { outcome: "pass" as const, reason: null },
        readiness: { status: "ready" as const, blockedReasons: [], summary: "Ready for import." },
      },
    }],
  };
}

describe("portability sanitization", () => {
  it("accepts sanitized bundles that keep only manifest-driven portable data", () => {
    const bundle = makeMinimalSanitizedBundle();

    expect(validatePortableAssetBundleV0(bundle).ok).toBe(true);
    expect(() => assertPortableAssetBundleSafe(bundle)).not.toThrow();
    expect(JSON.stringify(bundle)).not.toContain(".pluto");
    expect(JSON.stringify(bundle)).not.toContain("workspaceId");
  });

  it("rejects tenant-private ids, runtime-private refs, raw provider data, credential values, and private storage paths", () => {
    const baseBundle = makeMinimalSanitizedBundle();
    const bundle = {
      ...baseBundle,
      workspaceId: "workspace-internal-1",
      assets: [{
        ...baseBundle.assets[0],
        runtimeTranscript: "raw transcript text",
        providerStdout: "provider debug output",
        credentialValue: "secret-value",
        privateStoragePath: "/workspace/repo/.pluto/runs/run-1/artifact.md",
      }],
    };

    const result = validatePortableAssetBundleV0(bundle);

    expect(result.ok).toBe(false);
    expect(result.ok ? [] : result.errors).toContain("workspaceId must be excluded from portable bundles");
    expect(result.ok ? [] : result.errors).toContain("assets.0.runtimeTranscript must be excluded from portable bundles");
    expect(result.ok ? [] : result.errors).toContain("assets.0.providerStdout must be excluded from portable bundles");
    expect(result.ok ? [] : result.errors).toContain("assets.0.credentialValue must be excluded from portable bundles");
    expect(result.ok ? [] : result.errors).toContain("assets.0.privateStoragePath must be excluded from portable bundles");
    expect(() => assertPortableAssetBundleSafe(bundle)).toThrow(/workspaceId must be excluded/);
  });
});
