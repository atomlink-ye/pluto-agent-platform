import { describe, expect, it } from "vitest";

import { sealPortableBundleV0 } from "@/portability/seal.js";
import type { PortableAssetBundleV0 } from "@/contracts/portability.js";

function makeBundle(): PortableAssetBundleV0 {
  return {
    schema: "pluto.portability.bundle",
    schemaVersion: 0,
    bundleId: "bundle-r6",
    manifest: {
      schema: "pluto.portability.manifest",
      schemaVersion: 0,
      bundleId: "bundle-r6",
      bundleVersion: "0.1.0",
      exportedAt: "2026-04-30T00:01:00.000Z",
      assetKinds: ["template", "document"],
      logicalRefs: [
        { kind: "template", logicalId: "template.offer-letter", sourceTemplateId: "template-1" },
        { kind: "document", logicalId: "doc.handbook", sourceDocumentId: "document-1", sourceVersionId: "version-7" },
      ],
      workflowRefs: [
        { kind: "portable_workflow_bundle", workflowId: "workflow-z", bundleRef: "portable-workflow://bundle/z" },
        { kind: "portable_workflow_bundle", workflowId: "workflow-a", bundleRef: "portable-workflow://bundle/a" },
      ],
      compatibility: {
        schemaVersion: 0,
        bundle: { family: "pluto.portability.bundle", version: 0, writtenAt: "2026-04-30T00:00:00.000Z" },
        target: { schemaFamilies: ["pluto.portability.bundle"], schemaVersions: [0] },
        dependencies: [{ id: "portable-workflow:workflow-a", resolved: true }],
      },
      checksums: [
        { algorithm: "sha256", digest: "z-checksum" },
        { algorithm: "sha256", digest: "a-checksum" },
      ],
      importRequirements: [
        {
          schema: "pluto.portability.import-requirement",
          schemaVersion: 0,
          code: "capability-ref",
          required: true,
          description: "Importer must support markdown rendering.",
          capabilityRefs: ["capability:markdown-render"],
        },
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
        redactedFields: ["workspaceId", "actorId"],
        redactedRefKinds: ["principal", "runtime"],
        excludedContent: ["tenant_private_state", "provider_payloads"],
        summary: "Private runtime and tenant state were excluded.",
      },
    },
    assets: [
      {
        schema: "pluto.portability.template-export",
        schemaVersion: 0,
        kind: "template",
        id: "template-export-1",
        logicalRef: { kind: "template", logicalId: "template.offer-letter", sourceTemplateId: "template-1" },
        title: "Offer Letter",
        createdAt: "2026-04-30T00:00:00.000Z",
        exportedAt: "2026-04-30T00:01:00.000Z",
        workflowRefs: [{ kind: "portable_workflow_bundle", workflowId: "workflow-z", bundleRef: "portable-workflow://bundle/z" }],
        compatibility: {
          schemaVersion: 0,
          bundle: { family: "pluto.portability.bundle", version: 0, writtenAt: "2026-04-30T00:00:00.000Z" },
          target: { schemaFamilies: ["pluto.portability.bundle"], schemaVersions: [0] },
          dependencies: [{ id: "portable-workflow:workflow-a", resolved: true }],
        },
        checksum: { algorithm: "sha256", digest: "template-checksum" },
        redactionSummary: {
          schema: "pluto.portability.redaction-summary",
          schemaVersion: 0,
          redactedFields: ["workspaceId"],
          redactedRefKinds: ["principal"],
          excludedContent: ["provider_payloads"],
          summary: "Private fields removed.",
        },
        template: {
          body: "Hello {{candidate_name}}",
          variables: ["candidate_name"],
          outputFormat: "markdown",
        },
        metadata: {
          category: "hr",
          lineageRefs: ["document-1"],
        },
      },
      {
        schema: "pluto.portability.document-export",
        schemaVersion: 0,
        kind: "document",
        id: "document-export-1",
        logicalRef: { kind: "document", logicalId: "doc.handbook", sourceDocumentId: "document-1", sourceVersionId: "version-7" },
        title: "Employee Handbook",
        createdAt: "2026-04-30T00:00:00.000Z",
        exportedAt: "2026-04-30T00:01:00.000Z",
        workflowRefs: [{ kind: "portable_workflow_bundle", workflowId: "workflow-a", bundleRef: "portable-workflow://bundle/a" }],
        compatibility: {
          schemaVersion: 0,
          bundle: { family: "pluto.portability.bundle", version: 0, writtenAt: "2026-04-30T00:00:00.000Z" },
          target: { schemaFamilies: ["pluto.portability.bundle"], schemaVersions: [0] },
          dependencies: [{ id: "portable-workflow:workflow-a", resolved: true }],
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
        content: {
          format: "markdown",
          body: "# Handbook\nPortable content only.",
        },
        metadata: {
          tags: ["hr", "policy"],
          lineageRefs: ["publish-package-1"],
        },
      },
    ],
  };
}

function makeValidationInput() {
  return {
    authorization: { allowed: true },
    exportPolicy: { allowed: true },
    target: { schemaFamilies: ["pluto.portability.bundle"], schemaVersions: [0] },
    sensitivity: {
      allowedClasses: ["public", "internal"],
      assetClasses: [
        { assetLogicalId: "doc.handbook", sensitivityClass: "internal" },
        { assetLogicalId: "template.offer-letter", sensitivityClass: "public" },
      ],
    },
    retention: [
      { assetLogicalId: "doc.handbook", blockingReasons: [] },
      { assetLogicalId: "template.offer-letter", blockingReasons: [] },
    ],
    legalHoldActiveLogicalIds: [],
    prohibitedContentFindings: [],
  };
}

describe("portable bundle sealing", () => {
  it("produces deterministic manifest checksums and local v0 seal metadata", () => {
    const baseBundle = makeBundle();
    const reorderedBundle: PortableAssetBundleV0 = {
      ...baseBundle,
      manifest: {
        ...baseBundle.manifest,
        assetKinds: [...baseBundle.manifest.assetKinds].reverse(),
        logicalRefs: [...baseBundle.manifest.logicalRefs].reverse(),
        workflowRefs: [...baseBundle.manifest.workflowRefs].reverse(),
        checksums: [...baseBundle.manifest.checksums].reverse(),
        importRequirements: [...baseBundle.manifest.importRequirements].reverse(),
      },
      assets: [...baseBundle.assets].reverse(),
    };

    const first = sealPortableBundleV0(baseBundle, makeValidationInput(), { sealedAt: "2026-04-30T00:02:00.000Z" });
    const second = sealPortableBundleV0(reorderedBundle, makeValidationInput(), { sealedAt: "2026-04-30T00:02:00.000Z" });

    expect(first.ok).toBe(true);
    expect(second.ok).toBe(true);

    if (!first.ok || !second.ok) {
      throw new Error("expected portable bundle seals");
    }

    expect(first.value.seal.schema).toBe("pluto.portability.bundle-seal");
    expect(first.value.seal.schemaVersion).toBe(0);
    expect(first.value.seal.sealVersion).toBe("local-v0");
    expect(first.value.seal.manifestChecksum.algorithm).toBe("sha256");
    expect(first.value.seal.manifestChecksum.digest).toBe(second.value.seal.manifestChecksum.digest);
    expect(first.value.seal.payloadChecksum.digest).toBe(second.value.seal.payloadChecksum.digest);
  });
});
