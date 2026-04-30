import { describe, expect, it } from "vitest";

import type {
  PublishPackageRecordV0,
  VersionRecordV0,
  VersionProvenanceRefsV0,
} from "@/contracts/governance.js";
import {
  toEvidencePacketRefV0,
  toRunRefV0,
  toVersionProvenanceRefsV0,
} from "@/contracts/governance.js";

const baseVersion = {
  schemaVersion: 0 as const,
  kind: "version" as const,
  id: "ver-1",
  workspaceId: "workspace-1",
  documentId: "doc-1",
  createdById: "owner-1",
  label: "v1",
  createdAt: "2026-04-30T00:00:00.000Z",
  updatedAt: "2026-04-30T00:00:01.000Z",
  status: "active",
};

const basePackage = {
  schemaVersion: 0 as const,
  kind: "publish_package" as const,
  id: "pkg-1",
  workspaceId: "workspace-1",
  documentId: "doc-1",
  versionId: "ver-1",
  ownerId: "owner-1",
  targetId: "target-1",
  createdAt: "2026-04-30T00:00:00.000Z",
  updatedAt: "2026-04-30T00:00:01.000Z",
  status: "ready",
};

describe("governance provenance refs", () => {
  it("normalizes legacy done status to governance-facing succeeded", () => {
    expect(toRunRefV0({
      runId: "run-1",
      status: "done",
      blockerReason: null,
      finishedAt: "2026-04-30T00:05:00.000Z",
    })).toEqual({
      runId: "run-1",
      status: "succeeded",
      blockerReason: null,
      finishedAt: "2026-04-30T00:05:00.000Z",
    });
  });

  it("builds version and package projections with ref-only provenance links", () => {
    const rawProvenance = {
      latestRun: {
        runId: "run-1",
        status: "done",
        blockerReason: null,
        finishedAt: "2026-04-30T00:05:00.000Z",
        sessionId: "session-123",
        provider: "paseo",
      },
      latestEvidence: {
        runId: "run-1",
        evidencePath: ".pluto/runs/run-1/evidence.json",
        validation: { outcome: "pass" },
        providerSession: "hidden",
      },
      supportingRuns: [
        {
          runId: "run-0",
          status: "blocked",
          blockerReason: "runtime_timeout",
          finishedAt: "2026-04-29T23:59:00.000Z",
          callbackUrl: "https://internal.invalid/callback",
        },
      ],
    };
    const provenance = toVersionProvenanceRefsV0(rawProvenance);

    const versionProjection: VersionRecordV0 & VersionProvenanceRefsV0 = {
      ...baseVersion,
      ...provenance,
    };
    const packageProjection: PublishPackageRecordV0 & VersionProvenanceRefsV0 = {
      ...basePackage,
      ...provenance,
    };

    expect(versionProjection.latestRun).toEqual({
      runId: "run-1",
      status: "succeeded",
      blockerReason: null,
      finishedAt: "2026-04-30T00:05:00.000Z",
    });
    expect(versionProjection.latestEvidence).toEqual({
      runId: "run-1",
      evidencePath: ".pluto/runs/run-1/evidence.json",
      validationOutcome: "pass",
    });
    expect(versionProjection.supportingRuns).toEqual([
      {
        runId: "run-0",
        status: "blocked",
        blockerReason: "runtime_timeout",
        finishedAt: "2026-04-29T23:59:00.000Z",
      },
    ]);

    expect(packageProjection.latestRun).toEqual(versionProjection.latestRun);
    expect(packageProjection.latestEvidence).toEqual(versionProjection.latestEvidence);
    expect(packageProjection.supportingRuns).toEqual(versionProjection.supportingRuns);
  });

  it("keeps evidence refs to path plus validation outcome only", () => {
    const rawEvidence = {
      runId: "run-2",
      evidencePath: ".pluto/runs/run-2/evidence.json",
      validationOutcome: "fail",
      workspace: "/tmp/workspace",
      workers: [{ sessionId: "session-999" }],
    };

    expect(toEvidencePacketRefV0(rawEvidence)).toEqual({
      runId: "run-2",
      evidencePath: ".pluto/runs/run-2/evidence.json",
      validationOutcome: "fail",
    });
  });
});
