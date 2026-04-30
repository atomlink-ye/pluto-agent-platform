import { describe, expect, it } from "vitest";

import {
  toStorageRefV0,
  toStorageStatusV0,
  validateExternalRefRecordV0,
} from "@/contracts/storage.js";

describe("external storage refs", () => {
  it("remains a pointer with trust, availability, and retention notes", () => {
    const record = {
      schemaVersion: 0 as const,
      storageVersion: "local-v0" as const,
      kind: "external_ref" as const,
      id: "external-1",
      workspaceId: "workspace-1",
      objectType: "governance-packet",
      status: "external",
      actorRefs: [{ actorId: "partner-sync", actorType: "service" as const }],
      createdAt: "2026-04-30T00:00:00.000Z",
      updatedAt: "2026-04-30T00:00:01.000Z",
      retentionClass: "regulated",
      sensitivityClass: "confidential",
      summary: "Partner-hosted evidence packet",
      external: {
        uri: "https://partner.example.test/evidence/run-1",
        availability: "degraded" as const,
        trustNote: "Partner assertions require independent verification before policy decisions.",
        availabilityNote: "Reads can fail during partner maintenance windows.",
        retentionNote: "Partner retention windows are managed outside Pluto.",
        deletionGuarantee: "none" as const,
        externalVersion: "snapshot-7",
      },
    };

    const validated = validateExternalRefRecordV0(record);
    expect(validated.ok).toBe(true);

    const ref = toStorageRefV0(record);
    const status = toStorageStatusV0(record);

    expect(ref.summary).toBe("Partner-hosted evidence packet");
    expect(ref).not.toHaveProperty("path");
    expect(status.deletionGuarantee).toBe("none");
    expect(status.notes).toEqual([
      "Partner assertions require independent verification before policy decisions.",
      "Reads can fail during partner maintenance windows.",
      "Partner retention windows are managed outside Pluto.",
      "Pluto does not guarantee deletion of externally managed content.",
    ]);
  });
});
