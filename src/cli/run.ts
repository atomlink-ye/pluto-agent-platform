#!/usr/bin/env node
import { resolve } from "node:path";
import process from "node:process";

import { FakeAdapter } from "../adapters/fake/index.js";
import { PaseoOpenCodeAdapter } from "../adapters/paseo-opencode/index.js";
import { runManagerHarness } from "../orchestrator/manager-run-harness.js";

interface CliFlags {
  root: string;
  scenario: string;
  runProfile?: string;
  playbook?: string;
  task?: string;
  workspace?: string;
  adapter: "fake" | "paseo-opencode";
  dataDir?: string;
}

function parseFlags(argv: string[]): CliFlags {
  const flags: Partial<CliFlags> = {
    root: process.cwd(),
    adapter: "fake",
  };

  for (let index = 0; index < argv.length; index += 1) {
    const key = argv[index];
    const value = argv[index + 1];
    switch (key) {
      case "--root":
        flags.root = value;
        index += 1;
        break;
      case "--scenario":
        flags.scenario = value;
        index += 1;
        break;
      case "--run-profile":
        flags.runProfile = value;
        index += 1;
        break;
      case "--playbook":
        flags.playbook = value;
        index += 1;
        break;
      case "--task":
        flags.task = value;
        index += 1;
        break;
      case "--workspace":
        flags.workspace = value;
        index += 1;
        break;
      case "--adapter":
        if (value !== "fake" && value !== "paseo-opencode") {
          throw new Error(`unknown_adapter:${value}`);
        }
        flags.adapter = value;
        index += 1;
        break;
      case "--data-dir":
        flags.dataDir = value;
        index += 1;
        break;
      default:
        if (key?.startsWith("--")) {
          throw new Error(`unknown_flag:${key}`);
        }
    }
  }

  if (!flags.scenario) {
    throw new Error("missing_required_flag: --scenario is required");
  }
  return flags as CliFlags;
}

async function main() {
  const flags = parseFlags(process.argv.slice(2));
  const result = await runManagerHarness({
    rootDir: resolve(flags.root),
    selection: {
      scenario: flags.scenario,
      ...(flags.runProfile ? { runProfile: flags.runProfile } : {}),
      ...(flags.playbook ? { playbook: flags.playbook } : {}),
      ...(flags.task ? { runtimeTask: flags.task } : {}),
    },
    ...(flags.workspace ? { workspaceOverride: resolve(flags.workspace) } : {}),
    ...(flags.dataDir ? { dataDir: flags.dataDir } : {}),
    createAdapter: ({ team, workspaceCwd }) => flags.adapter === "fake"
      ? new FakeAdapter({ team })
      : new PaseoOpenCodeAdapter({ workspaceCwd }),
  });

  console.log(JSON.stringify({
    runId: result.run.runId,
    status: result.run.status,
    scenario: result.run.scenario,
    playbook: result.run.playbook,
    runProfile: result.run.runProfile,
    workspaceDir: result.workspaceDir,
    runDir: result.runDir,
    artifactPath: result.artifactPath,
    evidencePacketPath: result.canonicalEvidencePath,
    evidencePath: result.legacyEvidencePath,
  }, null, 2));

  if (result.run.status !== "succeeded") {
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack : String(error));
  process.exitCode = 1;
});
