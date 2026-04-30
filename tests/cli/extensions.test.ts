import { execFile } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type {
  ExtensionCapabilityClaimV0,
  ExtensionListOutputV0,
  ExtensionManifestV0,
  ExtensionPackageV0,
  ExtensionSignatureV0,
} from "@/extensions/contracts.js";
import { ExtensionStore } from "@/extensions/extension-store.js";
import { recordTrustReview } from "@/extensions/lifecycle.js";

const exec = promisify(execFile);

let workDir: string;
let dataDir: string;

beforeEach(async () => {
  workDir = await mkdtemp(join(tmpdir(), "pluto-extensions-cli-test-"));
  dataDir = join(workDir, ".pluto");

  const store = new ExtensionStore({ dataDir });
  const pkg = makePackage();
  await store.upsert("packages", pkg.packageId, pkg);
});

afterEach(async () => {
  await rm(workDir, { recursive: true, force: true });
});

async function runExtensions(args: string[]): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  try {
    const result = await exec("npx", ["tsx", join(process.cwd(), "src/cli/extensions.ts"), ...args], {
      cwd: process.cwd(),
      env: { ...process.env, PLUTO_DATA_DIR: dataDir },
      timeout: 10_000,
    });
    return { stdout: result.stdout, stderr: result.stderr, exitCode: 0 };
  } catch (err: unknown) {
    const e = err as { stdout?: string; stderr?: string; code?: number };
    return { stdout: e.stdout ?? "", stderr: e.stderr ?? "", exitCode: e.code ?? 1 };
  }
}

describe("pnpm extensions", () => {
  it("installs, lists, shows, activates, and revokes extension installs", async () => {
    const install = await runExtensions([
      "install",
      "pkg.example.cli-1.2.3",
      "--install-id",
      "install-cli-1",
      "--requested-by",
      "operator:test",
      "--json",
    ]);
    expect(install.exitCode).toBe(0);
    const installed = JSON.parse(install.stdout);
    expect(installed.item.state).toBe("draft");
    expect(installed.record.installedPath).toBe(".pluto/extensions/pluto.example.cli/1.2.3");

    const list = await runExtensions(["list", "--json"]);
    expect(list.exitCode).toBe(0);
    const output: ExtensionListOutputV0 = JSON.parse(list.stdout);
    expect(output.schema).toBe("pluto.extensions.list-output");
    expect(output.schemaVersion).toBe(0);
    expect(output.items).toHaveLength(1);
    expect(output.items[0]?.signatureStatus).toBe("verified");
    expect(output.items[0]?.provenanceSource).toBe("publisher");

    const showText = await runExtensions(["show", "install-cli-1"]);
    expect(showText.exitCode).toBe(0);
    expect(showText.stdout).toContain("Provenance: publisher https://example.com/downloads/pluto.example.cli-1.2.3.tgz");

    const activate = await runExtensions(["activate", "install-cli-1", "--json"]);
    expect(activate.exitCode).toBe(0);
    const activated = JSON.parse(activate.stdout);
    expect(activated.state).toBe("allow");
    expect(activated.item.state).toBe("active");

    const revoke = await runExtensions([
      "revoke",
      "install-cli-1",
      "--reason",
      "Operator disabled this test fixture.",
      "--replaced-by",
      "pluto.example.cli@1.2.4",
      "--json",
    ]);
    expect(revoke.exitCode).toBe(0);
    const revoked = JSON.parse(revoke.stdout);
    expect(revoked.item.state).toBe("revoked");
    expect(revoked.record.lifecycle.replacedBy).toBe("pluto.example.cli@1.2.4");

    const listText = await runExtensions(["list"]);
    expect(listText.exitCode).toBe(0);
    expect(listText.stdout).toContain("install-cli-1");
    expect(listText.stdout).toContain("revoked");
  });

  it("denies activation when the manifest requests privileged capabilities outside the approved scope", async () => {
    const store = new ExtensionStore({ dataDir });
    await store.upsert("packages", "pkg.example.cli-1.2.4", makePackage({
      packageId: "pkg.example.cli-1.2.4",
      version: "1.2.4",
      capabilities: [
        { name: "catalog.read", level: "read", reason: "Inspect local catalog state." },
        { name: "runtime.exec", level: "exec", reason: "Run local validation commands." },
      ],
      sourceLocation: "https://example.com/downloads/pluto.example.cli-1.2.4.tgz",
      digestValue: "archive-124",
      manifestChecksumValue: "manifest-124",
    }));

    const install = await runExtensions([
      "install",
      "pkg.example.cli-1.2.4",
      "--install-id",
      "install-cli-mismatch",
      "--json",
    ]);
    expect(install.exitCode).toBe(0);

    await recordTrustReview({
      store,
      installId: "install-cli-mismatch",
      reviewId: "review-cli-mismatch",
      verdict: "approved",
      reviewer: {
        id: "operator:security",
        displayName: "Security Reviewer",
      },
      rationale: "Approved read-only catalog access.",
      privilegedCapabilities: [],
      reviewedAt: "2026-04-30T00:00:11.000Z",
    });

    const activate = await runExtensions(["activate", "install-cli-mismatch", "--json"]);
    expect(activate.exitCode).toBe(0);
    const activated = JSON.parse(activate.stdout);
    expect(activated.state).toBe("deny");
    expect(activated.reasons).toContain("privileged_scope_unapproved:runtime.exec");
    expect(activated.item.state).toBe("draft");
  });
});

function makeManifest(options?: {
  version?: string;
  capabilities?: ExtensionCapabilityClaimV0[];
  manifestChecksumValue?: string;
}): ExtensionManifestV0 {
  return {
    schemaVersion: 0,
    extensionId: "pluto.example.cli",
    name: "CLI Fixture",
    version: options?.version ?? "1.2.3",
    description: "Extension CLI test fixture.",
    publisher: { name: "Pluto Labs" },
    license: "MIT",
    keywords: ["cli"],
    assets: [
      {
        assetId: "manifest",
        kind: "manifest",
        path: "manifest.json",
        mediaType: "application/json",
        checksum: { algorithm: "sha256", value: options?.manifestChecksumValue ?? "manifest-123" },
      },
    ],
    extensionPoints: [],
    compatibility: {
      pluto: { min: "0.1.0-alpha.0" },
    },
    capabilities: options?.capabilities ?? [{ name: "catalog.read", level: "read", reason: "Inspect local catalog state." }],
    secretNames: [],
    toolSurfaces: [{ tool: "read", access: "read", reason: "Read local files." }],
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

function makeSignature(options?: { sourceLocation?: string; digestValue?: string }): ExtensionSignatureV0 {
  return {
    schemaVersion: 0,
    status: "verified",
    signatureAlgorithm: "ed25519",
    digest: { algorithm: "sha256", value: options?.digestValue ?? "archive-123" },
    signer: {
      id: "publisher:pluto-labs",
      displayName: "Pluto Labs",
    },
    provenance: {
      source: "publisher",
      origin: options?.sourceLocation ?? "https://example.com/downloads/pluto.example.cli-1.2.3.tgz",
      verifiedAt: "2026-04-30T00:00:03.000Z",
    },
    recordedAt: "2026-04-30T00:00:03.000Z",
  };
}

function makePackage(options?: {
  packageId?: string;
  version?: string;
  capabilities?: ExtensionCapabilityClaimV0[];
  sourceLocation?: string;
  digestValue?: string;
  manifestChecksumValue?: string;
}): ExtensionPackageV0 {
  const manifest = makeManifest({
    version: options?.version,
    capabilities: options?.capabilities,
    manifestChecksumValue: options?.manifestChecksumValue,
  });
  const signature = makeSignature({
    sourceLocation: options?.sourceLocation,
    digestValue: options?.digestValue,
  });
  return {
    schemaVersion: 0,
    packageId: options?.packageId ?? "pkg.example.cli-1.2.3",
    extensionId: manifest.extensionId,
    version: manifest.version,
    source: {
      kind: "url",
      location: options?.sourceLocation ?? "https://example.com/downloads/pluto.example.cli-1.2.3.tgz",
      digest: { algorithm: "sha256", value: options?.digestValue ?? "archive-123" },
    },
    checksum: { algorithm: "sha256", value: options?.digestValue ?? "archive-123" },
    assetRefs: ["manifest"],
    manifest,
    lifecycle: manifest.lifecycle,
    signature,
  };
}
