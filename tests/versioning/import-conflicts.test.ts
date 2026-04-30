import { describe, expect, it } from "vitest";
import { detectImportConflicts, type CompatibilityContextV0 } from "@/versioning/index.js";

function createContext(
  overrides: Partial<CompatibilityContextV0> = {},
): CompatibilityContextV0 {
  return {
    operation: "import",
    subject: {
      family: "durable-run",
      version: 0,
      writtenAt: "2026-04-30T00:00:00.000Z",
    },
    against: {
      family: "durable-run",
      version: 0,
      writtenAt: "2026-04-30T00:00:00.000Z",
    },
    ...overrides,
  };
}

describe("detectImportConflicts", () => {
  it.each([
    {
      name: "logical ID collision",
      code: "logical_id_collision",
      context: createContext({
        incoming: { logicalId: "run-123" },
        existing: { logicalId: "run-123" },
      }),
    },
    {
      name: "name collision",
      code: "name_collision",
      context: createContext({
        incoming: { name: "artifact-a" },
        existing: { name: "artifact-a" },
      }),
    },
    {
      name: "unsupported schema",
      code: "unsupported_schema",
      context: createContext({
        supported: {
          schemaFamilies: ["durable-artifact"],
          schemaVersions: [1],
        },
      }),
    },
    {
      name: "missing dependency",
      code: "missing_dependency",
      context: createContext({
        dependencies: [{ id: "worker:planner", resolved: false }],
      }),
    },
    {
      name: "capability unavailable",
      code: "capability_unavailable",
      context: createContext({
        capabilities: {
          required: {
            tools: { shell: true },
          },
          available: [],
        },
      }),
    },
    {
      name: "policy denied",
      code: "policy_denied",
      context: createContext({
        policy: {
          allowed: false,
          reason: "workspace export policy",
        },
      }),
    },
    {
      name: "package version conflict",
      code: "package_version_conflict",
      context: createContext({
        packageVersion: {
          name: "pluto-agent-platform",
          version: "0.1.0-alpha.0",
        },
        againstPackageVersion: {
          name: "pluto-agent-platform",
          version: "0.1.0-alpha.1",
        },
      }),
    },
    {
      name: "ancestry diverged",
      code: "ancestry_diverged",
      context: createContext({
        ancestry: {
          diverged: true,
          commonAncestorVersion: 0,
        },
      }),
    },
    {
      name: "external ref unresolved",
      code: "external_ref_unresolved",
      context: createContext({
        externalRefs: [{ ref: "artifact://missing", resolved: false }],
      }),
    },
  ])("returns $code for $name", ({ code, context }) => {
    const conflicts = detectImportConflicts(context);

    expect(conflicts).toHaveLength(1);
    expect(conflicts[0]?.code).toBe(code);
    expect(conflicts[0]?.incoming).toEqual(context.subject);
    expect(conflicts[0]?.existing).toEqual(context.against);
  });
});
