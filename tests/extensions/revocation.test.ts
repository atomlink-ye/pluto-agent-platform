import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { ExtensionAuditLog } from "@/extensions/audit.js";
import type { ExtensionManifestV0, ExtensionPackageV0, ExtensionSignatureV0 } from "@/extensions/contracts.js";
import { ExtensionStore } from "@/extensions/extension-store.js";
import {
  activateExtension,
  installExtension,
  recordTrustReview,
  revokeExtension,
} from "@/extensions/lifecycle.js";
import { validateExtensionManifest } from "@/extensions/manifest.js";

let workDir: string;

beforeEach(async () => {
  workDir = await mkdtemp(join(tmpdir(), "pluto-extension-revocation-test-"));
});

afterEach(async () => {
  await rm(workDir, { recursive: true, force: true });
});

function makeManifest(): ExtensionManifestV0 {
  return {
    schemaVersion: 0,
    extensionId: "pluto.example.revocable",
    name: "Revocable Bundle",
    version: "2.0.0",
    description: "Revocation test fixture.",
    publisher: { name: "Pluto Labs" },
    license: "MIT",
    keywords: ["revocation"],
    assets: [
      {
        assetId: "manifest",
        kind: "manifest",
        path: "manifest.json",
        mediaType: "application/json",
        checksum: { algorithm: "sha256", value: "manifest-256" },
      },
    ],
    extensionPoints: [],
    compatibility: {
      pluto: { min: "0.1.0-alpha.0" },
    },
    capabilities: [{ name: "provider-session", level: "admin", reason: "Use a privileged provider session." }],
    secretNames: [],
    toolSurfaces: [{ tool: "bash", access: "exec", reason: "Run local checks." }],
    sensitivityClaims: [],
    outboundWriteClaims: [],
    postureConstraints: [],
    contributions: {
      skills: [],
      templates: [],
      policies: [],
    },
    lifecycle: {
      status: "active",
      channel: "stable",
      createdAt: "2026-04-30T00:00:00.000Z",
      updatedAt: "2026-04-30T00:00:01.000Z",
      publishedAt: "2026-04-30T00:00:02.000Z",
      deprecatedAt: null,
      revokedAt: null,
      replacedBy: null,
    },
  };
}

function makeSignature(): ExtensionSignatureV0 {
  return {
    schemaVersion: 0,
    status: "verified",
    signatureAlgorithm: "ed25519",
    digest: { algorithm: "sha256", value: "archive-512" },
    signer: {
      id: "publisher:pluto-labs",
      displayName: "Pluto Labs",
    },
    provenance: {
      source: "publisher",
      origin: "https://example.com/downloads/pluto.example.revocable-2.0.0.tgz",
      verifiedAt: "2026-04-30T00:00:03.000Z",
    },
    recordedAt: "2026-04-30T00:00:03.000Z",
  };
}

function makePackage(): ExtensionPackageV0 {
  const manifest = makeManifest();
  const signature = makeSignature();
  return {
    schemaVersion: 0,
    packageId: "pkg.example.revocable-2.0.0",
    extensionId: manifest.extensionId,
    version: manifest.version,
    source: {
      kind: "url",
      location: "https://example.com/downloads/pluto.example.revocable-2.0.0.tgz",
      digest: { algorithm: "sha256", value: "archive-512" },
    },
    checksum: { algorithm: "sha256", value: "archive-512" },
    assetRefs: ["manifest"],
    manifest,
    lifecycle: manifest.lifecycle,
    signature,
  };
}

describe("extension revocation", () => {
  it("logs activation denials and blocks new use after revocation without removing historical install refs", async () => {
    const dataDir = join(workDir, ".pluto");
    const store = new ExtensionStore({ dataDir });
    const audit = new ExtensionAuditLog({ dataDir });
    const pkg = makePackage();
    const manifestGate = validateExtensionManifest({
      id: pkg.extensionId,
      version: pkg.version,
      assets: [{ kind: "bundle", path: "dist/index.js" }],
    });

    const install = await installExtension({
      store,
      audit,
      installId: "install-revoke-1",
      packageRecord: pkg,
      installedPath: ".pluto/extensions/pluto.example.revocable/2.0.0",
      requestedBy: "operator:local",
      requestedAt: "2026-04-30T00:10:00.000Z",
    });

    const pendingActivation = await activateExtension({
      store,
      audit,
      installId: install.installId,
      manifest: manifestGate,
      requestedCapabilities: ["provider-session"],
      secretBindings: { state: "ready" },
      capabilityCompatibility: { state: "compatible" },
      policyReconciliation: { state: "reconciled" },
      actor: "operator:local",
      activatedAt: "2026-04-30T00:10:01.000Z",
    });

    expect(pendingActivation.state).toBe("deny");
    expect(pendingActivation.reasons).toEqual(["trust_review_pending"]);

    await recordTrustReview({
      store,
      audit,
      installId: install.installId,
      reviewId: "review-revoke-1",
      verdict: "approved",
      reviewer: {
        id: "operator:security",
        displayName: "Security Reviewer",
      },
      rationale: "Privileged provider-session use is approved for this pinned release.",
      privilegedCapabilities: ["provider-session"],
      reviewedAt: "2026-04-30T00:10:02.000Z",
    });

    const revoked = await revokeExtension({
      store,
      audit,
      installId: install.installId,
      actor: "operator:security",
      revokedAt: "2026-04-30T00:10:03.000Z",
      reason: "Publisher revoked the release after a post-installation finding.",
      replacedBy: "pluto.example.revocable@2.0.1",
    });

    expect(revoked.status).toBe("blocked");
    expect(revoked.lifecycle.status).toBe("revoked");

    const revokedActivation = await activateExtension({
      store,
      audit,
      installId: install.installId,
      manifest: manifestGate,
      requestedCapabilities: ["provider-session"],
      privilegedCapabilities: ["provider-session"],
      secretBindings: { state: "ready" },
      capabilityCompatibility: { state: "compatible" },
      policyReconciliation: { state: "reconciled" },
      actor: "operator:local",
      activatedAt: "2026-04-30T00:10:04.000Z",
    });

    expect(revokedActivation.state).toBe("deny");
    expect(revokedActivation.reasons).toEqual(["extension_revoked"]);

    const persisted = await store.read("installs", install.installId);
    expect(persisted?.version).toBe("2.0.0");
    expect(persisted?.checksum).toEqual({ algorithm: "sha256", value: "archive-512" });
    expect(persisted?.trustReview?.reviewId).toBe("review-revoke-1");

    const events = await audit.list();
    expect(events.map((event) => event.eventType)).toEqual([
      "install",
      "activate-denied",
      "trust-review",
      "revoke",
      "activate-denied",
    ]);
  });
});
