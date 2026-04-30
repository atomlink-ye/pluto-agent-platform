import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { GovernanceEventStore } from "@/audit/governance-event-store.js";
import { classifyBootstrapFailureReasonV0 } from "@/bootstrap/failures.js";
import {
  ensureLocalWorkspaceBootstrap,
  getLocalWorkspaceBootstrapStatus,
  resetLocalWorkspaceBootstrap,
  resumeLocalWorkspaceBootstrap,
} from "@/bootstrap/workspace-bootstrap.js";
import { StorageStore } from "@/storage/storage-store.js";

let workDir = "";
let dataDir = "";

beforeEach(async () => {
  workDir = await mkdtemp(join(tmpdir(), "pluto-bootstrap-blocker-recovery-"));
  dataDir = join(workDir, ".pluto");
});

afterEach(async () => {
  await rm(workDir, { recursive: true, force: true });
});

describe("bootstrap blocker recovery", () => {
  it("maps retry and recovery blockers onto the stable scope reason codes", () => {
    expect(classifyBootstrapFailureReasonV0({ blockingReason: "runtime_unavailable", resolutionHint: null })).toEqual({
      reasonCode: "runtime_unavailable",
      retryable: true,
    });
    expect(classifyBootstrapFailureReasonV0({ blockingReason: "unsupported_capability", resolutionHint: null })?.reasonCode).toBe("capability_unsupported");
    expect(classifyBootstrapFailureReasonV0({ blockingReason: "missing_secret_ref", resolutionHint: null })?.reasonCode).toBe("secret_ref_missing");
    expect(classifyBootstrapFailureReasonV0({ blockingReason: "policy_blocked", resolutionHint: null })?.reasonCode).toBe("policy_blocked");
    expect(classifyBootstrapFailureReasonV0({ blockingReason: "quota_exceeded", resolutionHint: null })?.reasonCode).toBe("budget_blocked");
    expect(classifyBootstrapFailureReasonV0({ blockingReason: "sample_invalid", resolutionHint: null })?.reasonCode).toBe("invalid_sample");
    expect(classifyBootstrapFailureReasonV0({ blockingReason: "validation_failed", resolutionHint: null })?.reasonCode).toBe("run_failed");
    expect(classifyBootstrapFailureReasonV0({ blockingReason: "empty_artifact", resolutionHint: null })?.reasonCode).toBe("empty_artifact");
    expect(classifyBootstrapFailureReasonV0({ blockingReason: "bootstrap_secret_redaction_failed", resolutionHint: null })?.reasonCode).toBe("redaction_failed");
    expect(classifyBootstrapFailureReasonV0({ blockingReason: "missing_sealed_evidence", resolutionHint: null })?.reasonCode).toBe("evidence_unsealed");
    expect(classifyBootstrapFailureReasonV0({ blockingReason: "principal_mismatch", resolutionHint: null })?.reasonCode).toBe("permission_denied");
  });

  it("resolves a blocked bootstrap exactly once across reset-local and resume retries and leaves auditable events", async () => {
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

    const blocked = await getLocalWorkspaceBootstrapStatus({ dataDir, workspaceId: "workspace-local-v0" });
    expect(blocked.blocker).toMatchObject({
      reason: "principal_mismatch",
      reasonCode: "permission_denied",
      retryable: false,
    });

    await resetLocalWorkspaceBootstrap({
      dataDir,
      now: "2026-04-30T00:02:00.000Z",
      workspaceId: "workspace-local-v0",
    });
    await resetLocalWorkspaceBootstrap({
      dataDir,
      now: "2026-04-30T00:03:00.000Z",
      workspaceId: "workspace-local-v0",
    });
    await resumeLocalWorkspaceBootstrap({
      dataDir,
      now: "2026-04-30T00:04:00.000Z",
      workspaceId: "workspace-local-v0",
      principalId: "user-admin-2",
    });
    await resumeLocalWorkspaceBootstrap({
      dataDir,
      now: "2026-04-30T00:05:00.000Z",
      workspaceId: "workspace-local-v0",
      principalId: "user-admin-2",
    });

    const storage = new StorageStore({ dataDir });
    const audit = new GovernanceEventStore({ dataDir });
    const resetEvents = (await storage.list("event_ledger")).filter((event) => event.eventType === "bootstrap.reset_local");
    const resolvedEvents = (await audit.list()).filter((event) => event.eventType === "blocker_resolved");

    expect(resetEvents).toHaveLength(1);
    expect(resolvedEvents).toHaveLength(1);
    expect(resolvedEvents[0]?.reason).toBe("reset_local");
  });
});
