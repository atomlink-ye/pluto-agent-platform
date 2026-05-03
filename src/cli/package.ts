#!/usr/bin/env node
import { resolve } from "node:path";
import process from "node:process";

import { compileRunPackage } from "../four-layer/index.js";

interface CliFlags {
  root: string;
  scenario: string;
  runProfile?: string;
  playbook?: string;
  task?: string;
  workspace?: string;
  runId: string;
}

function parseFlags(argv: string[]): CliFlags {
  const flags: Partial<CliFlags> = {
    root: process.cwd(),
    runId: "inspect-run",
  };

  for (let index = 0; index < argv.length; index += 1) {
    const key = argv[index];
    const value = argv[index + 1];
    switch (key) {
      case "--":
        break;
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
      case "--run-id":
        flags.runId = value;
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
  const compiled = await compileRunPackage({
    rootDir: resolve(flags.root),
    runId: flags.runId,
    selection: {
      scenario: flags.scenario,
      ...(flags.runProfile ? { runProfile: flags.runProfile } : {}),
      ...(flags.playbook ? { playbook: flags.playbook } : {}),
      ...(flags.task ? { runtimeTask: flags.task } : {}),
    },
    ...(flags.workspace ? { workspaceOverride: resolve(flags.workspace) } : {}),
  });

  console.log(JSON.stringify(compiled.package, null, 2));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack : String(error));
  process.exitCode = 1;
});
