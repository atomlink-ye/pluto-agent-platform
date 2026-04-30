#!/usr/bin/env node
/**
 * Minimal CLI entry: submit a team task and print the resulting artifact path.
 *
 * Usage:
 *   pnpm submit \
 *     --title "Hello team" \
 *     --prompt "Produce a hello-team artifact" \
 *     [--workspace .tmp/pluto-cli] \
 *     [--adapter fake|paseo-opencode]
 *
 * The default adapter is `fake` so the CLI runs offline. The live adapter
 * requires the runtime preconditions described in
 * `.paseo-pluto-mvp/root/integration-plan.md`.
 */
import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import process from "node:process";

import { FakeAdapter } from "../adapters/fake/index.js";
import { PaseoOpenCodeAdapter } from "../adapters/paseo-opencode/index.js";
import type { PaseoTeamAdapter } from "../contracts/adapter.js";
import { DEFAULT_TEAM, RunStore, TeamRunService } from "../orchestrator/index.js";
import { RuntimeRegistry } from "../runtime/index.js";
import type { RuntimeCapabilityDescriptorV0, RuntimeRequirementsV0, TeamTask } from "../contracts/types.js";

interface CliFlags {
  title: string;
  prompt: string;
  workspace: string;
  adapter: "fake" | "paseo-opencode";
  artifact?: string;
  minWorkers: number;
  maxRetries: number;
  runtimeId?: string;
  providerProfileId?: string;
  requirementsPreset?: "shell-write";
}

function parseFlags(argv: string[]): CliFlags {
  const flags: Partial<CliFlags> = {
    workspace: ".tmp/pluto-cli",
    adapter: "fake",
    minWorkers: 2,
    maxRetries: 1,
  };
  for (let i = 0; i < argv.length; i++) {
    const k = argv[i];
    const v = argv[i + 1];
    switch (k) {
      case "--title":
        flags.title = v;
        i++;
        break;
      case "--prompt":
        flags.prompt = v;
        i++;
        break;
      case "--workspace":
        flags.workspace = v;
        i++;
        break;
      case "--adapter":
        if (v !== "fake" && v !== "paseo-opencode") {
          throw new Error(`unknown_adapter:${v}`);
        }
        flags.adapter = v;
        i++;
        break;
      case "--artifact":
        flags.artifact = v;
        i++;
        break;
      case "--min-workers":
        flags.minWorkers = Number(v);
        i++;
        break;
      case "--max-retries":
        flags.maxRetries = parseMaxRetries(v);
        i++;
        break;
      case "--runtime-id":
        flags.runtimeId = v;
        i++;
        break;
      case "--profile":
        flags.providerProfileId = v;
        i++;
        break;
      case "--requirements-preset":
        flags.requirementsPreset = parseRequirementsPreset(v);
        i++;
        break;
      default:
        if (k && k.startsWith("--")) throw new Error(`unknown_flag:${k}`);
    }
  }
  if (!flags.title || !flags.prompt) {
    throw new Error("missing_required_flag: --title and --prompt are required");
  }
  return flags as CliFlags;
}

function parseMaxRetries(value: string | undefined): number {
  if (value === undefined || !/^\d+$/.test(value)) {
    throw new Error("invalid_max_retries: --max-retries must be an integer from 0 to 3");
  }
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 0 || parsed > 3) {
    throw new Error("invalid_max_retries: --max-retries must be an integer from 0 to 3");
  }
  return parsed;
}

function parseRequirementsPreset(value: string | undefined): "shell-write" {
  if (value === "shell-write") {
    return value;
  }
  throw new Error("invalid_requirements_preset: supported values: shell-write");
}

async function main() {
  const flags = parseFlags(process.argv.slice(2));
  const workspace = resolve(flags.workspace);
  await mkdir(workspace, { recursive: true });

  let adapter: PaseoTeamAdapter;
  if (flags.adapter === "fake") {
    adapter = new FakeAdapter({ team: DEFAULT_TEAM });
  } else {
    adapter = new PaseoOpenCodeAdapter({ workspaceCwd: workspace });
  }

  const runtimeRequirements = buildRuntimeRequirements(flags);
  const runtimeRegistry = runtimeRequirements || flags.providerProfileId
    ? buildRuntimeRegistry(workspace, flags.adapter)
    : undefined;

  const store = new RunStore({
    dataDir: process.env["PLUTO_DATA_DIR"] ?? ".pluto",
  });
  const service = new TeamRunService({
    adapter,
    team: DEFAULT_TEAM,
    store,
    runtimeRegistry,
    timeoutMs: 10 * 60 * 1000,
    pumpIntervalMs: 50,
    maxRetries: flags.maxRetries,
  });

  const task: TeamTask = {
    id: `cli-${Date.now()}`,
    title: flags.title,
    prompt: flags.prompt,
    workspacePath: workspace,
    minWorkers: flags.minWorkers,
    ...(flags.artifact ? { artifactPath: flags.artifact } : {}),
    ...(runtimeRequirements ? { runtimeRequirements } : {}),
    ...(flags.providerProfileId ? { providerProfileId: flags.providerProfileId } : {}),
  };

  const result = await service.run(task);
  if (result.status === "failed") {
    console.error(JSON.stringify({
      runId: result.runId,
      status: "failed",
      blockerReason: result.blockerReason ?? null,
      failure: result.failure?.message,
    }));
    process.exitCode = 1;
    return;
  }
  console.log(
    JSON.stringify(
      {
        runId: result.runId,
        status: result.status,
        artifactPath: `${store.runDir(result.runId)}/artifact.md`,
        eventsPath: `${store.runDir(result.runId)}/events.jsonl`,
        contributions: result.artifact?.contributions.map((c) => ({
          roleId: c.roleId,
          chars: c.output.length,
        })),
      },
      null,
      2,
    ),
  );
}

function buildRuntimeRequirements(flags: CliFlags): RuntimeRequirementsV0 | undefined {
  if (!flags.runtimeId && !flags.requirementsPreset) {
    return undefined;
  }

  const requirements: RuntimeRequirementsV0 = {};

  if (flags.runtimeId) {
    requirements.runtimeIds = [flags.runtimeId];
  }

  if (flags.requirementsPreset === "shell-write") {
    requirements.tools = { shell: true };
    requirements.files = { write: true };
  }

  return requirements;
}

function buildRuntimeRegistry(
  workspace: string,
  adapterId: CliFlags["adapter"],
): RuntimeRegistry {
  const registry = new RuntimeRegistry();
  if (adapterId === "fake") {
    registry.registerAdapter({
      id: "fake",
      factory: {
        create: () => new FakeAdapter({ team: DEFAULT_TEAM }),
      },
    });
    registry.registerRuntime({
      id: "fake-local",
      adapterId: "fake",
      capability: fakeCapability,
    });
    return registry;
  }

  registry.registerAdapter({
    id: "paseo-opencode",
    factory: {
      create: () => new PaseoOpenCodeAdapter({ workspaceCwd: workspace }),
    },
  });
  registry.registerRuntime({
    id: "opencode-live",
    adapterId: "paseo-opencode",
    capability: openCodeCapability,
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
        adapterIds: ["paseo-opencode"],
        localities: ["remote"],
      },
    },
  });
  return registry;
}

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
  limits: {
    maxExecutionMs: 180_000,
  },
};

main().catch((err) => {
  console.error(err instanceof Error ? err.stack : String(err));
  process.exitCode = 1;
});
