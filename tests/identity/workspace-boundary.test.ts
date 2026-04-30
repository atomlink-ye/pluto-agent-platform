import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { MembershipBindingV0, WorkspaceScopedRefV0 } from "@/contracts/identity.js";
import { workspaceScopeAllowsV0 } from "@/contracts/identity.js";
import { IdentityStore } from "@/identity/identity-store.js";

let workDir: string;

beforeEach(async () => {
  workDir = await mkdtemp(join(tmpdir(), "pluto-workspace-boundary-test-"));
});

afterEach(async () => {
  await rm(workDir, { recursive: true, force: true });
});

function canAccess(binding: MembershipBindingV0, ref: WorkspaceScopedRefV0): boolean {
  return binding.status === "active" && workspaceScopeAllowsV0(binding.workspaceId, ref);
}

describe("identity workspace boundary", () => {
  it("fails closed when a governed ref does not match the binding workspace scope", async () => {
    const store = new IdentityStore({ dataDir: workDir });
    const binding: MembershipBindingV0 = {
      schemaVersion: 0,
      kind: "membership_binding",
      id: "bind_01JTSA0AZQW5Y",
      orgId: "org_01JTS9X1HFW9Q",
      workspaceId: "ws_local_alpha",
      createdAt: "2026-04-30T00:00:00.000Z",
      updatedAt: "2026-04-30T00:00:01.000Z",
      status: "active",
      principal: {
        workspaceId: "ws_local_alpha",
        kind: "user",
        principalId: "user_01JTS9X1TK6D2",
      },
      role: "editor",
      permissions: ["workspace.read", "workspace.write"],
    };

    await store.put("membership_binding", binding);

    const sameWorkspaceRef: WorkspaceScopedRefV0 = {
      workspaceId: "ws_local_alpha",
      kind: "document",
      id: "doc_1",
    };
    const otherWorkspaceRef: WorkspaceScopedRefV0 = {
      workspaceId: "ws_local_bravo",
      kind: "document",
      id: "doc_2",
    };

    expect(canAccess(binding, sameWorkspaceRef)).toBe(true);
    expect(canAccess(binding, otherWorkspaceRef)).toBe(false);
  });

  it("keeps workspace scope deterministic after store round-trip", async () => {
    const store = new IdentityStore({ dataDir: workDir });
    await store.put("membership_binding", {
      schemaVersion: 0,
      kind: "membership_binding",
      id: "bind_01JTSA0AZQW5Y",
      orgId: "org_01JTS9X1HFW9Q",
      workspaceId: "ws_local_alpha",
      createdAt: "2026-04-30T00:00:00.000Z",
      updatedAt: "2026-04-30T00:00:01.000Z",
      status: "active",
      principal: {
        workspaceId: "ws_local_alpha",
        kind: "service_account",
        principalId: "sa_01JTS9X23Q8A7",
      },
      role: "viewer",
      permissions: ["workspace.read"],
    });

    const stored = await store.get("membership_binding", "bind_01JTSA0AZQW5Y");
    expect(stored).not.toBeNull();
    expect(workspaceScopeAllowsV0(stored!.workspaceId, {
      workspaceId: "ws_local_bravo",
      kind: "run",
      id: "run_1",
    })).toBe(false);
  });
});
