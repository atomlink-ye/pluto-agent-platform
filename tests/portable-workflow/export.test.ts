import { describe, expect, it } from "vitest";

import {
  DEFAULT_TEAM,
  DEFAULT_TEAM_ARTIFACT_EXPECTATION_V0,
  DEFAULT_TEAM_LOGICAL_REFS_V0,
  DEFAULT_TEAM_RUNTIME_REQUIREMENTS_V0,
  RESEARCH_REVIEW_PLAYBOOK_ID,
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
            required: [],
            optional: ["PASEO_BIN", "PASEO_HOST", "PASEO_PROVIDER", "PASEO_MODEL", "OPENCODE_BASE_URL"],
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
    expect(json).not.toContain('"reviews"');
    expect(json).not.toContain('"review"');
    expect(json).not.toContain('"approvals"');
    expect(json).not.toContain('"approval"');
    expect(json).not.toContain('"publishPackage"');
    expect(json).not.toContain('"runHistory"');
    expect(json).not.toContain('"sessionId"');
  });

  it("rejects non-default playbook export until portable workflow refs are versioned for it", () => {
    expect(() => exportPortableWorkflowBundle({
      team: {
        ...DEFAULT_TEAM,
        defaultPlaybookId: RESEARCH_REVIEW_PLAYBOOK_ID,
      },
      exportedAt: "2026-04-30T00:00:00.000Z",
    })).toThrow(/portable_workflow_non_default_playbook_export_deferred/);
  });
});
