#!/usr/bin/env node
import { resolve } from "node:path";
import process from "node:process";

import { FakeAdapter } from "../adapters/fake/index.js";
import { PaseoOpenCodeAdapter } from "../adapters/paseo-opencode/index.js";
import { parseKeyValueFlags } from "./shared/flags.js";
import { buildRunSelection } from "./shared/run-selection.js";
import { runManagerHarness } from "../orchestrator/manager-run-harness.js";
import { resolveRuntimeHelperMvpEnabled } from "../orchestrator/runtime-helper.js";

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
  return parseKeyValueFlags<CliFlags>(argv, {
    defaults: {
      root: process.cwd(),
      adapter: "fake",
    },
    flags: {
      "--root": { key: "root" },
      "--scenario": { key: "scenario" },
      "--run-profile": { key: "runProfile" },
      "--playbook": { key: "playbook" },
      "--task": { key: "task" },
      "--workspace": { key: "workspace" },
      "--adapter": {
        key: "adapter",
        parse: (value) => {
          if (value !== "fake" && value !== "paseo-opencode") {
            throw new Error(`unknown_adapter:${value}`);
          }
          return value;
        },
      },
      "--data-dir": { key: "dataDir" },
    },
    required: ["scenario"],
  });
}

async function main() {
  const flags = parseFlags(process.argv.slice(2));
  const workspaceSubdirPerRun = Boolean(flags.workspace)
    && flags.adapter === "paseo-opencode"
    && resolveRuntimeHelperMvpEnabled();
  const result = await runManagerHarness({
    rootDir: resolve(flags.root),
    selection: buildRunSelection(flags),
    ...(flags.workspace ? { workspaceOverride: resolve(flags.workspace) } : {}),
    ...(workspaceSubdirPerRun ? { workspaceSubdirPerRun: true } : {}),
    ...(flags.dataDir ? { dataDir: flags.dataDir } : {}),
    createAdapter: ({ team, workspaceCwd }) => flags.adapter === "fake"
      ? new FakeAdapter({ team })
      : new PaseoOpenCodeAdapter({ workspaceCwd, deleteAgentsOnEnd: false }),
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
    process.exitCode = result.legacyResult.blockerReason === "chat_transport_unavailable" ? 2 : 1;
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack : String(error));
  process.exitCode = 1;
});
