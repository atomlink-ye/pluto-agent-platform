import { describe, expect, it } from "vitest";

import { RuntimeRegistry, selectEligibleRuntime } from "@/runtime/index.js";
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

const openCodeCapability: RuntimeCapabilityDescriptorV0 = {
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
};

const fakeCapability: RuntimeCapabilityDescriptorV0 = {
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

const openCodeProfile: ProviderProfileV0 = {
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
};

describe("selectEligibleRuntime", () => {
  it("returns the matching runtime and merged profile selection", () => {
    const registry = buildRegistry();

    const result = selectEligibleRuntime(registry, {
      providerProfileId: "opencode-default",
      requirements: {
        tools: { shell: true },
        files: { write: true },
      },
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.candidate.runtime.id).toBe("opencode-live");
    expect(result.effectiveRequirements).toMatchObject({
      providers: ["opencode"],
      runtimeIds: ["opencode-live"],
      tools: { shell: true },
      files: { write: true },
    });
  });

  it("returns a capability blocker when hard requirements cannot be met", () => {
    const registry = buildRegistry();

    const result = selectEligibleRuntime(registry, {
      requirements: {
        tools: { web_fetch: true },
        files: { write: true },
      },
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.blocker.reason).toBe("capability_unavailable");
    expect(result.blocker.mismatchFields).toContain("tools.web_fetch");
    expect(result.blocker.message).toContain("runtime_selector_no_match");
  });

  it("returns a blocker for disabled provider profiles", () => {
    const registry = buildRegistry({ profileEnabled: false });

    const result = selectEligibleRuntime(registry, {
      providerProfileId: "opencode-default",
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.blocker.reason).toBe("provider_unavailable");
    expect(result.blocker.message).toBe("runtime_selector_profile_disabled:opencode-default");
  });

  it("returns a blocker for unhealthy adapters before dispatch", () => {
    const registry = buildRegistry({ adapterHealth: "unhealthy" });

    const result = selectEligibleRuntime(registry, {
      requirements: {
        runtimeIds: ["opencode-live"],
      },
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.blocker.reason).toBe("provider_unavailable");
    expect(result.blocker.message).toBe("runtime_selector_adapter_unreachable:paseo-opencode");
    expect(result.blocker.runtimeIds).toEqual(["opencode-live"]);
  });

  it("fails closed when merged profile and task runtime lists conflict", () => {
    const registry = buildRegistry();

    const result = selectEligibleRuntime(registry, {
      providerProfileId: "opencode-default",
      requirements: {
        runtimeIds: ["fake-local"],
      },
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.blocker.reason).toBe("capability_unavailable");
    expect(result.blocker.message).toBe("runtime_selector_no_match:runtimeId");
    expect(result.blocker.mismatchFields).toEqual(["runtimeId"]);
    expect(result.effectiveRequirements?.runtimeIds).toEqual([]);
  });
});

function buildRegistry(opts: {
  adapterHealth?: "unknown" | "healthy" | "degraded" | "unhealthy";
  profileEnabled?: boolean;
} = {}): RuntimeRegistry {
  const registry = new RuntimeRegistry();
  registry.registerAdapter({ id: "paseo-opencode", factory: noopFactory, state: { health: opts.adapterHealth ?? "healthy" } });
  registry.registerAdapter({ id: "fake", factory: noopFactory });
  registry.registerRuntime({
    id: "opencode-live",
    adapterId: "paseo-opencode",
    capability: openCodeCapability,
  });
  registry.registerRuntime({
    id: "fake-local",
    adapterId: "fake",
    capability: fakeCapability,
  });
  registry.registerProviderProfile({
    profile: openCodeProfile,
    state: { enabled: opts.profileEnabled ?? true },
  });
  return registry;
}
