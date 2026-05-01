import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { PaseoTeamAdapter, PaseoTeamAdapterFactory } from "@/contracts/adapter.js";
import type {
  AgentEvent,
  AgentRoleConfig,
  AgentSession,
  ProviderProfileV0,
  RuntimeCapabilityDescriptorV0,
  TeamConfig,
  TeamTask,
} from "@/contracts/types.js";
import { DEFAULT_TEAM } from "@/orchestrator/team-config.js";
import { RunStore } from "@/orchestrator/run-store.js";
import { TeamRunService } from "@/orchestrator/team-run-service.js";
import { RuntimeRegistry } from "@/runtime/index.js";

let workDir: string;

beforeEach(async () => {
  workDir = await mkdtemp(join(tmpdir(), "pluto-runtime-requirements-"));
});

afterEach(async () => {
  await rm(workDir, { recursive: true, force: true });
});

describe("TeamRunService runtime requirements", () => {
  it("fails closed before adapter start when hard requirements cannot be met", async () => {
    const adapter = new TrackingAdapter();
    const service = new TeamRunService({
      adapter,
      team: DEFAULT_TEAM,
      store: new RunStore({ dataDir: join(workDir, ".pluto") }),
      runtimeRegistry: buildRegistry(),
    });

    const result = await service.run({
      ...buildTask("task-hard-requirement"),
      runtimeRequirements: {
        tools: { shell: true },
        files: { write: true },
        runtimeIds: ["fake-local"],
      },
    });

    expect(result.status).toBe("failed");
    expect(result.blockerReason).toBe("capability_unavailable");
    expect(result.failure?.message).toContain("runtime_selector_no_match");
    expect(adapter.startRunCalls).toBe(0);
    expect(result.events.map((event) => event.type)).toEqual([
      "run_started",
      "coordination_transcript_created",
      "blocker",
      "run_failed",
    ]);
  });

  it("fails closed before adapter start when the selected profile is disabled", async () => {
    const adapter = new TrackingAdapter();
    const service = new TeamRunService({
      adapter,
      team: DEFAULT_TEAM,
      store: new RunStore({ dataDir: join(workDir, ".pluto") }),
      runtimeRegistry: buildRegistry({ profileEnabled: false }),
    });

    const result = await service.run({
      ...buildTask("task-disabled-profile"),
      providerProfileId: "opencode-default",
    });

    expect(result.status).toBe("failed");
    expect(result.blockerReason).toBe("provider_unavailable");
    expect(result.failure?.message).toBe("runtime_selector_profile_disabled:opencode-default");
    expect(adapter.startRunCalls).toBe(0);
  });

  it("fails closed before adapter start when the matching adapter is unreachable", async () => {
    const adapter = new TrackingAdapter();
    const service = new TeamRunService({
      adapter,
      team: DEFAULT_TEAM,
      store: new RunStore({ dataDir: join(workDir, ".pluto") }),
      runtimeRegistry: buildRegistry({ adapterHealth: "unhealthy" }),
    });

    const result = await service.run({
      ...buildTask("task-unreachable-adapter"),
      runtimeRequirements: {
        runtimeIds: ["opencode-live"],
      },
    });

    expect(result.status).toBe("failed");
    expect(result.blockerReason).toBe("provider_unavailable");
    expect(result.failure?.message).toBe(
      "runtime_selector_adapter_unreachable:paseo-opencode",
    );
    expect(adapter.startRunCalls).toBe(0);
  });

  it("fails closed before adapter start when profile and task runtime lists conflict", async () => {
    const adapter = new TrackingAdapter();
    const service = new TeamRunService({
      adapter,
      team: DEFAULT_TEAM,
      store: new RunStore({ dataDir: join(workDir, ".pluto") }),
      runtimeRegistry: buildRegistry(),
    });

    const result = await service.run({
      ...buildTask("task-conflicting-profile-runtime"),
      providerProfileId: "opencode-default",
      runtimeRequirements: {
        runtimeIds: ["fake-local"],
      },
    });

    expect(result.status).toBe("failed");
    expect(result.blockerReason).toBe("capability_unavailable");
    expect(result.failure?.message).toBe("runtime_selector_no_match:runtimeId");
    expect(adapter.startRunCalls).toBe(0);
  });

  it("dispatches through the selected registry adapter instead of the constructor default", async () => {
    const defaultAdapter = new TrackingAdapter();
    const selectedAdapter = new SuccessfulAdapter("selected-runtime");
    const service = new TeamRunService({
      adapter: defaultAdapter,
      team: DEFAULT_TEAM,
      store: new RunStore({ dataDir: join(workDir, ".pluto") }),
      runtimeRegistry: buildRegistry({
        openCodeAdapterFactory: { create: () => selectedAdapter },
      }),
      pumpIntervalMs: 1,
      timeoutMs: 1_000,
    });

    const result = await service.run({
      ...buildTask("task-selected-adapter-dispatch"),
      providerProfileId: "opencode-default",
    });

    expect(result.status).toBe("completed");
    expect(defaultAdapter.startRunCalls).toBe(0);
    expect(selectedAdapter.startRunCalls).toBe(1);
    expect(result.artifact?.markdown).toContain("selected-runtime");
  });
});

class TrackingAdapter implements PaseoTeamAdapter {
  startRunCalls = 0;

  async startRun(_input: { runId: string; task: TeamTask; team: TeamConfig }): Promise<void> {
    this.startRunCalls += 1;
  }

  async createLeadSession(_input: {
    runId: string;
    task: TeamTask;
    role: AgentRoleConfig;
  }): Promise<AgentSession> {
    throw new Error("createLeadSession should not run in these tests");
  }

  async createWorkerSession(_input: {
    runId: string;
    role: AgentRoleConfig;
    instructions: string;
  }): Promise<AgentSession> {
    throw new Error("createWorkerSession should not run in these tests");
  }

  async sendMessage(_input: {
    runId: string;
    sessionId: string;
    message: string;
  }): Promise<void> {
    throw new Error("sendMessage should not run in these tests");
  }

  async readEvents(_input: { runId: string }): Promise<AgentEvent[]> {
    return [];
  }

  async waitForCompletion(_input: { runId: string; timeoutMs: number }): Promise<AgentEvent[]> {
    return [];
  }

  async endRun(_input: { runId: string }): Promise<void> {}
}

class SuccessfulAdapter implements PaseoTeamAdapter {
  startRunCalls = 0;
  private events: AgentEvent[] = [];
  private cursor = 0;
  private runId = "";
  private team!: TeamConfig;

  constructor(private readonly label: string) {}

  async startRun(input: { runId: string; task: TeamTask; team: TeamConfig }): Promise<void> {
    this.startRunCalls += 1;
    this.runId = input.runId;
    this.team = input.team;
  }

  async createLeadSession(input: {
    runId: string;
    task: TeamTask;
    role: AgentRoleConfig;
  }): Promise<AgentSession> {
    this.events.push(
      this.event("lead_started", input.role.id, "lead-session", { provider: this.label }),
      this.event("worker_requested", "planner", "lead-session", {
        targetRole: "planner",
        instructions: `Plan with ${this.label}`,
      }),
      this.event("worker_requested", "generator", "lead-session", {
        targetRole: "generator",
        instructions: `Generate with ${this.label}`,
      }),
      this.event("worker_requested", "evaluator", "lead-session", {
        targetRole: "evaluator",
        instructions: `Evaluate with ${this.label}`,
      }),
    );
    return { sessionId: "lead-session", role: input.role };
  }

  async createWorkerSession(input: {
    runId: string;
    role: AgentRoleConfig;
    instructions: string;
  }): Promise<AgentSession> {
    const sessionId = `${input.role.id}-session`;
    this.events.push(
      this.event("worker_started", input.role.id, sessionId, { instructions: input.instructions }),
      this.event("worker_completed", input.role.id, sessionId, {
        output: `${this.label}:${input.role.id}`,
      }),
    );
    return { sessionId, role: input.role };
  }

  async sendMessage(_input: {
    runId: string;
    sessionId: string;
    message: string;
  }): Promise<void> {
    this.events.push(
      this.event("lead_message", this.team.leadRoleId, "lead-session", {
        kind: "summary",
        markdown: `${this.label}\nplanner\ngenerator\nevaluator`,
      }),
    );
  }

  async readEvents(_input: { runId: string }): Promise<AgentEvent[]> {
    const next = this.events.slice(this.cursor);
    this.cursor = this.events.length;
    return next;
  }

  async waitForCompletion(_input: { runId: string; timeoutMs: number }): Promise<AgentEvent[]> {
    return [];
  }

  async endRun(_input: { runId: string }): Promise<void> {}

  private event(
    type: AgentEvent["type"],
    roleId: AgentEvent["roleId"],
    sessionId: string,
    payload: Record<string, unknown>,
  ): AgentEvent {
    return {
      id: `${type}-${this.events.length}`,
      runId: this.runId,
      ts: new Date().toISOString(),
      type,
      roleId,
      sessionId,
      payload,
    };
  }
}

function buildTask(id: string): TeamTask {
  return {
    id,
    title: `Requirements test ${id}`,
    prompt: "Produce a hello-team markdown artifact.",
    workspacePath: workDir,
    minWorkers: 2,
    orchestrationMode: "lead_marker",
  };
}

function buildRegistry(opts: {
  adapterHealth?: "unknown" | "healthy" | "degraded" | "unhealthy";
  openCodeAdapterFactory?: PaseoTeamAdapterFactory;
  profileEnabled?: boolean;
} = {}): RuntimeRegistry {
  const registry = new RuntimeRegistry();
  registry.registerAdapter({
    id: "paseo-opencode",
    factory: opts.openCodeAdapterFactory ?? { create: () => new TrackingAdapter() },
    state: { health: opts.adapterHealth ?? "healthy" },
  });
  registry.registerAdapter({
    id: "fake",
    factory: { create: () => new TrackingAdapter() },
  });

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
