import { describe, expect, it } from "vitest";

import {
  DEFAULT_TEAM,
  DEFAULT_TEAM_ARTIFACT_EXPECTATION_V0,
  DEFAULT_TEAM_LOGICAL_REFS_V0,
  DEFAULT_TEAM_RUNTIME_REQUIREMENTS_V0,
  exportPortableWorkflowBundle,
  type PortableWorkflowBundleV0,
} from "@/index.js";

describe("portable workflow export", () => {
  it("exports a v0 bundle for the current executable surface", () => {
    const bundle: PortableWorkflowBundleV0 = exportPortableWorkflowBundle({
      exportedAt: "2026-04-30T00:00:00.000Z",
    });

    expect(bundle).toEqual({
      schemaVersion: 0,
      manifest: {
        kind: "pluto-portable-workflow",
        schemaVersion: 0,
        exportedAt: "2026-04-30T00:00:00.000Z",
        workflowId: DEFAULT_TEAM.id,
        workflowName: DEFAULT_TEAM.name,
        executableSurface: "team-config",
        logicalRefs: DEFAULT_TEAM_LOGICAL_REFS_V0,
        runtime: {
          requirements: DEFAULT_TEAM_RUNTIME_REQUIREMENTS_V0,
          envRefs: {
            required: ["OPENCODE_BASE_URL"],
            optional: ["PASEO_BIN", "PASEO_PROVIDER"],
          },
          secretRefs: {
            required: ["OPENCODE_API_KEY"],
          },
        },
        artifact: DEFAULT_TEAM_ARTIFACT_EXPECTATION_V0,
      },
      team: DEFAULT_TEAM,
    });
  });

  it("keeps governance and run-history objects out of the bundle", () => {
    const json = JSON.stringify(exportPortableWorkflowBundle({ exportedAt: "2026-04-30T00:00:00.000Z" }));

    expect(json).not.toContain("Document");
    expect(json).not.toContain("Published Workflow");
    expect(json).not.toContain("Review");
    expect(json).not.toContain("Approval");
    expect(json).not.toContain("PublishPackage");
    expect(json).not.toContain("runHistory");
    expect(json).not.toContain("sessionId");
  });
});
