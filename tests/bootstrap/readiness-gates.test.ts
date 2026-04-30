import { describe, expect, it } from "vitest";

import type { ProviderProfileV0, RuntimeCapabilityDescriptorV0 } from "@/contracts/types.js";
import { evaluateBootstrapReadinessV0 } from "@/bootstrap/readiness-gates.js";
import { RuntimeRegistry } from "@/runtime/index.js";

describe("bootstrap readiness gates", () => {
  it("allows dispatch only when local-v0 policy, budget, runtime, and secret requirements are ready", () => {
    const result = evaluateBootstrapReadinessV0({
      workspaceId: "workspace-1",
      sessionId: "bootstrap-session-1",
      runtimeRegistry: buildRegistry(),
      providerProfileId: "opencode-default",
      env: { OPENCODE_BASE_URL: "https://opencode.example.test" },
      secretRefs: [
        {
          schemaVersion: 0,
          kind: "secret_ref",
          workspaceId: "workspace-1",
          name: "OPENCODE_API_KEY",
          ref: "opencode://secrets/OPENCODE_API_KEY",
          displayLabel: "OpenCode API key",
          status: "active",
          createdAt: "2026-04-30T00:00:00.000Z",
          updatedAt: "2026-04-30T00:00:00.000Z",
          actorRefs: [],
        },
      ],
      policy: { storageVersion: "local-v0", state: "ready" },
      budget: { storageVersion: "local-v0", state: "ready" },
      now: "2026-04-30T00:00:00.000Z",
    });

    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    expect(result.runtimeSelection?.candidate.runtime.id).toBe("opencode-live");
    expect(result.requiredEnvNames).toEqual(["OPENCODE_BASE_URL"]);
    expect(result.requiredSecretNames).toEqual(["OPENCODE_API_KEY"]);
  });

  it("maps missing env names and secret refs to secret_ref_missing", () => {
    const result = evaluateBootstrapReadinessV0({
      workspaceId: "workspace-1",
      sessionId: "bootstrap-session-1",
      runtimeRegistry: buildRegistry(),
      providerProfileId: "opencode-default",
      env: {},
      secretRefs: [],
      policy: { storageVersion: "local-v0", state: "ready" },
      budget: { storageVersion: "local-v0", state: "ready" },
      now: "2026-04-30T00:00:00.000Z",
    });

    expect(result.ok).toBe(false);
    if (result.ok) {
      return;
    }
    expect(result.failure.blockingReason).toBe("secret_ref_missing");
    expect(result.nextAction).toContain("Create local-v0 SecretRef records for OPENCODE_API_KEY");
    expect(result.failure.resolutionHint).toContain("env OPENCODE_BASE_URL");
    expect(result.failure.resolutionHint).toContain("secret ref OPENCODE_API_KEY");
  });

  it("maps unreachable adapters to runtime_unavailable", () => {
    const result = evaluateBootstrapReadinessV0({
      workspaceId: "workspace-1",
      sessionId: "bootstrap-session-1",
      runtimeRegistry: buildRegistry({ adapterHealth: "unhealthy" }),
      providerProfileId: "opencode-default",
      env: { OPENCODE_BASE_URL: "https://opencode.example.test" },
      secretRefs: [secretRef()],
      policy: { storageVersion: "local-v0", state: "ready" },
      budget: { storageVersion: "local-v0", state: "ready" },
      now: "2026-04-30T00:00:00.000Z",
    });

    expect(result.ok).toBe(false);
    if (result.ok) {
      return;
    }
    expect(result.failure.blockingReason).toBe("runtime_unavailable");
    expect(result.failure.resolutionHint).toContain("runtime_selector_adapter_unreachable:paseo-opencode");
  });

  it("maps capability mismatches to capability_unsupported", () => {
    const result = evaluateBootstrapReadinessV0({
      workspaceId: "workspace-1",
      sessionId: "bootstrap-session-1",
      runtimeRegistry: buildRegistry(),
      runtimeRequirements: {
        runtimeIds: ["fake-local"],
        tools: { shell: true },
      },
      policy: { storageVersion: "local-v0", state: "ready" },
      budget: { storageVersion: "local-v0", state: "ready" },
      now: "2026-04-30T00:00:00.000Z",
    });

    expect(result.ok).toBe(false);
    if (result.ok) {
      return;
    }
    expect(result.failure.blockingReason).toBe("capability_unsupported");
    expect(result.failure.resolutionHint).toContain("runtime_selector_no_match");
  });
});

function buildRegistry(opts: {
  adapterHealth?: "unknown" | "healthy" | "degraded" | "unhealthy";
} = {}): RuntimeRegistry {
  const registry = new RuntimeRegistry();
  registry.registerAdapter({
    id: "paseo-opencode",
    factory: { create: () => { throw new Error("not used in readiness tests"); } },
    state: { health: opts.adapterHealth ?? "healthy" },
  });
  registry.registerAdapter({
    id: "fake",
    factory: { create: () => { throw new Error("not used in readiness tests"); } },
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
  registry.registerProviderProfile({ profile: openCodeProfile });
  return registry;
}

const openCodeProfile: ProviderProfileV0 = {
  schemaVersion: 0,
  id: "opencode-default",
  provider: "opencode",
  label: "OpenCode default",
  envRefs: { required: ["OPENCODE_BASE_URL"] },
  secretRefs: { required: ["OPENCODE_API_KEY"] },
  selection: {
    runtimeIds: ["opencode-live"],
    adapterIds: ["paseo-opencode"],
    localities: ["remote"],
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
  tools: { shell: true },
  files: { read: true, write: true, workspaceRootOnly: true },
  callbacks: { followUpMessages: true },
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
  tools: { shell: false },
  files: { read: true, write: false, workspaceRootOnly: true },
  callbacks: { followUpMessages: true },
  locality: "local",
  posture: "sandboxed",
};

function secretRef() {
  return {
    schemaVersion: 0 as const,
    kind: "secret_ref" as const,
    workspaceId: "workspace-1",
    name: "OPENCODE_API_KEY",
    ref: "opencode://secrets/OPENCODE_API_KEY",
    displayLabel: "OpenCode API key",
    status: "active",
    createdAt: "2026-04-30T00:00:00.000Z",
    updatedAt: "2026-04-30T00:00:00.000Z",
    actorRefs: [],
  };
}
