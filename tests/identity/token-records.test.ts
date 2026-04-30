import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { ApiTokenRecordV0 } from "@/contracts/identity.js";
import { validateApiTokenRecordV0 } from "@/contracts/identity.js";
import { IdentityStore } from "@/identity/identity-store.js";

let workDir: string;

beforeEach(async () => {
  workDir = await mkdtemp(join(tmpdir(), "pluto-identity-store-test-"));
});

afterEach(async () => {
  await rm(workDir, { recursive: true, force: true });
});

async function readAllFiles(root: string): Promise<string[]> {
  const entries = await readdir(root, { recursive: true, withFileTypes: true });
  const files = entries.filter((entry) => entry.isFile());
  return Promise.all(files.map((entry) => readFile(join(entry.parentPath, entry.name), "utf8")));
}

describe("identity token records", () => {
  it("store only prefix, hash, verification metadata, expiry, rotation, revocation, and refs", async () => {
    const store = new IdentityStore({ dataDir: workDir });
    const tokenRecord: ApiTokenRecordV0 = {
      schemaVersion: 0 as const,
      kind: "api_token",
      id: "tok_01JTS9YF9QJQ3",
      orgId: "org_01JTS9X1HFW9Q",
      workspaceId: "ws_01JTS9X1M5N4Q",
      label: "CI publisher token",
      status: "active",
      createdAt: "2026-04-30T00:00:00.000Z",
      updatedAt: "2026-04-30T00:05:00.000Z",
      tokenPrefix: "pluto_ci_",
      tokenHash: "sha256:0d4f1a",
      verification: {
        hashAlgorithm: "sha256",
        verificationState: "verified",
        verifiedAt: "2026-04-30T00:00:01.000Z",
        lastUsedAt: "2026-04-30T00:04:59.000Z",
      },
      allowedActions: ["workspace.write", "governance.publish"],
      expiresAt: "2026-05-30T00:00:00.000Z",
      rotatedAt: null,
      revokedAt: null,
      replacedByTokenId: null,
      principal: {
        workspaceId: "ws_01JTS9X1M5N4Q",
        kind: "service_account",
        principalId: "sa_01JTS9X23Q8A7",
      },
      actorRef: {
        workspaceId: "ws_01JTS9X1M5N4Q",
        kind: "user",
        principalId: "user_01JTS9X1TK6D2",
      },
    };

    expect(validateApiTokenRecordV0(tokenRecord).ok).toBe(true);
    await store.put("api_token", tokenRecord);

    const rawFiles = await readAllFiles(workDir);
    expect(rawFiles.join("\n")).toContain("pluto_ci_");
    expect(rawFiles.join("\n")).toContain("sha256:0d4f1a");
    expect(rawFiles.join("\n")).not.toContain("pluto_ci_live_secret_value");
    expect(rawFiles.join("\n")).not.toContain('"tokenValue"');
    expect(rawFiles.join("\n")).not.toContain('"secret"');
  });

  it("reject records that try to persist raw token material", () => {
    const result = validateApiTokenRecordV0({
      schemaVersion: 0,
      kind: "api_token",
      id: "tok_01JTS9YF9QJQ3",
      orgId: "org_01JTS9X1HFW9Q",
      workspaceId: "ws_01JTS9X1M5N4Q",
      label: "CI publisher token",
      status: "active",
      createdAt: "2026-04-30T00:00:00.000Z",
      updatedAt: "2026-04-30T00:05:00.000Z",
      tokenPrefix: "pluto_ci_",
      tokenHash: "sha256:0d4f1a",
      verification: {
        hashAlgorithm: "sha256",
        verificationState: "verified",
      },
      allowedActions: ["workspace.write"],
      principal: {
        workspaceId: "ws_01JTS9X1M5N4Q",
        kind: "service_account",
        principalId: "sa_01JTS9X23Q8A7",
      },
      actorRef: {
        workspaceId: "ws_01JTS9X1M5N4Q",
        kind: "user",
        principalId: "user_01JTS9X1TK6D2",
      },
      tokenValue: "pluto_ci_live_secret_value",
    });

    expect(result.ok).toBe(false);
    expect(result.ok ? [] : result.errors).toContain("api token records must not include token secret material");
  });
});
