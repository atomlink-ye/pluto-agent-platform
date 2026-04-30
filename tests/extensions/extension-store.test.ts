import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type {
  ExtensionInstallV0,
  ExtensionManifestV0,
  ExtensionPackageV0,
  ExtensionSignatureV0,
  MarketplaceListingV0,
  TrustReviewV0,
} from "@/extensions/contracts.js";
import { ExtensionStore } from "@/extensions/extension-store.js";

let workDir: string;

beforeEach(async () => {
  workDir = await mkdtemp(join(tmpdir(), "pluto-extension-store-test-"));
});

afterEach(async () => {
  await rm(workDir, { recursive: true, force: true });
});

function makeManifest(): ExtensionManifestV0 {
  return {
    schemaVersion: 0,
    extensionId: "pluto.example.bundle",
    name: "Example Bundle",
    version: "0.1.0",
    description: "A governed bundle of skill, template, and policy declarations.",
    publisher: {
      name: "Pluto Labs",
      url: "https://example.com/publisher/pluto-labs",
    },
    homepage: "https://example.com/extensions/pluto.example.bundle",
    repository: "https://example.com/git/pluto.example.bundle",
    license: "MIT",
    keywords: ["skill", "template", "policy"],
    assets: [
      {
        assetId: "manifest",
        kind: "manifest",
        path: "manifest.json",
        mediaType: "application/json",
        checksum: { algorithm: "sha256", value: "manifest-256" },
      },
      {
        assetId: "skill.audit",
        kind: "skill",
        path: "skills/audit.md",
        mediaType: "text/markdown",
        checksum: { algorithm: "sha256", value: "skill-256" },
        role: "skill-definition",
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
        point: "catalog.skills",
        target: "pluto.catalog.skills",
        scope: "workspace",
        description: "Adds audited skill declarations to the local catalog.",
      },
    ],
    compatibility: {
      pluto: { min: "0.1.0-alpha.0", max: "0.2.0" },
      opencode: { min: "0.1.0", max: "0.2.0" },
    },
    capabilities: [
      { name: "workspace.read", level: "read", reason: "Inspect repository inputs." },
      { name: "workspace.write", level: "write", reason: "Write generated artifacts." },
      { name: "runtime.exec", level: "exec", reason: "Run verification commands." },
    ],
    secretNames: [{ name: "OPENAI_API_KEY", required: true, reason: "Authorize runtime requests." }],
    toolSurfaces: [
      { tool: "read", access: "read", reason: "Load local files." },
      { tool: "write", access: "write", reason: "Persist generated artifacts." },
      { tool: "bash", access: "exec", reason: "Execute validation commands." },
    ],
    sensitivityClaims: [{ domain: "workspace", level: "moderate", reason: "Reads local repository code." }],
    outboundWriteClaims: [{ target: "workspace://reports", access: "create", reason: "Create evaluation artifacts." }],
    postureConstraints: [
      { name: "network.access", mode: "require", value: "restricted", reason: "Only declared endpoints allowed." },
      { name: "human.review", mode: "prefer", value: "required-before-publish", reason: "Operator approves publication." },
    ],
    contributions: {
      skills: [
        {
          kind: "skill",
          id: "audit-skill",
          name: "Audit Skill",
          version: "0.1.0",
          description: "Reviews repository changes before release.",
          entrypoint: "skills/audit.md",
          assetRef: "skill.audit",
          extensionPoints: ["catalog.skills"],
          toolSurface: ["read", "bash"],
          capabilityNames: ["workspace.read", "runtime.exec"],
          secretNames: ["OPENAI_API_KEY"],
        },
      ],
      templates: [
        {
          kind: "template",
          id: "report-template",
          name: "Report Template",
          version: "0.1.0",
          description: "Formats audit output as markdown.",
          entrypoint: "templates/report.md",
          assetRef: "template.report",
          extensionPoints: ["catalog.templates"],
          language: "markdown",
          inputSchema: { type: "object", required: ["summary"] },
          outputSchema: { type: "string" },
        },
      ],
      policies: [
        {
          kind: "policy",
          id: "safe-tools",
          name: "Safe Tools",
          version: "0.1.0",
          description: "Constrains runtime tool usage.",
          entrypoint: "policies/safe-tools.json",
          assetRef: "policy.safe-tools",
          extensionPoints: ["catalog.policies"],
          appliesTo: ["generator", "evaluator"],
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

function makeSignature(source: "publisher" | "marketplace"): ExtensionSignatureV0 {
  return {
    schemaVersion: 0,
    status: "verified",
    signatureAlgorithm: "ed25519",
    digest: { algorithm: "sha256", value: "archive-256" },
    signer: {
      id: "publisher:pluto-labs",
      displayName: "Pluto Labs",
    },
    provenance: {
      source,
      origin: source === "publisher" ? "https://example.com/downloads/pluto.example.bundle-0.1.0.tgz" : "listing.example.bundle",
      verifiedAt: "2026-04-30T00:00:03.000Z",
      transparencyLogUrl: "https://example.com/log/entry/1",
    },
    recordedAt: "2026-04-30T00:00:03.000Z",
  };
}

function makePackage(manifest: ExtensionManifestV0, signature: ExtensionSignatureV0): ExtensionPackageV0 {
  return {
    schemaVersion: 0,
    packageId: "pkg.example.bundle-0.1.0",
    extensionId: manifest.extensionId,
    version: manifest.version,
    source: {
      kind: "url",
      location: "https://example.com/downloads/pluto.example.bundle-0.1.0.tgz",
      digest: { algorithm: "sha256", value: "archive-256" },
    },
    checksum: { algorithm: "sha256", value: "archive-256" },
    assetRefs: ["manifest", "skill.audit", "template.report", "policy.safe-tools"],
    manifest,
    lifecycle: {
      status: "active",
      channel: "stable",
      createdAt: "2026-04-30T00:00:00.000Z",
      updatedAt: "2026-04-30T00:00:01.000Z",
      publishedAt: "2026-04-30T00:00:02.000Z",
    },
    signature,
  };
}

function makeTrustReview(pkg: ExtensionPackageV0): TrustReviewV0 {
  return {
    schemaVersion: 0,
    reviewId: "review-1",
    extensionId: pkg.extensionId,
    version: pkg.version,
    packageId: pkg.packageId,
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
}

function makeInstall(pkg: ExtensionPackageV0, signature: ExtensionSignatureV0, trustReview: TrustReviewV0): ExtensionInstallV0 {
  return {
    schemaVersion: 0,
    installId: "install-1",
    extensionId: pkg.extensionId,
    version: pkg.version,
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
    packageId: pkg.packageId,
    checksum: { algorithm: "sha256", value: "archive-256" },
    manifest: pkg.manifest,
    lifecycle: pkg.lifecycle,
    signature,
    trustReview,
  };
}

function makeListing(pkg: ExtensionPackageV0): MarketplaceListingV0 {
  return {
    schemaVersion: 0,
    listingId: "listing.example.bundle",
    extensionId: pkg.extensionId,
    packageId: pkg.packageId,
    name: "Example Bundle",
    summary: "A governed bundle of skill, template, and policy declarations.",
    publisherName: "Pluto Labs",
    latestVersion: pkg.version,
    latestManifestVersion: pkg.manifest.version,
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
    assetRefs: pkg.assetRefs,
    lifecycle: pkg.lifecycle,
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
}

describe("ExtensionStore", () => {
  it("round-trips extension contract objects across supported kinds", async () => {
    const store = new ExtensionStore({ dataDir: join(workDir, ".pluto") });
    const manifest = makeManifest();
    const packageSignature = makeSignature("publisher");
    const extensionPackage = makePackage(manifest, packageSignature);
    const trustReview = makeTrustReview(extensionPackage);
    const installSignature = makeSignature("marketplace");
    const install = makeInstall(extensionPackage, installSignature, trustReview);
    const listing = makeListing(extensionPackage);

    await store.upsert("packages", extensionPackage.packageId, extensionPackage);
    await store.upsert("installs", install.installId, install);
    await store.upsert("trust-reviews", trustReview.reviewId, trustReview);
    await store.upsert("signatures", packageSignature.digest.value, packageSignature);
    await store.upsert("marketplace-listings", listing.listingId, listing);

    expect(await store.read("packages", extensionPackage.packageId)).toEqual(extensionPackage);
    expect(await store.read("installs", install.installId)).toEqual(install);
    expect(await store.read("trust-reviews", trustReview.reviewId)).toEqual(trustReview);

    expect(await store.list("signatures")).toEqual([packageSignature]);
    expect(await store.list("marketplace-listings")).toEqual([listing]);

    const persisted = await readFile(
      join(workDir, ".pluto", "extensions", "signatures", `${packageSignature.digest.value}.json`),
      "utf8",
    );
    expect(JSON.parse(persisted)).toEqual(packageSignature);
  });

  it("tolerates missing files and directories", async () => {
    const store = new ExtensionStore({ dataDir: join(workDir, ".pluto") });

    await expect(store.read("packages", "missing-package")).resolves.toBeNull();
    await expect(store.list("packages")).resolves.toEqual([]);
  });
});
