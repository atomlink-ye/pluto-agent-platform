#!/usr/bin/env node
import { resolve } from "node:path";
import process from "node:process";

import { compileRunPackage } from "../four-layer/index.js";
import { parseKeyValueFlags } from "./shared/flags.js";
import { buildRunSelection } from "./shared/run-selection.js";

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
  return parseKeyValueFlags(argv, {
    defaults: {
      root: process.cwd(),
      runId: "inspect-run",
    },
    flags: {
      "--root": { key: "root" },
      "--scenario": { key: "scenario" },
      "--run-profile": { key: "runProfile" },
      "--playbook": { key: "playbook" },
      "--task": { key: "task" },
      "--workspace": { key: "workspace" },
      "--run-id": { key: "runId" },
    },
    required: ["scenario"],
  });
}

async function main() {
  const flags = parseFlags(process.argv.slice(2));
  const compiled = await compileRunPackage({
    rootDir: resolve(flags.root),
    runId: flags.runId,
    selection: buildRunSelection(flags),
    ...(flags.workspace ? { workspaceOverride: resolve(flags.workspace) } : {}),
  });

  console.log(JSON.stringify(compiled.package, null, 2));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack : String(error));
  process.exitCode = 1;
});
