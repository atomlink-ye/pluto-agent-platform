import { describe, expect, it } from "vitest";

import {
  canShortenRetentionV0,
  evaluateRetentionForDeletionV0,
  normalizeRetentionClassForBehaviorV0,
} from "@/storage/retention.js";

const targetRef = {
  schema: "pluto.storage.ref" as const,
  schemaVersion: 0 as const,
  storageVersion: "local-v0" as const,
  kind: "metadata" as const,
  recordId: "meta-1",
  workspaceId: "workspace-1",
  objectType: "document-version",
  status: "active",
  summary: "Governed record",
};

describe("retention behavior", () => {
  it("maps the new retention classes into deletion-safe rules", () => {
    expect(normalizeRetentionClassForBehaviorV0("short_lived")).toMatchObject({
      canDeleteWithoutTombstone: true,
      requiresTombstone: false,
    });
    expect(normalizeRetentionClassForBehaviorV0("governed_record")).toMatchObject({
      canDeleteWithoutTombstone: false,
      requiresTombstone: true,
    });
    expect(normalizeRetentionClassForBehaviorV0("audit_record")).toMatchObject({
      requiresTombstone: true,
      blocksRetentionShortening: true,
    });
  });

  it("treats unknown future classes conservatively and does not weaken deletion rules", () => {
    const evaluated = evaluateRetentionForDeletionV0({
      retentionClass: "future_enterprise_archive",
      targetRef,
      now: "2026-05-01T00:00:00.000Z",
      policies: [
        {
          schemaVersion: 0,
          storageVersion: "local-v0",
          kind: "retention_policy",
          id: "retention-1",
          workspaceId: "workspace-1",
          objectType: "document-version",
          status: "active",
          actorRefs: [{ actorId: "user-1", actorType: "user" }],
          createdAt: "2026-04-30T00:00:00.000Z",
          updatedAt: "2026-04-30T00:00:01.000Z",
          retentionClass: "audit_record",
          sensitivityClass: "internal",
          summary: "Keep until review completes",
          appliesTo: [targetRef],
          mode: "retain-until",
          retainUntil: "2026-06-01T00:00:00.000Z",
          note: "Future-safe retention window",
        },
      ],
    });

    expect(evaluated.rule.normalizedClass).toBe("future_strict");
    expect(evaluated.rule.requiresTombstone).toBe(true);
    expect(evaluated.blockingReasons).toContain("retain_until_active");
  });

  it("blocks retention shortening under legal hold or when the current class is stricter", () => {
    const hold = {
      schemaVersion: 0 as const,
      storageVersion: "local-v0" as const,
      kind: "legal_hold_overlay" as const,
      id: "hold-1",
      workspaceId: "workspace-1",
      objectType: "document-version",
      status: "held" as const,
      actorRefs: [{ actorId: "legal-1", actorType: "service" as const }],
      createdAt: "2026-04-30T00:00:00.000Z",
      updatedAt: "2026-04-30T00:00:01.000Z",
      retentionClass: "audit_record" as const,
      sensitivityClass: "internal" as const,
      summary: "Investigation hold",
      holdId: "hold-1",
      targetRefs: [targetRef],
      activatedAt: "2026-04-30T00:00:00.000Z",
      releasedAt: null,
      note: "Preserve until investigation closes",
    };

    expect(
      canShortenRetentionV0({
        currentClass: "governed_record",
        nextClass: "short_lived",
        targetRef,
      }),
    ).toEqual({ allowed: false, reason: "retention_weakening_blocked" });

    expect(
      canShortenRetentionV0({
        currentClass: "audit_record",
        nextClass: "governed_record",
        targetRef,
        holds: [hold],
        now: "2026-05-01T00:00:00.000Z",
      }),
    ).toEqual({ allowed: false, reason: "legal_hold_active" });
  });
});
