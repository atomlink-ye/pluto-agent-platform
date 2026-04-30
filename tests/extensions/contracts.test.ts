import { describe, expect, it } from "vitest";

import type {
  ExtensionInstallV0,
  ExtensionManifestV0,
  ExtensionPackageV0,
  MarketplaceListingV0,
  TrustReviewV0,
} from "@/extensions/contracts.js";

function makeManifest(): ExtensionManifestV0 {
  return {
    schemaVersion: 0,
    extensionId: "pluto.example.bundle",
    name: "Example Bundle",
    version: "0.1.0",
    description: "Governed extension bundle fixture.",
    publisher: {
      name: "Pluto Labs",
      url: "https://example.com/publisher",
    },
    homepage: "https://example.com/extensions/example-bundle",
    repository: "https://example.com/repo.git",
    license: "MIT",
    keywords: ["skills", "templates", "policies"],
    assets: [
      {
        assetId: "manifest",
        kind: "manifest",
        path: "extension/manifest.json",
        mediaType: "application/json",
        checksum: { algorithm: "sha256", value: "manifest-256" },
      },
      {
        assetId: "skill.audit",
        kind: "skill",
        path: "skills/audit/SKILL.md",
        mediaType: "text/markdown",
        checksum: { algorithm: "sha256", value: "skill-256" },
      },
      {
        assetId: "template.report",
        kind: "template",
        path: "templates/report.md",
        mediaType: "text/markdown",
        checksum: { algorithm: "sha256", value: "template-256" },
      },
      {
        assetId: "policy.safe-tools",
        kind: "policy",
        path: "policies/safe-tools.json",
        mediaType: "application/json",
        checksum: { algorithm: "sha256", value: "policy-256" },
      },
    ],
    extensionPoints: [
      {
        point: "assistant.skill",
        target: "skill.example.audit",
        scope: "runtime",
        description: "Registers the audit skill for activation in later lanes.",
      },
      {
        point: "assistant.template",
        target: "template.example.report",
        scope: "session",
        description: "Publishes the report template for workflow composition.",
      },
      {
        point: "assistant.policy",
        target: "policy.example.safe-tools",
        scope: "policy",
        description: "Constrains risky actions during extension execution.",
      },
    ],
    compatibility: {
      pluto: { min: "0.1.0-alpha.0", max: "0.2.0" },
      paseo: { min: "0.10.0", max: null },
      opencode: { min: "0.3.0", max: null },
    },
    capabilities: [
      {
        name: "workspace.read",
        level: "read",
        reason: "Read repository state before running the audit flow.",
      },
      {
        name: "workspace.write",
        level: "write",
        reason: "Write generated reports into the workspace.",
      },
      {
        name: "runtime.exec",
        level: "exec",
        reason: "Run bounded commands during the audit flow.",
      },
    ],
    secretNames: [
      {
        name: "OPENAI_API_KEY",
        required: true,
        reason: "Used by the audit skill when invoking a configured model endpoint.",
      },
    ],
    toolSurfaces: [
      {
        tool: "read",
        access: "read",
        reason: "Reads workspace files needed by the skill and template.",
      },
      {
        tool: "write",
        access: "write",
        reason: "Writes generated reports into the workspace.",
      },
      {
        tool: "bash",
        access: "exec",
        reason: "Runs bounded commands during the audit workflow.",
      },
    ],
    sensitivityClaims: [
      {
        domain: "workspace.contents",
        level: "moderate",
        reason: "The extension reads repository files and may surface findings in reports.",
      },
    ],
    outboundWriteClaims: [
      {
        target: "workspace://reports",
        access: "create",
        reason: "Creates a report artifact for later review.",
      },
    ],
    postureConstraints: [
      {
        name: "network.access",
        mode: "forbid",
        value: "direct-external-egress",
        reason: "Keep the fixture aligned with offline-first R2 expectations.",
      },
      {
        name: "human.review",
        mode: "require",
        value: "trust-review-before-install",
        reason: "Requires explicit review before activation in later lanes.",
      },
    ],
    contributions: {
      skills: [
        {
          kind: "skill",
          id: "skill.example.audit",
          name: "Audit Skill",
          version: "0.1.0",
          description: "Runs a bounded audit flow.",
          entrypoint: "skills/audit/SKILL.md",
          assetRef: "skill.audit",
          extensionPoints: ["assistant.skill"],
          toolSurface: ["read", "bash"],
          capabilityNames: ["workspace.read", "runtime.exec"],
          secretNames: [],
        },
      ],
      templates: [
        {
          kind: "template",
          id: "template.example.report",
          name: "Report Template",
          version: "0.1.0",
          description: "Scaffolds a markdown report.",
          entrypoint: "templates/report.md",
          assetRef: "template.report",
          extensionPoints: ["assistant.template"],
          language: "markdown",
          inputSchema: {
            type: "object",
            required: ["title"],
            properties: {
              title: { type: "string" },
            },
          },
          outputSchema: {
            type: "string",
          },
        },
      ],
      policies: [
        {
          kind: "policy",
          id: "policy.example.safe-tools",
          name: "Safe Tools Policy",
          version: "0.1.0",
          description: "Constrains risky tool usage.",
          entrypoint: "policies/safe-tools.json",
          assetRef: "policy.safe-tools",
          extensionPoints: ["assistant.policy"],
          appliesTo: ["skill.example.audit", "template.example.report"],
          ruleIds: ["no-force-push", "no-secrets"],
        },
      ],
    },
    lifecycle: {
      status: "active",
      channel: "stable",
      createdAt: "2026-04-30T00:00:00.000Z",
      updatedAt: "2026-04-30T00:00:01.000Z",
      publishedAt: "2026-04-30T00:00:02.000Z",
    },
  };
}

describe("extension contracts", () => {
  it("supports a JSON-serializable package fixture with identity, source, checksum, assets, and lifecycle metadata", () => {
    const extensionPackage: ExtensionPackageV0 = {
      schemaVersion: 0,
      packageId: "pkg.example.bundle-0.1.0",
      extensionId: "pluto.example.bundle",
      version: "0.1.0",
      source: {
        kind: "url",
        location: "https://example.com/downloads/pluto.example.bundle-0.1.0.tgz",
        digest: { algorithm: "sha256", value: "archive-256" },
      },
      checksum: { algorithm: "sha256", value: "archive-256" },
      assetRefs: ["manifest", "skill.audit", "template.report", "policy.safe-tools"],
      manifest: makeManifest(),
      lifecycle: {
        status: "active",
        channel: "stable",
        createdAt: "2026-04-30T00:00:00.000Z",
        updatedAt: "2026-04-30T00:00:01.000Z",
        publishedAt: "2026-04-30T00:00:02.000Z",
      },
      signature: {
        schemaVersion: 0,
        status: "verified",
        signatureAlgorithm: "ed25519",
        digest: {
          algorithm: "sha256",
          value: "archive-256",
        },
        signer: {
          id: "publisher:pluto-labs",
          displayName: "Pluto Labs",
        },
        provenance: {
          source: "publisher",
          origin: "https://example.com/downloads/pluto.example.bundle-0.1.0.tgz",
          verifiedAt: "2026-04-30T00:00:03.000Z",
          transparencyLogUrl: "https://example.com/log/entry/1",
        },
        recordedAt: "2026-04-30T00:00:03.000Z",
      },
    };

    expect(JSON.parse(JSON.stringify(extensionPackage))).toEqual(extensionPackage);
    expect(extensionPackage.assetRefs).toContain("policy.safe-tools");
    expect(extensionPackage.manifest.assets[0]?.kind).toBe("manifest");
    expect(extensionPackage.manifest.contributions.skills[0]?.kind).toBe("skill");
    expect(extensionPackage.manifest.contributions.templates[0]?.kind).toBe("template");
    expect(extensionPackage.manifest.contributions.policies[0]?.kind).toBe("policy");
  });

  it("records install and trust review state with provenance, lifecycle, and posture metadata only", () => {
    const trustReview: TrustReviewV0 = {
      schemaVersion: 0,
      reviewId: "review-1",
      extensionId: "pluto.example.bundle",
      version: "0.1.0",
      packageId: "pkg.example.bundle-0.1.0",
      verdict: "approved",
      privilegedCapabilities: ["runtime.exec"],
      reviewer: {
        id: "operator:security",
        displayName: "Security Reviewer",
      },
      reason: "Capabilities and secrets align with the declared package scope.",
      reviewedAt: "2026-04-30T00:00:04.000Z",
      provenance: {
        source: "marketplace",
        location: "listing.example.bundle",
        digest: { algorithm: "sha256", value: "archive-256" },
      },
      lifecycle: {
        status: "active",
        publishedAt: "2026-04-30T00:00:02.000Z",
        deprecatedAt: null,
        revokedAt: null,
      },
      evidence: {
        signatureStatus: "verified",
        capabilityNames: ["workspace.read", "workspace.write", "runtime.exec"],
        toolNames: ["read", "write", "bash"],
        secretNames: ["OPENAI_API_KEY"],
        postureConstraintNames: ["network.access", "human.review"],
        outboundTargets: ["workspace://reports"],
      },
    };

    const install: ExtensionInstallV0 = {
      schemaVersion: 0,
      installId: "install-1",
      extensionId: "pluto.example.bundle",
      version: "0.1.0",
      status: "installed",
      requestedAt: "2026-04-30T00:00:04.500Z",
      installedAt: "2026-04-30T00:00:05.000Z",
      installedPath: ".pluto/extensions/pluto.example.bundle",
      requestedBy: "operator:local",
      source: {
        kind: "marketplace",
        location: "listing.example.bundle",
        marketplaceListingId: "listing.example.bundle",
      },
      packageId: "pkg.example.bundle-0.1.0",
      checksum: { algorithm: "sha256", value: "archive-256" },
      manifest: makeManifest(),
      lifecycle: {
        status: "active",
        channel: "stable",
        createdAt: "2026-04-30T00:00:00.000Z",
        updatedAt: "2026-04-30T00:00:01.000Z",
        publishedAt: "2026-04-30T00:00:02.000Z",
      },
      signature: {
        schemaVersion: 0,
        status: "verified",
        signatureAlgorithm: "ed25519",
        digest: {
          algorithm: "sha256",
          value: "archive-256",
        },
        signer: {
          id: "publisher:pluto-labs",
          displayName: "Pluto Labs",
        },
        provenance: {
          source: "marketplace",
          origin: "listing.example.bundle",
          verifiedAt: "2026-04-30T00:00:03.000Z",
        },
        recordedAt: "2026-04-30T00:00:03.000Z",
      },
      trustReview,
    };

    expect(install.trustReview?.verdict).toBe("approved");
    expect(install.manifest.secretNames[0]?.name).toBe("OPENAI_API_KEY");
    expect(install.manifest.postureConstraints[0]?.name).toBe("network.access");
    expect(install.signature.provenance.source).toBe("marketplace");
  });

  it("keeps marketplace listing metadata-only while preserving lifecycle, trust, provenance, and compatibility ranges", () => {
    const listing: MarketplaceListingV0 = {
      schemaVersion: 0,
      listingId: "listing.example.bundle",
      extensionId: "pluto.example.bundle",
      packageId: "pkg.example.bundle-0.1.0",
      name: "Example Bundle",
      summary: "A governed bundle of skill, template, and policy declarations.",
      publisherName: "Pluto Labs",
      latestVersion: "0.1.0",
      latestManifestVersion: "0.1.0",
      categories: ["governance", "workflow"],
      keywords: ["skill", "template", "policy"],
      source: {
        kind: "marketplace",
        location: "listing.example.bundle",
        marketplaceListingId: "listing.example.bundle",
      },
      compatibility: {
        pluto: { min: "0.1.0-alpha.0", max: "0.2.0" },
      },
      assetRefs: ["manifest", "skill.audit", "template.report", "policy.safe-tools"],
      lifecycle: {
        status: "active",
        channel: "stable",
        createdAt: "2026-04-30T00:00:00.000Z",
        updatedAt: "2026-04-30T00:00:01.000Z",
        publishedAt: "2026-04-30T00:00:02.000Z",
      },
      provenance: {
        publishedBy: "operator:marketplace",
        publishedAt: "2026-04-30T00:00:02.500Z",
        sourceDigest: { algorithm: "sha256", value: "archive-256" },
      },
      trust: {
        signatureStatus: "verified",
        reviewVerdict: "approved",
        reviewedAt: "2026-04-30T00:00:04.000Z",
      },
    };

    expect(Object.keys(listing)).not.toContain("installCount");
    expect(listing.trust.reviewVerdict).toBe("approved");
    expect(listing.provenance.sourceDigest.algorithm).toBe("sha256");
  });
});
