import { describe, expect, it } from "vitest";

import {
  normalizeRuntimePairingStatusV0,
  validateRuntimePairingStateV0,
} from "@/contracts/ops.js";

describe("upgrade status compatibility", () => {
  it("treats legacy done as a synonym for succeeded in readers", () => {
    expect(normalizeRuntimePairingStatusV0("done")).toBe("succeeded");
    expect(normalizeRuntimePairingStatusV0("succeeded")).toBe("succeeded");
  });

  it("keeps legacy done records valid without mutating stored values", () => {
    const record = {
      schema: "pluto.ops.runtime-pairing-state",
      schemaVersion: 0,
      id: "pairing-legacy",
      workspaceId: "workspace-1",
      planId: "upgrade-plan-1",
      upgradeRunId: "upgrade-run-1",
      sourceRuntimeVersion: "opencode@1.0.0",
      targetRuntimeVersion: "opencode@1.1.0",
      status: "done",
      pairedRuntimeIds: ["runtime:old", "runtime:new"],
      approvalRefs: ["approval:upgrade-1"],
      backupRefs: ["backup:manifest-1"],
      healthRefs: ["health:signal-1"],
      rollbackRefs: ["rollback:playbook-1"],
      evidenceRefs: ["evidence:pairing-log-1"],
      createdAt: "2026-04-30T00:00:00.000Z",
      updatedAt: "2026-04-30T00:00:00.000Z",
    };

    const validated = validateRuntimePairingStateV0(record);
    expect(validated.ok).toBe(true);
    expect(record.status).toBe("done");
    expect(normalizeRuntimePairingStatusV0(record.status)).toBe("succeeded");
  });

  it("passes through known and future additive statuses", () => {
    expect(normalizeRuntimePairingStatusV0("failed")).toBe("failed");
    expect(normalizeRuntimePairingStatusV0("future_status")).toBe("future_status");
    expect(normalizeRuntimePairingStatusV0(42)).toBeNull();
  });
});
