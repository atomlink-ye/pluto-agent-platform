import { describe, expect, it } from "vitest";

import { toStorageRefV0, toStorageStatusV0 } from "@/contracts/storage.js";

describe("storage public surfaces", () => {
  it("does not expose provider or private storage paths in refs and summaries", () => {
    const record = {
      schemaVersion: 0 as const,
      storageVersion: "local-v0" as const,
      kind: "content_blob" as const,
      id: "blob-1",
      workspaceId: "workspace-1",
      objectType: "artifact-markdown",
      status: "active",
      actorRefs: [{ actorId: "generator", actorType: "service" as const }],
      createdAt: "2026-04-30T00:00:00.000Z",
      updatedAt: "2026-04-30T00:00:01.000Z",
      retentionClass: "session",
      sensitivityClass: "internal",
      summary: "Generated markdown artifact",
      content: {
        mediaType: "text/markdown",
        contentLengthBytes: 256,
        checksum: { algorithm: "sha256" as const, digest: "blob-checksum" },
        contentRef: "artifact-md-1",
      },
    };

    const ref = toStorageRefV0(record);
    const status = toStorageStatusV0(record);
    const serialized = JSON.stringify({ ref, status });

    expect(serialized).not.toContain(".pluto");
    expect(serialized).not.toContain("storage/content_blob");
    expect(serialized).not.toContain("providerPath");
    expect(serialized).not.toContain("privatePath");
    expect(ref).toEqual({
      schema: "pluto.storage.ref",
      schemaVersion: 0,
      storageVersion: "local-v0",
      kind: "content_blob",
      recordId: "blob-1",
      workspaceId: "workspace-1",
      objectType: "artifact-markdown",
      status: "active",
      summary: "Generated markdown artifact",
      checksum: { algorithm: "sha256", digest: "blob-checksum" },
    });
  });
});
