#!/usr/bin/env node
import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import process from "node:process";

import { FakeAdapter } from "../adapters/fake/index.js";
import { PaseoOpenCodeAdapter } from "../adapters/paseo-opencode/index.js";
import { runManagerHarness } from "../orchestrator/manager-run-harness.js";

interface CliFlags {
  title: string;
  prompt: string;
  workspace: string;
  adapter: "fake" | "paseo-opencode";
  artifact?: string;
  maxRetries: number;
  requirementsPreset?: "shell-write";
}

function parseFlags(argv: string[]): CliFlags {
  const flags: Partial<CliFlags> = {
    workspace: ".tmp/pluto-cli",
    adapter: "fake",
    maxRetries: 1,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const key = argv[i];
    const value = argv[i + 1];
    switch (key) {
      case "--title":
        flags.title = value;
        i += 1;
        break;
      case "--prompt":
        flags.prompt = value;
        i += 1;
        break;
      case "--workspace":
        flags.workspace = value;
        i += 1;
        break;
      case "--adapter":
        if (value !== "fake" && value !== "paseo-opencode") {
          throw new Error(`unknown_adapter:${value}`);
        }
        flags.adapter = value;
        i += 1;
        break;
      case "--artifact":
        flags.artifact = value;
        i += 1;
        break;
      case "--max-retries":
        flags.maxRetries = parseMaxRetries(value);
        i += 1;
        break;
      case "--requirements-preset":
        flags.requirementsPreset = parseRequirementsPreset(value);
        i += 1;
        break;
      case "--runtime-id":
      case "--profile":
      case "--min-workers":
        i += 1;
        break;
      default:
        if (key?.startsWith("--")) {
          throw new Error(`unknown_flag:${key}`);
        }
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

  if (flags.adapter === "fake" && flags.requirementsPreset === "shell-write") {
    console.error(JSON.stringify({
      runId: null,
      status: "failed",
      blockerReason: "capability_unavailable",
      failure: "runtime_selector_no_match: fake adapter does not satisfy shell-write",
    }));
    process.exitCode = 1;
    return;
  }

  const result = await runManagerHarness({
    rootDir: process.cwd(),
    selection: {
      scenario: "hello-team",
      runProfile: "fake-smoke",
      runtimeTask: flags.prompt,
    },
    workspaceOverride: workspace,
    dataDir: process.env["PLUTO_DATA_DIR"] ?? ".pluto",
    createAdapter: ({ team, workspaceCwd }) => flags.adapter === "fake"
      ? new FakeAdapter({ team })
      : new PaseoOpenCodeAdapter({ workspaceCwd }),
  });

  if (result.run.status !== "succeeded") {
    console.error(JSON.stringify({
      runId: result.run.runId,
      status: "failed",
      blockerReason: result.legacyResult.blockerReason ?? null,
      failure: result.legacyResult.failure?.message ?? "submit failed",
    }));
    process.exitCode = 1;
    return;
  }

  console.log(JSON.stringify({
    runId: result.run.runId,
    status: result.legacyResult.status,
    artifactPath: result.artifactPath,
    eventsPath: `${result.runDir}/events.jsonl`,
    contributions: result.legacyResult.artifact?.contributions.map((contribution) => ({
      roleId: contribution.roleId,
      chars: contribution.output.length,
    })),
  }, null, 2));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack : String(error));
  process.exitCode = 1;
});
