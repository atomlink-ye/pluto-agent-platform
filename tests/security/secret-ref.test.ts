import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { validateSecretRefV0 } from "@/contracts/security.js";
import { SecurityStore } from "@/security/security-store.js";

let workDir: string;

beforeEach(async () => {
  workDir = await mkdtemp(join(tmpdir(), "pluto-security-store-"));
});

afterEach(async () => {
  await rm(workDir, { recursive: true, force: true });
});

describe("secret refs", () => {
  it("rejects resolved secret value fields", () => {
    const result = validateSecretRefV0({
      schemaVersion: 0,
      kind: "secret_ref",
      workspaceId: "workspace-1",
      name: "OPENCODE_API_KEY",
      ref: "opencode://secrets/OPENCODE_API_KEY",
      displayLabel: "OpenCode API key",
      status: "active",
      createdAt: "2026-04-30T00:00:00.000Z",
      updatedAt: "2026-04-30T00:00:01.000Z",
      actorRefs: [{ workspaceId: "workspace-1", kind: "user", principalId: "user-1" }],
      value: "should-not-be-stored",
    });

    expect(result.ok).toBe(false);
    expect(result.ok ? [] : result.errors).toContain("secret refs must not contain value");
  });

  it("stores only secret-ref metadata via the local-v0 facade", async () => {
    const store = new SecurityStore({ dataDir: workDir });
    const secret = await store.putSecretRef({
      schemaVersion: 0,
      kind: "secret_ref",
      workspaceId: "workspace-1",
      name: "OPENCODE_API_KEY",
      ref: "opencode://secrets/OPENCODE_API_KEY",
      displayLabel: "OpenCode API key",
      status: "active",
      createdAt: "2026-04-30T00:00:00.000Z",
      updatedAt: "2026-04-30T00:00:01.000Z",
      providerType: "local_v0",
      actorRefs: [{ workspaceId: "workspace-1", kind: "user", principalId: "user-1" }],
    });

    expect(secret.ref).toBe("opencode://secrets/OPENCODE_API_KEY");
    expect(await store.getSecretRef("OPENCODE_API_KEY")).toEqual(secret);
    expect(await store.listSecretRefs("workspace-1")).toEqual([secret]);

    const persisted = await readAllFiles(workDir);
    expect(persisted).toContain("opencode://secrets/OPENCODE_API_KEY");
    expect(persisted).not.toContain("resolved-secret-value");
  });

  it("rejects legacy secret-ref fields that are outside the scoped metadata contract", () => {
    const result = validateSecretRefV0({
      schemaVersion: 0,
      kind: "secret_ref",
      workspaceId: "workspace-1",
      name: "OPENCODE_API_KEY",
      ref: "opencode://secrets/OPENCODE_API_KEY",
      displayLabel: "OpenCode API key",
      status: "active",
      createdAt: "2026-04-30T00:00:00.000Z",
      updatedAt: "2026-04-30T00:00:01.000Z",
      actorRefs: [{ workspaceId: "workspace-1", kind: "user", principalId: "user-1" }],
      alias: "legacy-alias",
    });

    expect(result.ok).toBe(false);
    expect(result.ok ? [] : result.errors).toContain("secret refs must not contain alias");
  });
});

async function readAllFiles(root: string): Promise<string> {
  const entries = await readdir(root, { withFileTypes: true });
  const chunks: string[] = [];

  for (const entry of entries) {
    const path = join(root, entry.name);
    if (entry.isDirectory()) {
      chunks.push(await readAllFiles(path));
      continue;
    }

    chunks.push(await readFile(path, "utf8"));
  }

  return chunks.join("\n");
}
