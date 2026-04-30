import { describe, expect, it } from "vitest";

import { resolvePortabilityConflictV0 } from "@/portability/conflicts.js";

const incoming = {
  kind: "document" as const,
  logicalId: "doc.handbook",
  sourceDocumentId: "document-1",
  sourceVersionId: "version-7",
};

describe("portable import conflicts", () => {
  it("creates drafts when the existing record is still a draft", () => {
    const conflict = resolvePortabilityConflictV0({
      incoming,
      existing: {
        assetKind: "document",
        logicalId: "doc.handbook",
        status: "draft",
      },
      resolution: "duplicate",
    });

    expect(conflict.outcome).toBe("created_as_draft");
    expect(conflict.code).toBe("draft_record_conflict");
  });

  it("creates forks when conflict policy selects fork", () => {
    const conflict = resolvePortabilityConflictV0({
      incoming,
      existing: {
        assetKind: "document",
        logicalId: "doc.handbook",
        status: "published",
      },
      resolution: "fork",
    });

    expect(conflict.outcome).toBe("created_as_fork");
    expect(conflict.code).toBe("protected_record_conflict");
  });

  it("rejects imports instead of overwriting accepted or published records by default", () => {
    const accepted = resolvePortabilityConflictV0({
      incoming,
      existing: {
        assetKind: "document",
        logicalId: "doc.handbook",
        status: "accepted",
      },
      resolution: "duplicate",
    });

    const published = resolvePortabilityConflictV0({
      incoming,
      existing: {
        assetKind: "document",
        logicalId: "doc.handbook",
        status: "published",
      },
      resolution: "map",
    });

    expect(accepted.outcome).toBe("rejected");
    expect(published.outcome).toBe("rejected");
    expect(accepted.message).toContain("cannot overwrite an accepted or published record by default");
    expect(published.message).toContain("cannot overwrite an accepted or published record by default");
  });
});
