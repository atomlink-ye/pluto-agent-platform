import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { GovernanceEventStore } from "@/audit/governance-event-store.js";
import {
  ensureLocalWorkspaceBootstrap,
  resetLocalWorkspaceBootstrap,
  resumeLocalWorkspaceBootstrap,
} from "@/bootstrap/workspace-bootstrap.js";

let workDir = "";
let dataDir = "";

beforeEach(async () => {
  workDir = await mkdtemp(join(tmpdir(), "pluto-bootstrap-admin-audit-test-"));
  dataDir = join(workDir, ".pluto");
});

afterEach(async () => {
  await rm(workDir, { recursive: true, force: true });
});

describe("workspace bootstrap audit", () => {
  it("emits stable auditable decisions for workspace create, admin grant/revoke, blocker resolution, and bootstrap completion", async () => {
    await ensureLocalWorkspaceBootstrap({
      dataDir,
      now: "2026-04-30T00:00:00.000Z",
      workspaceId: "workspace-local-v0",
      principalId: "user-admin-1",
    });
    await ensureLocalWorkspaceBootstrap({
      dataDir,
      now: "2026-04-30T00:01:00.000Z",
      workspaceId: "workspace-local-v0",
      principalId: "user-admin-2",
    });
    await resetLocalWorkspaceBootstrap({
      dataDir,
      now: "2026-04-30T00:02:00.000Z",
      workspaceId: "workspace-local-v0",
    });
    await resumeLocalWorkspaceBootstrap({
      dataDir,
      now: "2026-04-30T00:03:00.000Z",
      workspaceId: "workspace-local-v0",
      principalId: "user-admin-2",
    });

    const audit = new GovernanceEventStore({ dataDir });
    const events = await audit.list();

    expect(events.map((event) => event.eventType)).toEqual([
      "workspace_created",
      "admin_granted",
      "bootstrap_completed",
      "bootstrap_blocked",
      "admin_revoked",
      "blocker_resolved",
      "admin_granted",
      "bootstrap_completed",
    ]);

    expect(events[0]).toMatchObject({
      eventType: "workspace_created",
      target: { kind: "workspace", recordId: "workspace-local-v0", workspaceId: "workspace-local-v0" },
      status: { after: "active", summary: "workspace workspace-local-v0 created" },
      source: { command: "bootstrap.workspace", ref: "workspace-local-v0" },
    });
    expect(events[1]).toMatchObject({
      eventType: "admin_granted",
      target: { kind: "membership_binding", recordId: "workspace-local-v0:admin:user:user-admin-1" },
    });
    expect(events[3]).toMatchObject({
      eventType: "bootstrap_blocked",
      target: { kind: "bootstrap_failure", recordId: "workspace-local-v0:bootstrap-blocker" },
      reason: "principal_mismatch",
    });
    expect(events[4]).toMatchObject({
      eventType: "admin_revoked",
      reason: "reset_local",
      target: { recordId: "workspace-local-v0:admin:user:user-admin-1" },
    });
    expect(events[5]).toMatchObject({
      eventType: "blocker_resolved",
      reason: "reset_local",
      target: { kind: "bootstrap_failure", recordId: "workspace-local-v0:bootstrap-blocker" },
    });
    expect(events[7]).toMatchObject({
      eventType: "bootstrap_completed",
      target: { kind: "bootstrap_session", recordId: "bootstrap-local-workspace-admin" },
      status: { before: "running", after: "succeeded" },
    });
  });
});
