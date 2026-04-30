import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { ExtensionAuditLog } from "@/extensions/audit.js";
import type { ExtensionManifestV0, ExtensionPackageV0, ExtensionSignatureV0 } from "@/extensions/contracts.js";
import { ExtensionStore } from "@/extensions/extension-store.js";
import {
  activateExtension,
  deactivateExtension,
  installExtension,
  recordTrustReview,
} from "@/extensions/lifecycle.js";
import { validateExtensionManifest } from "@/extensions/manifest.js";

let workDir: string;

beforeEach(async () => {
  workDir = await mkdtemp(join(tmpdir(), "pluto-extension-lifecycle-test-"));
});

afterEach(async () => {
  await rm(workDir, { recursive: true, force: true });
});

function makeManifest(): ExtensionManifestV0 {
  return {
    schemaVersion: 0,
    extensionId: "pluto.example.bundle",
    name: "Example Bundle",
    version: "1.2.3",
    description: "Lifecycle test fixture.",
    publisher: { name: "Pluto Labs" },
    license: "MIT",
    keywords: ["lifecycle"],
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
    capabilities: [{ name: "runtime.exec", level: "exec", reason: "Run local validation commands." }],
    secretNames: [],
    toolSurfaces: [{ tool: "bash", access: "exec", reason: "Execute local checks." }],
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
    digest: { algorithm: "sha256", value: "archive-256" },
    signer: {
      id: "publisher:pluto-labs",
      displayName: "Pluto Labs",
    },
    provenance: {
      source: "publisher",
      origin: "https://example.com/downloads/pluto.example.bundle-1.2.3.tgz",
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
    packageId: "pkg.example.bundle-1.2.3",
    extensionId: manifest.extensionId,
    version: manifest.version,
    source: {
      kind: "url",
      location: "https://example.com/downloads/pluto.example.bundle-1.2.3.tgz",
      digest: { algorithm: "sha256", value: "archive-256" },
    },
    checksum: { algorithm: "sha256", value: "archive-256" },
    assetRefs: ["manifest"],
    manifest,
    lifecycle: manifest.lifecycle,
    signature,
  };
}

describe("extension lifecycle", () => {
  it("creates pinned installs, records trust review scope, and applies explicit activation transitions", async () => {
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
      installId: "install-1",
      packageRecord: pkg,
      installedPath: ".pluto/extensions/pluto.example.bundle/1.2.3",
      requestedBy: "operator:local",
      requestedAt: "2026-04-30T00:00:10.000Z",
    });

    expect(install.version).toBe("1.2.3");
    expect(install.checksum).toEqual({ algorithm: "sha256", value: "archive-256" });
    expect(install.lifecycle.status).toBe("draft");

    const review = await recordTrustReview({
      store,
      audit,
      installId: install.installId,
      reviewId: "review-1",
      verdict: "approved",
      reviewer: {
        id: "operator:security",
        displayName: "Security Reviewer",
      },
      rationale: "Declared privileged access matches the package intent.",
      privilegedCapabilities: ["runtime.exec"],
      reviewedAt: "2026-04-30T00:00:11.000Z",
    });

    expect(review.reason).toBe("Declared privileged access matches the package intent.");
    expect(review.privilegedCapabilities).toEqual(["runtime.exec"]);

    const activated = await activateExtension({
      store,
      audit,
      installId: install.installId,
      manifest: manifestGate,
      requestedCapabilities: ["runtime.exec"],
      privilegedCapabilities: ["runtime.exec"],
      secretBindings: { state: "ready" },
      capabilityCompatibility: { state: "compatible" },
      policyReconciliation: { state: "reconciled" },
      actor: "operator:local",
      activatedAt: "2026-04-30T00:00:12.000Z",
    });

    expect(activated.state).toBe("allow");
    expect(activated.install.lifecycle.status).toBe("active");

    const deactivated = await deactivateExtension({
      store,
      audit,
      installId: install.installId,
      actor: "operator:local",
      deactivatedAt: "2026-04-30T00:00:13.000Z",
    });

    expect(deactivated.lifecycle.status).toBe("draft");
    expect((await store.read("installs", install.installId))?.trustReview?.privilegedCapabilities).toEqual(["runtime.exec"]);

    const events = await audit.list();
    expect(events.map((event) => event.eventType)).toEqual([
      "install",
      "trust-review",
      "activate",
      "deactivate",
    ]);
  });

  it("denies privileged activation when the approved trust-review scope does not cover the requested capabilities", async () => {
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
      installId: "install-2",
      packageRecord: pkg,
      installedPath: ".pluto/extensions/pluto.example.bundle/1.2.3",
      requestedBy: "operator:local",
      requestedAt: "2026-04-30T00:01:10.000Z",
    });

    await recordTrustReview({
      store,
      audit,
      installId: install.installId,
      reviewId: "review-2",
      verdict: "approved",
      reviewer: {
        id: "operator:security",
        displayName: "Security Reviewer",
      },
      rationale: "Approved only for runtime exec access.",
      privilegedCapabilities: ["runtime.exec"],
      reviewedAt: "2026-04-30T00:01:11.000Z",
    });

    const denied = await activateExtension({
      store,
      audit,
      installId: install.installId,
      manifest: manifestGate,
      requestedCapabilities: ["runtime.exec", "provider-session"],
      secretBindings: { state: "ready" },
      capabilityCompatibility: { state: "compatible" },
      policyReconciliation: { state: "reconciled" },
      actor: "operator:local",
      activatedAt: "2026-04-30T00:01:12.000Z",
    });

    expect(denied.state).toBe("deny");
    expect(denied.reasons).toEqual(["trust_review_scope_missing:provider-session"]);
    expect(denied.install.lifecycle.status).toBe("draft");

    const persisted = await store.read("installs", install.installId);
    expect(persisted?.lifecycle.status).toBe("draft");

    const events = await audit.list();
    expect(events.map((event) => event.eventType)).toEqual([
      "install",
      "trust-review",
      "activate-denied",
    ]);
  });
});
