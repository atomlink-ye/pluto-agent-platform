import { describe, expect, it } from "vitest";

import { RuntimeRegistry } from "@/runtime/index.js";
import type {
  PaseoTeamAdapter,
  PaseoTeamAdapterFactory,
  ProviderProfileV0,
  RuntimeCapabilityDescriptorV0,
  TeamConfig,
  TeamTask,
  AgentRoleConfig,
  AgentSession,
  AgentEvent,
} from "@/index.js";

const noopFactory: PaseoTeamAdapterFactory = {
  create(): PaseoTeamAdapter {
    return {
      startRun(_input: { runId: string; task: TeamTask; team: TeamConfig }): Promise<void> {
        return Promise.resolve();
      },
      createLeadSession(_input: {
        runId: string;
        task: TeamTask;
        role: AgentRoleConfig;
      }): Promise<AgentSession> {
        return Promise.resolve({
          sessionId: "noop-lead",
          role: { id: "lead", name: "Lead", kind: "team_lead", systemPrompt: "" },
        });
      },
      createWorkerSession(_input: {
        runId: string;
        role: AgentRoleConfig;
        instructions: string;
      }): Promise<AgentSession> {
        return Promise.resolve({
          sessionId: "noop-worker",
          role: { id: "planner", name: "Planner", kind: "worker", systemPrompt: "" },
        });
      },
      sendMessage(_input: {
        runId: string;
        sessionId: string;
        message: string;
      }): Promise<void> {
        return Promise.resolve();
      },
      readEvents(_input: { runId: string }): Promise<AgentEvent[]> {
        return Promise.resolve([]);
      },
      waitForCompletion(_input: {
        runId: string;
        timeoutMs: number;
      }): Promise<AgentEvent[]> {
        return Promise.resolve([]);
      },
      endRun(_input: { runId: string }): Promise<void> {
        return Promise.resolve();
      },
    };
  },
};

const liveCapability: RuntimeCapabilityDescriptorV0 = {
  schemaVersion: 0,
  runtimeId: "opencode-live",
  adapterId: "paseo-opencode",
  provider: "opencode",
  model: {
    id: "opencode/minimax-m2.5-free",
    family: "minimax",
    mode: "build",
    contextWindowTokens: 128_000,
  },
  tools: {
    shell: true,
  },
  files: {
    read: true,
    write: true,
    workspaceRootOnly: true,
  },
  callbacks: {
    followUpMessages: true,
  },
  locality: "remote",
  posture: "workspace_write",
  limits: {
    maxExecutionMs: 180_000,
  },
};

const localCapability: RuntimeCapabilityDescriptorV0 = {
  schemaVersion: 0,
  runtimeId: "fake-local",
  adapterId: "fake",
  provider: "fake",
  model: {
    id: "fake/test",
    family: "fake",
    mode: "test",
    contextWindowTokens: 4_096,
  },
  tools: {
    shell: false,
  },
  files: {
    read: true,
    write: false,
    workspaceRootOnly: true,
  },
  callbacks: {
    followUpMessages: true,
  },
  locality: "local",
  posture: "sandboxed",
};

describe("RuntimeRegistry", () => {
  it("registers adapters, runtimes, and provider profiles", () => {
    const registry = new RuntimeRegistry();
    const profile: ProviderProfileV0 = {
      schemaVersion: 0,
      id: "opencode-default",
      provider: "opencode",
      label: "OpenCode default",
      envRefs: { required: ["OPENCODE_BASE_URL"] },
      secretRefs: { required: ["OPENCODE_API_KEY"] },
    };

    registry.registerAdapter({ id: "paseo-opencode", factory: noopFactory });
    registry.registerRuntime({
      id: "opencode-live",
      adapterId: "paseo-opencode",
      capability: liveCapability,
      state: { health: "healthy" },
    });
    registry.registerProviderProfile({ profile, state: { health: "degraded" } });

    expect(registry.getAdapter("paseo-opencode")?.state.enabled).toBe(true);
    expect(registry.getRuntime("opencode-live")?.capability.provider).toBe("opencode");
    expect(registry.getProviderProfile("opencode-default")?.profile.secretRefs).toEqual({
      required: ["OPENCODE_API_KEY"],
    });
    expect(registry.listAdapters()).toHaveLength(1);
    expect(registry.listRuntimes()).toHaveLength(1);
    expect(registry.listProviderProfiles()).toHaveLength(1);
  });

  it("filters candidates by hard requirements and profile selection", () => {
    const registry = new RuntimeRegistry();
    registry.registerAdapter({ id: "paseo-opencode", factory: noopFactory });
    registry.registerAdapter({ id: "fake", factory: noopFactory });
    registry.registerRuntime({
      id: "opencode-live",
      adapterId: "paseo-opencode",
      capability: liveCapability,
      state: { health: "unhealthy" },
    });
    registry.registerRuntime({
      id: "fake-local",
      adapterId: "fake",
      capability: localCapability,
    });
    registry.registerProviderProfile({
      profile: {
        schemaVersion: 0,
        id: "opencode-default",
        provider: "opencode",
        label: "OpenCode default",
        envRefs: { required: ["OPENCODE_BASE_URL"] },
        secretRefs: { required: ["OPENCODE_API_KEY"] },
        selection: {
          runtimeIds: ["opencode-live"],
          localities: ["remote"],
        },
      },
    });

    const candidates = registry.findRuntimeCandidates({
      providerProfileId: "opencode-default",
      requirements: {
        tools: { shell: true },
        files: { write: true },
      },
    });

    expect(candidates).toHaveLength(1);
    expect(candidates[0]?.runtime.id).toBe("opencode-live");
    expect(candidates[0]?.runtime.state.health).toBe("unhealthy");
  });

  it("excludes disabled adapters and runtimes unless explicitly included", () => {
    const registry = new RuntimeRegistry();
    registry.registerAdapter({
      id: "paseo-opencode",
      factory: noopFactory,
      state: { enabled: false },
    });
    registry.registerRuntime({
      id: "opencode-live",
      adapterId: "paseo-opencode",
      capability: liveCapability,
    });

    expect(registry.findRuntimeCandidates()).toEqual([]);
    expect(
      registry.findRuntimeCandidates({ includeDisabled: true }).map((item) => item.runtime.id),
    ).toEqual(["opencode-live"]);
  });

  it("returns all enabled runtimes when no requirements are supplied", () => {
    const registry = new RuntimeRegistry();
    registry.registerAdapter({ id: "paseo-opencode", factory: noopFactory });
    registry.registerAdapter({ id: "fake", factory: noopFactory });
    registry.registerRuntime({
      id: "opencode-live",
      adapterId: "paseo-opencode",
      capability: liveCapability,
    });
    registry.registerRuntime({
      id: "fake-local",
      adapterId: "fake",
      capability: localCapability,
    });

    expect(registry.findRuntimeCandidates().map((item) => item.runtime.id)).toEqual([
      "opencode-live",
      "fake-local",
    ]);
  });
});
