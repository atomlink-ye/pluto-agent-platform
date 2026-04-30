import { describe, expect, it } from "vitest";

import { sealPortableBundleV0, validatePortableBundleExportV0 } from "@/portability/seal.js";
import type { PortableAssetBundleV0 } from "@/contracts/portability.js";

function makeBundle(): PortableAssetBundleV0 {
  return {
    schema: "pluto.portability.bundle",
    schemaVersion: 0,
    bundleId: "bundle-export-validation",
    manifest: {
      schema: "pluto.portability.manifest",
      schemaVersion: 0,
      bundleId: "bundle-export-validation",
      bundleVersion: "0.1.0",
      exportedAt: "2026-04-30T00:01:00.000Z",
      assetKinds: ["document"],
      logicalRefs: [{ kind: "document", logicalId: "doc.policy", sourceDocumentId: "document-1", sourceVersionId: "version-1" }],
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
        logicalRef: { kind: "document", logicalId: "doc.policy", sourceDocumentId: "document-1", sourceVersionId: "version-1" },
        title: "Policy",
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
        content: { format: "markdown", body: "# Policy" },
        metadata: { tags: ["governance"], lineageRefs: ["publish-package-1"] },
      },
    ],
  };
}

describe("portable export validation", () => {
  it("fails closed before sealing when authorization, policy, retention, legal hold, compatibility, dependency, sensitivity, or content checks are missing or blocked", () => {
    const bundle = makeBundle();
    const result = validatePortableBundleExportV0(bundle, {
      authorization: { allowed: false, reason: "actor lacks export grant" },
      exportPolicy: { allowed: false, reason: "restricted records cannot be exported" },
      target: { schemaFamilies: ["pluto.portability.bundle"], schemaVersions: [1] },
      sensitivity: {
        allowedClasses: ["public"],
        assetClasses: [{ assetLogicalId: "doc.policy", sensitivityClass: "restricted" }],
      },
      retention: [{ assetLogicalId: "doc.policy", blockingReasons: ["retain_until_active"] }],
      legalHoldActiveLogicalIds: ["doc.policy"],
      dependencies: [{ id: "portable-workflow:missing", resolved: false }],
      prohibitedContentFindings: ["embedded provider response transcript"],
    });

    expect(result.ok).toBe(false);
    if (result.ok) {
      throw new Error("expected export validation failure");
    }

    expect(result.errors).toContain("authorization_blocked: actor lacks export grant");
    expect(result.errors).toContain("export_policy_blocked: restricted records cannot be exported");
    expect(result.errors).toContain("compatibility_gap: target does not support pluto.portability.bundle v0");
    expect(result.errors).toContain("dependency_gap: portable-workflow:missing");
    expect(result.errors).toContain("sensitivity_blocked: 'doc.policy' has prohibited sensitivity 'restricted'");
    expect(result.errors).toContain("retention_blocked: 'doc.policy' is blocked by retain_until_active");
    expect(result.errors).toContain("legal_hold_blocked: 'doc.policy' is under legal hold");
    expect(result.errors).toContain("prohibited_content: embedded provider response transcript");
  });

  it("refuses to seal when validation fails and seals once every blocker is cleared", () => {
    const bundle = makeBundle();
    const blocked = sealPortableBundleV0(bundle, {
      authorization: { allowed: true },
      exportPolicy: { allowed: true },
      target: { schemaFamilies: ["pluto.portability.bundle"], schemaVersions: [0] },
      sensitivity: {
        allowedClasses: ["public", "internal"],
        assetClasses: [{ assetLogicalId: "doc.policy", sensitivityClass: "internal" }],
      },
      retention: [{ assetLogicalId: "doc.policy", blockingReasons: ["retain_until_active"] }],
      legalHoldActiveLogicalIds: [],
      prohibitedContentFindings: [],
    });

    expect(blocked.ok).toBe(false);

    const sealed = sealPortableBundleV0(bundle, {
      authorization: { allowed: true },
      exportPolicy: { allowed: true },
      target: { schemaFamilies: ["pluto.portability.bundle"], schemaVersions: [0] },
      sensitivity: {
        allowedClasses: ["public", "internal"],
        assetClasses: [{ assetLogicalId: "doc.policy", sensitivityClass: "internal" }],
      },
      retention: [{ assetLogicalId: "doc.policy", blockingReasons: [] }],
      legalHoldActiveLogicalIds: [],
      prohibitedContentFindings: [],
    }, { sealedAt: "2026-04-30T00:02:00.000Z" });

    expect(sealed.ok).toBe(true);
  });
});
