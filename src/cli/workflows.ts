#!/usr/bin/env node
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import process from "node:process";

import {
  exportPortableWorkflowBundle,
  formatPortableWorkflowDraftRef,
  importPortableWorkflowBundle,
  PortableWorkflowStore,
} from "../portable-workflow/index.js";

function usage(): never {
  console.error(`Usage:
  pnpm workflows export [--output FILE]
  pnpm workflows import <bundle.json> [--mode draft|fork] [--json]
  pnpm workflows drafts list [--json]
  pnpm workflows drafts show <draftId> [--json]`);
  process.exit(1);
}

function fail(message: string): never {
  console.error(`Error: ${message}`);
  process.exit(1);
}

function parseArgs(argv: string[]): {
  command: string[];
  positional: string[];
  flags: Record<string, string | boolean>;
} {
  const positional: string[] = [];
  const flags: Record<string, string | boolean> = {};
  const command = argv[0] === "drafts" ? argv.slice(0, 2) : argv.slice(0, 1);
  let i = command.length;

  for (; i < argv.length; i++) {
    const arg = argv[i]!;
    if (arg.startsWith("--")) {
      const key = arg.slice(2);
      const next = argv[i + 1];
      if (next && !next.startsWith("--")) {
        flags[key] = next;
        i++;
      } else {
        flags[key] = true;
      }
      continue;
    }
    positional.push(arg);
  }

  return { command, positional, flags };
}

async function main(): Promise<void> {
  const { command, positional, flags } = parseArgs(process.argv.slice(2));
  const dataDir = resolve(process.env["PLUTO_DATA_DIR"] ?? ".pluto");
  const store = new PortableWorkflowStore({ dataDir });
  const jsonMode = flags["json"] === true;

  if (command.length === 0) {
    usage();
  }

  if (command[0] === "export") {
    await handleExport(flags, jsonMode);
    return;
  }

  if (command[0] === "import") {
    await handleImport(store, positional[0], flags, jsonMode);
    return;
  }

  if (command[0] === "drafts" && command[1] === "list") {
    await handleDraftsList(store, jsonMode);
    return;
  }

  if (command[0] === "drafts" && command[1] === "show") {
    await handleDraftsShow(store, positional[0], jsonMode);
    return;
  }

  fail(`Unknown command: ${command.join(" ")}`);
}

async function handleExport(
  flags: Record<string, string | boolean>,
  jsonMode: boolean,
): Promise<void> {
  const bundle = exportPortableWorkflowBundle();
  const outputPath = typeof flags["output"] === "string" ? resolve(flags["output"]) : undefined;

  if (outputPath) {
    await writeFile(outputPath, JSON.stringify(bundle, null, 2) + "\n", "utf8");
    if (jsonMode) {
      console.log(JSON.stringify({ schemaVersion: 0, outputPath }, null, 2));
    } else {
      console.log(outputPath);
    }
    return;
  }

  console.log(JSON.stringify(bundle, null, 2));
}

async function handleImport(
  store: PortableWorkflowStore,
  bundlePathArg: string | undefined,
  flags: Record<string, string | boolean>,
  jsonMode: boolean,
): Promise<void> {
  if (!bundlePathArg) {
    fail("Missing <bundle.json> argument for 'import'");
  }

  const bundlePath = resolve(bundlePathArg);
  const raw = await readFile(bundlePath, "utf8");
  const bundle = JSON.parse(raw) as unknown;
  const mode = typeof flags["mode"] === "string" ? flags["mode"] : undefined;
  if (mode !== undefined && mode !== "draft" && mode !== "fork") {
    fail(`Invalid --mode '${mode}'. Expected draft or fork.`);
  }

  const result = await importPortableWorkflowBundle(
    {
      bundle,
      mode,
      source: { path: bundlePath },
    },
    { store },
  );

  if (jsonMode) {
    console.log(JSON.stringify(result, null, 2));
  } else {
    console.log(`${result.status} ${result.draftId} ${formatPortableWorkflowDraftRef(store, result.draftId)}`);
  }

  if (!result.importable) {
    process.exitCode = 1;
  }
}

async function handleDraftsList(store: PortableWorkflowStore, jsonMode: boolean): Promise<void> {
  const drafts = await store.listDrafts();

  if (jsonMode) {
    console.log(JSON.stringify({ schemaVersion: 0, items: drafts }, null, 2));
    return;
  }

  if (drafts.length === 0) {
    console.log("No workflow drafts found.");
    return;
  }

  console.log(`${"Draft ID".padEnd(42)} ${"Status".padEnd(8)} ${"Mode".padEnd(6)} Workflow`);
  console.log("-".repeat(90));
  for (const draft of drafts) {
    console.log(
      `${draft.draftId.padEnd(42)} ${draft.status.padEnd(8)} ${draft.mode.padEnd(6)} ${draft.workflowName ?? draft.workflowId ?? "(unknown)"}`,
    );
  }
}

async function handleDraftsShow(
  store: PortableWorkflowStore,
  draftId: string | undefined,
  jsonMode: boolean,
): Promise<void> {
  if (!draftId) {
    fail("Missing <draftId> argument for 'drafts show'");
  }

  const draft = await store.readDraft(draftId);
  if (!draft) {
    fail(`Workflow draft not found: ${draftId}`);
  }

  if (jsonMode) {
    console.log(JSON.stringify(draft, null, 2));
    return;
  }

  console.log(`Draft: ${draft.draftId}`);
  console.log(`Status: ${draft.status}`);
  console.log(`Mode: ${draft.mode}`);
  console.log(`Workflow: ${draft.bundle?.manifest.workflowName ?? "(invalid bundle)"}`);
  console.log(`Importable: ${draft.importable ? "yes" : "no"}`);
  console.log(`Conflicts: ${draft.conflicts.length}`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack : String(error));
  process.exitCode = 1;
});
