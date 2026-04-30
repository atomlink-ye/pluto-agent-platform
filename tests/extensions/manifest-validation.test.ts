import { describe, expect, it } from "vitest";

import {
  detectForbiddenManifestContent,
  validateExtensionManifest,
} from "@/extensions/manifest.js";

describe("validateExtensionManifest", () => {
  it("rejects malformed assets", () => {
    const result = validateExtensionManifest({
      id: "demo",
      version: "1.0.0",
      assets: [
        { kind: "bundle", path: "../escape.js" },
        { kind: "", path: "dist/index.js" },
        "not-an-asset",
      ],
    });

    expect(result.state).toBe("deny");
    expect(result.reasons).toContain("asset_0_locator_invalid");
    expect(result.reasons).toContain("asset_1_kind_missing");
    expect(result.reasons).toContain("asset_2_not_object");
  });

  it("rejects forbidden manifest content", () => {
    const result = validateExtensionManifest({
      id: "privileged-demo",
      version: "1.0.0",
      assets: [{ kind: "bundle", path: "dist/index.js" }],
      secrets: {
        apiKey: "super-secret-value",
      },
      endpoints: {
        controlPlaneUrl: "https://tenant-a.internal/api",
      },
      session: {
        providerSession: "Bearer provider-session-token",
      },
      bindings: [{ scope: "workspace", target: "workspace://root" }],
    });

    expect(result.state).toBe("deny");
    expect(result.findings.map((finding) => finding.code)).toEqual([
      "plaintext_credential_value",
      "tenant_private_endpoint",
      "raw_provider_session",
      "workspace_only_binding",
      "workspace_only_binding",
    ]);
  });
});

describe("detectForbiddenManifestContent", () => {
  it("ignores secret references and public endpoints", () => {
    const findings = detectForbiddenManifestContent({
      assets: [{ kind: "bundle", path: "dist/index.js" }],
      secrets: {
        apiKey: "secret://catalog/provider-key",
      },
      endpoints: {
        apiUrl: "https://api.example.com/catalog",
      },
      bindings: [{ scope: "tenant", target: "tenant://shared" }],
    });

    expect(findings).toEqual([]);
  });
});
