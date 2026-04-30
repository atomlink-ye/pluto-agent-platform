import { describe, expect, it } from "vitest";

import {
  matchRuntimeCapabilities,
  mergeRuntimeRequirements,
  profileToRequirements,
} from "@/runtime/index.js";
import type {
  ProviderProfileV0,
  RuntimeCapabilityDescriptorV0,
} from "@/contracts/types.js";

const liveOpenCodeCapability: RuntimeCapabilityDescriptorV0 = {
  schemaVersion: 0,
  runtimeId: "opencode-live",
  adapterId: "paseo-opencode",
  provider: "opencode",
  model: {
    id: "opencode/minimax-m2.5-free",
    family: "minimax",
    mode: "build",
    contextWindowTokens: 128_000,
    maxOutputTokens: 8_000,
    structuredOutput: false,
  },
  tools: {
    shell: true,
    web_fetch: false,
    search: false,
  },
  files: {
    read: true,
    write: true,
    workspaceRootOnly: true,
  },
  callbacks: {
    followUpMessages: true,
    eventStream: true,
    backgroundSessions: true,
  },
  locality: "remote",
  posture: "workspace_write",
  limits: {
    maxExecutionMs: 180_000,
    maxFilesPerRun: 64,
  },
};

describe("matchRuntimeCapabilities", () => {
  it("accepts a capability when hard requirements are satisfied", () => {
    const result = matchRuntimeCapabilities(liveOpenCodeCapability, {
      providers: ["opencode"],
      model: {
        families: ["minimax"],
        modes: ["build"],
        minContextWindowTokens: 100_000,
      },
      tools: {
        shell: true,
      },
      files: {
        write: true,
      },
      callbacks: {
        followUpMessages: true,
      },
      locality: ["remote", "hybrid"],
      posture: ["workspace_write"],
      limits: {
        minExecutionMs: 60_000,
      },
    });

    expect(result.ok).toBe(true);
    expect(result.mismatches).toEqual([]);
  });

  it("reports every failing hard requirement", () => {
    const result = matchRuntimeCapabilities(liveOpenCodeCapability, {
      providers: ["anthropic"],
      model: {
        families: ["claude"],
        structuredOutput: true,
      },
      tools: {
        web_fetch: true,
      },
      locality: ["local"],
      posture: ["sandboxed"],
      limits: {
        minExecutionMs: 300_000,
      },
    });

    expect(result.ok).toBe(false);
    expect(result.mismatches.map((item) => item.field)).toEqual([
      "provider",
      "locality",
      "posture",
      "model.family",
      "model.structuredOutput",
      "tools.web_fetch",
      "limits.maxExecutionMs",
    ]);
  });

  it("converts provider profile selection into requirements and merges them", () => {
    const profile: ProviderProfileV0 = {
      schemaVersion: 0,
      id: "opencode-default",
      provider: "opencode",
      label: "OpenCode default",
      envRefs: {
        required: ["OPENCODE_BASE_URL"],
      },
      secretRefs: {
        required: ["OPENCODE_API_KEY"],
      },
      selection: {
        runtimeIds: ["opencode-live"],
        modelIds: ["opencode/minimax-m2.5-free"],
        localities: ["remote"],
      },
    };

    const merged = mergeRuntimeRequirements(profileToRequirements(profile), {
      tools: { shell: true },
      files: { write: true },
    });
    const result = matchRuntimeCapabilities(liveOpenCodeCapability, merged);

    expect(merged).toMatchObject({
      providers: ["opencode"],
      runtimeIds: ["opencode-live"],
      model: {
        ids: ["opencode/minimax-m2.5-free"],
      },
      locality: ["remote"],
      tools: { shell: true },
      files: { write: true },
    });
    expect(result.ok).toBe(true);
  });

  it("intersects list-based hard requirements when multiple sources are merged", () => {
    const merged = mergeRuntimeRequirements(
      {
        runtimeIds: ["opencode-live", "fallback-live"],
        providers: ["opencode"],
        model: {
          ids: ["opencode/minimax-m2.5-free", "opencode/other"],
          families: ["minimax", "other"],
        },
        locality: ["remote", "hybrid"],
      },
      {
        runtimeIds: ["opencode-live"],
        providers: ["opencode", "fake"],
        model: {
          ids: ["opencode/minimax-m2.5-free"],
          families: ["minimax"],
        },
        locality: ["remote"],
      },
    );

    expect(merged).toMatchObject({
      runtimeIds: ["opencode-live"],
      providers: ["opencode"],
      model: {
        ids: ["opencode/minimax-m2.5-free"],
        families: ["minimax"],
      },
      locality: ["remote"],
    });
  });
});
