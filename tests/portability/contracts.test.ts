import { describe, expect, it } from "vitest";

import {
  toEvidenceSummaryExportV0,
  validateDocumentExportV0,
  validateEvidenceSummaryExportV0,
  validatePortableAssetBundleV0,
  validatePortableAssetManifestV0,
  validatePublishPackageExportV0,
  validateTemplateExportV0,
} from "@/contracts/portability.js";

function makeCompatibility() {
  return {
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
    dependencies: [{ id: "portable-workflow:team-docs", packageName: "@pluto/workflows", version: "0.1.0", resolved: true }],
  };
}

function makeRedactionSummary() {
  return {
    schema: "pluto.portability.redaction-summary" as const,
    schemaVersion: 0 as const,
    redactedFields: ["authorPrincipalRef", "sourceConnectorRef"],
    redactedRefKinds: ["principal", "connector"],
    excludedContent: ["tenant_private_state", "raw_runtime_transcripts"],
    summary: "Portable export strips tenant-private and runtime-private fields.",
  };
}

function makeImportRequirement() {
  return {
    schema: "pluto.portability.import-requirement" as const,
    schemaVersion: 0 as const,
    code: "secret-name",
    required: true,
    description: "Importer must provide the same secret name mapping.",
    secretNames: ["DOCS_TARGET_TOKEN"],
  };
}

function makeWorkflowRef() {
  return {
    kind: "portable_workflow_bundle" as const,
    workflowId: "team-docs",
    bundleRef: "portable-workflow://bundle/team-docs-v1",
  };
}

describe("portability contracts", () => {
  it("requires schema markers, logical refs, compatibility metadata, checksums, import requirements, and redaction summaries", () => {
    const compatibility = makeCompatibility();
    const redactionSummary = makeRedactionSummary();
    const workflowRef = makeWorkflowRef();

    const documentExport = {
      schema: "pluto.portability.document-export" as const,
      schemaVersion: 0 as const,
      kind: "document" as const,
      id: "document-export-1",
      logicalRef: {
        kind: "document" as const,
        logicalId: "doc.handbook",
        sourceDocumentId: "document-1",
        sourceVersionId: "version-7",
      },
      title: "Employee Handbook",
      createdAt: "2026-04-30T00:00:00.000Z",
      exportedAt: "2026-04-30T00:01:00.000Z",
      workflowRefs: [workflowRef],
      compatibility,
      checksum: { algorithm: "sha256" as const, digest: "doc-checksum" },
      redactionSummary,
      content: {
        format: "markdown" as const,
        body: "# Employee Handbook\nPortable content only.",
      },
      metadata: {
        label: "v7",
        tags: ["hr", "policy"],
        lineageRefs: ["publish-package-4"],
      },
    };

    const templateExport = {
      schema: "pluto.portability.template-export" as const,
      schemaVersion: 0 as const,
      kind: "template" as const,
      id: "template-export-1",
      logicalRef: {
        kind: "template" as const,
        logicalId: "template.offer-letter",
        sourceTemplateId: "template-1",
      },
      title: "Offer Letter",
      createdAt: "2026-04-30T00:00:00.000Z",
      exportedAt: "2026-04-30T00:01:00.000Z",
      workflowRefs: [workflowRef],
      compatibility,
      checksum: { algorithm: "sha256" as const, digest: "template-checksum" },
      redactionSummary,
      template: {
        body: "Hello {{candidate_name}}",
        variables: ["candidate_name"],
        outputFormat: "markdown",
      },
      metadata: {
        category: "hr",
        lineageRefs: ["document-1"],
      },
    };

    const publishPackageExport = {
      schema: "pluto.portability.publish-package-export" as const,
      schemaVersion: 0 as const,
      kind: "publish_package" as const,
      id: "publish-package-export-1",
      logicalRef: {
        kind: "publish_package" as const,
        logicalId: "package.employee-handbook",
        sourceDocumentId: "document-1",
        sourceVersionId: "version-7",
        sourcePublishPackageId: "package-1",
      },
      title: "Employee Handbook Publish Package",
      createdAt: "2026-04-30T00:00:00.000Z",
      exportedAt: "2026-04-30T00:01:00.000Z",
      workflowRefs: [workflowRef],
      compatibility,
      checksum: { algorithm: "sha256" as const, digest: "package-checksum" },
      redactionSummary,
      publishPackage: {
        channelTargets: [
          {
            channelId: "docs",
            targetId: "public-site",
            status: "ready",
            destinationSummary: "Public docs site",
          },
        ],
        sourceVersionRefs: ["version-7"],
        sealedEvidenceRefs: ["sealed-evidence-1"],
      },
    };

    const evidenceSummaryExport = toEvidenceSummaryExportV0({
      id: "evidence-summary-export-1",
      logicalRef: {
        kind: "evidence_summary",
        logicalId: "evidence.employee-handbook.release",
        sourceDocumentId: "document-1",
        sourceVersionId: "version-7",
      },
      title: "Release Evidence Summary",
      createdAt: "2026-04-30T00:00:00.000Z",
      exportedAt: "2026-04-30T00:01:00.000Z",
      workflowRefs: [workflowRef],
      compatibility,
      checksum: { algorithm: "sha256", digest: "evidence-summary-checksum" },
      redactionSummary,
      evidence: {
        sealedEvidenceId: "sealed-evidence-1",
        citationRefs: [
          {
            citationId: "citation-1",
            citationKind: "validation",
            locator: "artifact.md#summary",
            summary: "Validation summary citation",
          },
        ],
        validation: {
          outcome: "pass",
          reason: null,
        },
        readiness: {
          status: "ready",
          blockedReasons: [],
          summary: "Evidence is sealed and publish-ready.",
        },
      },
    });

    const manifest = {
      schema: "pluto.portability.manifest" as const,
      schemaVersion: 0 as const,
      bundleId: "bundle-1",
      bundleVersion: "0.1.0",
      exportedAt: "2026-04-30T00:01:00.000Z",
      assetKinds: ["document", "template", "publish_package", "evidence_summary"],
      logicalRefs: [
        documentExport.logicalRef,
        templateExport.logicalRef,
        publishPackageExport.logicalRef,
        evidenceSummaryExport.logicalRef,
      ],
      workflowRefs: [workflowRef],
      compatibility,
      checksums: [
        documentExport.checksum,
        templateExport.checksum,
        publishPackageExport.checksum,
        evidenceSummaryExport.checksum,
      ],
      importRequirements: [makeImportRequirement()],
      redactionSummary,
    };

    const bundle = {
      schema: "pluto.portability.bundle" as const,
      schemaVersion: 0 as const,
      bundleId: "bundle-1",
      manifest,
      assets: [documentExport, templateExport, publishPackageExport, evidenceSummaryExport],
    };

    expect(validateDocumentExportV0(documentExport).ok).toBe(true);
    expect(validateTemplateExportV0(templateExport).ok).toBe(true);
    expect(validatePublishPackageExportV0(publishPackageExport).ok).toBe(true);
    expect(validateEvidenceSummaryExportV0(evidenceSummaryExport).ok).toBe(true);
    expect(validatePortableAssetManifestV0(manifest).ok).toBe(true);
    expect(validatePortableAssetBundleV0(bundle).ok).toBe(true);
  });

  it("rejects missing contract markers that importers depend on", () => {
    const result = validatePortableAssetBundleV0({
      schema: "pluto.portability.bundle",
      schemaVersion: 0,
      bundleId: "bundle-1",
      manifest: {
        schema: "pluto.portability.manifest",
        schemaVersion: 0,
        bundleId: "bundle-1",
        bundleVersion: "0.1.0",
        exportedAt: "2026-04-30T00:01:00.000Z",
        assetKinds: ["document"],
        workflowRefs: [makeWorkflowRef()],
        compatibility: makeCompatibility(),
        checksums: [{ algorithm: "sha256", digest: "bundle-checksum" }],
        importRequirements: [makeImportRequirement()],
        redactionSummary: makeRedactionSummary(),
      },
      assets: [],
    });

    expect(result.ok).toBe(false);
    expect(result.ok ? [] : result.errors).toContain("manifest.logicalRefs must be a non-empty array");
    expect(result.ok ? [] : result.errors).toContain("assets must be a non-empty array");
  });

  it("tolerates additive future fields", () => {
    const result = validatePortableAssetManifestV0({
      schema: "pluto.portability.manifest",
      schemaVersion: 0,
      bundleId: "bundle-1",
      bundleVersion: "0.1.0",
      exportedAt: "2026-04-30T00:01:00.000Z",
      assetKinds: ["document"],
      logicalRefs: [{ kind: "document", logicalId: "doc.handbook" }],
      workflowRefs: [makeWorkflowRef()],
      compatibility: makeCompatibility(),
      checksums: [{ algorithm: "sha256", digest: "bundle-checksum" }],
      importRequirements: [makeImportRequirement()],
      redactionSummary: makeRedactionSummary(),
      futureField: { lane: "r5" },
    });

    expect(result.ok).toBe(true);
  });
});
