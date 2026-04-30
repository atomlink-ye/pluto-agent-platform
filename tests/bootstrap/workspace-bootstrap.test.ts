import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { IdentityStore } from "@/identity/identity-store.js";
import { StorageStore } from "@/storage/storage-store.js";
import {
  ensureLocalWorkspaceBootstrap,
  getLocalWorkspaceBootstrapStatus,
  resetLocalWorkspaceBootstrap,
  resumeLocalWorkspaceBootstrap,
} from "@/bootstrap/workspace-bootstrap.js";

let workDir = "";
let dataDir = "";

beforeEach(async () => {
  workDir = await mkdtemp(join(tmpdir(), "pluto-workspace-bootstrap-test-"));
  dataDir = join(workDir, ".pluto");
});

afterEach(async () => {
  await rm(workDir, { recursive: true, force: true });
});

describe("ensureLocalWorkspaceBootstrap", () => {
  it("creates and reconciles the local workspace ref, principal ref, first-admin binding, and bootstrap state", async () => {
    const first = await ensureLocalWorkspaceBootstrap({
      dataDir,
      now: "2026-04-30T00:00:00.000Z",
      workspaceId: "workspace-local-v0",
      principalId: "user-admin-1",
    });

    expect(first.status).toBe("completed");
    expect(first.created).toEqual({
      org: true,
      workspace: true,
      principal: true,
      adminBinding: true,
      stateRef: true,
    });
    expect(first.checklist?.completedStepCount).toBe(8);
    expect(first.checklist?.totalStepCount).toBe(8);
    expect(first.session?.createdObjectRefs.map((ref) => ref.objectType)).toEqual(
      expect.arrayContaining(["workspace", "document", "version", "run", "artifact", "sealed_evidence"]),
    );
    expect(first.session?.status).toBe("succeeded");
    expect(first.blocker).toBeNull();

    const identity = new IdentityStore({ dataDir });
    const storage = new StorageStore({ dataDir });
    const workspace = await identity.get("workspace", "workspace-local-v0");
    const principal = await identity.get("user", "user-admin-1");
    const binding = await identity.get("membership_binding", "workspace-local-v0:admin:user:user-admin-1");
    const state = await storage.get("metadata", "workspace-local-v0:local-bootstrap-state");

    expect(workspace).toMatchObject({
      id: "workspace-local-v0",
      status: "active",
      ownerRef: { workspaceId: "workspace-local-v0", kind: "user", principalId: "user-admin-1" },
    });
    expect(principal).toMatchObject({
      id: "user-admin-1",
      status: "active",
      primaryWorkspaceRef: { workspaceId: "workspace-local-v0", kind: "workspace", id: "workspace-local-v0" },
    });
    expect(binding).toMatchObject({
      id: "workspace-local-v0:admin:user:user-admin-1",
      status: "active",
      role: "admin",
      principal: { workspaceId: "workspace-local-v0", kind: "user", principalId: "user-admin-1" },
    });
    expect(state?.metadata).toMatchObject({
      schema: "pluto.bootstrap.local-workspace-state",
      workspaceRef: { workspaceId: "workspace-local-v0", kind: "workspace", id: "workspace-local-v0" },
      principalRef: { workspaceId: "workspace-local-v0", kind: "user", principalId: "user-admin-1" },
      adminBindingRef: { kind: "membership_binding", id: "workspace-local-v0:admin:user:user-admin-1" },
      status: "completed",
    });

    const second = await ensureLocalWorkspaceBootstrap({
      dataDir,
      now: "2026-04-30T00:05:00.000Z",
      workspaceId: "workspace-local-v0",
      principalId: "user-admin-1",
    });
    expect(second.status).toBe("completed");
    expect(second.created).toEqual({
      org: false,
      workspace: false,
      principal: false,
      adminBinding: false,
      stateRef: false,
    });
    expect(second.activated).toEqual({ workspace: false, adminBinding: false });
  });

  it("blocks principal reassignment until reset-local revokes the prior first-admin binding, then resumes with the new principal", async () => {
    await ensureLocalWorkspaceBootstrap({
      dataDir,
      now: "2026-04-30T00:00:00.000Z",
      workspaceId: "workspace-local-v0",
      principalId: "user-admin-1",
    });

    const blocked = await ensureLocalWorkspaceBootstrap({
      dataDir,
      now: "2026-04-30T00:01:00.000Z",
      workspaceId: "workspace-local-v0",
      principalId: "user-admin-2",
    });
    expect(blocked.status).toBe("blocked");
    expect(blocked.blocker).toMatchObject({ reason: "principal_mismatch" });
    expect(blocked.checklist?.status).toBe("blocked");

    const reset = await resetLocalWorkspaceBootstrap({
      dataDir,
      now: "2026-04-30T00:02:00.000Z",
      workspaceId: "workspace-local-v0",
    });
    expect(reset.status).toBe("reset");
    expect(reset.revoked.adminBinding).toBe(true);

    const resumed = await resumeLocalWorkspaceBootstrap({
      dataDir,
      now: "2026-04-30T00:03:00.000Z",
      workspaceId: "workspace-local-v0",
      principalId: "user-admin-2",
    });
    expect(resumed.status).toBe("completed");
    expect(resumed.principalRef?.principalId).toBe("user-admin-2");
    expect(resumed.blocker).toBeNull();

    const status = await getLocalWorkspaceBootstrapStatus({ dataDir, workspaceId: "workspace-local-v0" });
    expect(status.status).toBe("completed");
    expect(status.principalRef?.principalId).toBe("user-admin-2");
    expect(status.failures.every((failure) => failure.status === "resolved")).toBe(true);
  });
});
