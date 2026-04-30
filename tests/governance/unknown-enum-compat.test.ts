import { describe, expect, it } from "vitest";

import {
  parseGovernanceObjectKindV0,
  parseGovernanceStatusV0,
  validateDocumentRecordV0,
} from "@/contracts/governance.js";

describe("governance enum compatibility", () => {
  it("preserves unknown projection-facing status strings", () => {
    expect(parseGovernanceStatusV0("ready")).toBe("ready");
    expect(parseGovernanceStatusV0("awaiting_legal_hold")).toBe("awaiting_legal_hold");
    expect(parseGovernanceStatusV0(42)).toBeNull();
  });

  it("preserves unknown governance kinds for tolerant readers", () => {
    expect(parseGovernanceObjectKindV0("document")).toBe("document");
    expect(parseGovernanceObjectKindV0("workflow_bundle")).toBe("workflow_bundle");
    expect(parseGovernanceObjectKindV0({ kind: "document" })).toBeNull();
  });

  it("accepts unknown record-local status aliases instead of crashing", () => {
    const result = validateDocumentRecordV0({
      schemaVersion: 0,
      kind: "document",
      id: "doc-1",
      workspaceId: "workspace-1",
      title: "Docs IA",
      ownerId: "owner-1",
      createdAt: "2026-04-30T00:00:00.000Z",
      updatedAt: "2026-04-30T00:00:01.000Z",
      status: "awaiting_signoff",
      currentVersionId: null,
    });

    expect(result.ok).toBe(true);
  });
});
