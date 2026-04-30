import { describe, expect, it } from "vitest";

import { validatePortableBundleImportV0 } from "@/portability/import-validator.js";
import type { PortableAssetBundleV0 } from "@/contracts/portability.js";

function makeBundle(): PortableAssetBundleV0 {
  return {
    schema: "pluto.portability.bundle",
    schemaVersion: 0,
    bundleId: "bundle-import-validation",
    manifest: {
      schema: "pluto.portability.manifest",
      schemaVersion: 0,
      bundleId: "bundle-import-validation",
      bundleVersion: "0.1.0",
      exportedAt: "2026-04-30T00:01:00.000Z",
      assetKinds: ["document"],
      logicalRefs: [{ kind: "document", logicalId: "doc.handbook", sourceDocumentId: "document-1", sourceVersionId: "version-7" }],
      workflowRefs: [{ kind: "portable_workflow_bundle", workflowId: "workflow-1", bundleRef: "portable-workflow://bundle/workflow-1" }],
      compatibility: {
        schemaVersion: 0,
        bundle: { family: "pluto.portability.bundle", version: 0, writtenAt: "2026-04-30T00:00:00.000Z" },
        target: { schemaFamilies: ["pluto.portability.bundle"], schemaVersions: [0] },
        dependencies: [{ id: "portable-workflow:workflow-1", resolved: true }],
      },
      checksums: [{ algorithm: "sha256", digest: "document-checksum" }],
      importRequirements: [
        {
          schema: "pluto.portability.import-requirement",
          schemaVersion: 0,
          code: "secret-name",
          required: true,
          description: "Importer must bind DOCS_TARGET_TOKEN.",
          secretNames: ["DOCS_TARGET_TOKEN"],
        },
        {
          schema: "pluto.portability.import-requirement",
          schemaVersion: 0,
          code: "capability-ref",
          required: true,
          description: "Importer must support markdown rendering.",
          capabilityRefs: ["capability:markdown-render"],
        },
      ],
      redactionSummary: {
        schema: "pluto.portability.redaction-summary",
        schemaVersion: 0,
        redactedFields: ["workspaceId"],
        redactedRefKinds: ["principal"],
        excludedContent: ["provider_payloads"],
        summary: "Private fields removed.",
      },
    },
    assets: [
      {
        schema: "pluto.portability.document-export",
        schemaVersion: 0,
        kind: "document",
        id: "document-export-1",
        logicalRef: { kind: "document", logicalId: "doc.handbook", sourceDocumentId: "document-1", sourceVersionId: "version-7" },
        title: "Employee Handbook",
        createdAt: "2026-04-30T00:00:00.000Z",
        exportedAt: "2026-04-30T00:01:00.000Z",
        workflowRefs: [{ kind: "portable_workflow_bundle", workflowId: "workflow-1", bundleRef: "portable-workflow://bundle/workflow-1" }],
        compatibility: {
          schemaVersion: 0,
          bundle: { family: "pluto.portability.bundle", version: 0, writtenAt: "2026-04-30T00:00:00.000Z" },
          target: { schemaFamilies: ["pluto.portability.bundle"], schemaVersions: [0] },
          dependencies: [{ id: "portable-workflow:workflow-1", resolved: true }],
        },
        checksum: { algorithm: "sha256", digest: "document-checksum" },
        redactionSummary: {
          schema: "pluto.portability.redaction-summary",
          schemaVersion: 0,
          redactedFields: ["workspaceId"],
          redactedRefKinds: ["principal"],
          excludedContent: ["provider_payloads"],
          summary: "Private fields removed.",
        },
        content: { format: "markdown", body: "# Handbook" },
        metadata: { tags: ["hr"], lineageRefs: ["publish-package-1"] },
      },
    ],
  };
}

describe("portable import validation", () => {
  it("blocks unsupported schema and capability, missing secret names, prohibited sensitivity, unresolved refs, and policy conflicts", () => {
    const bundle = makeBundle();
    const result = validatePortableBundleImportV0(bundle, {
      support: {
        schemaFamilies: ["pluto.portability.bundle"],
        schemaVersions: [1],
        capabilityRefs: [],
        secretNames: [],
        allowedSensitivityClasses: ["public"],
        resolvedRefs: [],
        policy: { allowed: false, reason: "imports are disabled for governed records" },
      },
      assetSensitivities: [{ assetLogicalId: "doc.handbook", sensitivityClass: "restricted" }],
    });

    expect(result.ok).toBe(false);
    if (result.ok) {
      throw new Error("expected import validation failure");
    }

    expect(result.errors).toContain("unsupported_schema: pluto.portability.bundle v0");
    expect(result.errors).toContain("capability_unavailable: capability:markdown-render");
    expect(result.errors).toContain("missing_secret_name: DOCS_TARGET_TOKEN");
    expect(result.errors).toContain("prohibited_sensitivity: 'doc.handbook' has prohibited sensitivity 'restricted'");
    expect(result.errors).toContain("unresolved_ref: portable-workflow://bundle/workflow-1");
    expect(result.errors).toContain("policy_conflict: imports are disabled for governed records");
  });

  it("accepts bundles only when all import requirements are supported", () => {
    const bundle = makeBundle();
    const result = validatePortableBundleImportV0(bundle, {
      support: {
        schemaFamilies: ["pluto.portability.bundle"],
        schemaVersions: [0],
        capabilityRefs: ["capability:markdown-render"],
        secretNames: ["DOCS_TARGET_TOKEN"],
        allowedSensitivityClasses: ["public", "internal"],
        resolvedRefs: [
          "portable-workflow://bundle/workflow-1",
          "document:document-1",
          "version:version-7",
        ],
        policy: { allowed: true },
      },
      assetSensitivities: [{ assetLogicalId: "doc.handbook", sensitivityClass: "internal" }],
    });

    expect(result.ok).toBe(true);
  });
});
