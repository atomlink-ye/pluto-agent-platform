#!/usr/bin/env node
import process from "node:process";

import {
  ensureLocalWorkspaceBootstrap,
  getLocalWorkspaceBootstrapStatus,
  resetLocalWorkspaceBootstrap,
  resumeLocalWorkspaceBootstrap,
} from "../bootstrap/workspace-bootstrap.js";

function usage(): never {
  console.error(`Usage:
  pnpm bootstrap workspace [--workspace-id <id>] [--principal-id <id>] [--json]
  pnpm bootstrap status [--workspace-id <id>] [--json]
  pnpm bootstrap resume [--workspace-id <id>] [--principal-id <id>] [--json]
  pnpm bootstrap reset-local [--workspace-id <id>] [--json]`);
  process.exit(1);
}

function fail(message: string): never {
  console.error(`Error: ${message}`);
  process.exit(1);
}

function parseArgs(argv: string[]): {
  subcommand: string;
  flags: Record<string, string | boolean>;
} {
  const subcommand = argv[0] ?? "";
  const flags: Record<string, string | boolean> = {};

  for (let index = 1; index < argv.length; index++) {
    const arg = argv[index]!;
    if (!arg.startsWith("--")) {
      fail(`Unexpected argument: ${arg}`);
    }

    const key = arg.slice(2);
    const next = argv[index + 1];
    if (next && !next.startsWith("--")) {
      flags[key] = next;
      index++;
      continue;
    }

    flags[key] = true;
  }

  return { subcommand, flags };
}

function renderText(result: {
  status: string;
  workspaceRef: { id: string } | null;
  principalRef: { principalId: string } | null;
  adminBindingRef: { id: string } | null;
  blocker: { reason: string; reasonCode?: string; resolutionHint: string | null; retryable?: boolean } | null;
  session: { id: string; status: string } | null;
  checklist: { completedStepCount: number; totalStepCount: number } | null;
}): void {
  console.log(`Status: ${result.status}`);
  console.log(`Workspace: ${result.workspaceRef?.id ?? "none"}`);
  console.log(`Principal: ${result.principalRef?.principalId ?? "none"}`);
  console.log(`Admin binding: ${result.adminBindingRef?.id ?? "none"}`);
  console.log(`Session: ${result.session?.id ?? "none"}`);
  console.log(`Session status: ${result.session?.status ?? "none"}`);
  if (result.checklist) {
    console.log(`Checklist: ${result.checklist.completedStepCount}/${result.checklist.totalStepCount}`);
  }
  if (result.blocker) {
    const reason = "reasonCode" in result.blocker && typeof result.blocker.reasonCode === "string"
      ? result.blocker.reasonCode
      : result.blocker.reason;
    console.log(`Blocker: ${reason}`);
    console.log(`Resolution: ${result.blocker.resolutionHint ?? "none"}`);
  }
}

async function main(): Promise<void> {
  const { subcommand, flags } = parseArgs(process.argv.slice(2));
  if (!subcommand) usage();

  const workspaceId = typeof flags["workspace-id"] === "string" ? flags["workspace-id"] : undefined;
  const principalId = typeof flags["principal-id"] === "string" ? flags["principal-id"] : undefined;
  const jsonMode = flags["json"] === true;

  switch (subcommand) {
    case "workspace": {
      const result = await ensureLocalWorkspaceBootstrap({ workspaceId, principalId });
      if (jsonMode) {
        console.log(JSON.stringify(result, null, 2));
        return;
      }
      renderText(result);
      return;
    }
    case "status": {
      const result = await getLocalWorkspaceBootstrapStatus({ workspaceId });
      if (jsonMode) {
        console.log(JSON.stringify(result, null, 2));
        return;
      }
      renderText(result);
      return;
    }
    case "resume": {
      const result = await resumeLocalWorkspaceBootstrap({ workspaceId, principalId });
      if (jsonMode) {
        console.log(JSON.stringify(result, null, 2));
        return;
      }
      renderText(result);
      return;
    }
    case "reset-local": {
      const result = await resetLocalWorkspaceBootstrap({ workspaceId });
      if (jsonMode) {
        console.log(JSON.stringify(result, null, 2));
        return;
      }
      renderText(result);
      return;
    }
    default:
      fail(`Unknown subcommand: ${subcommand}`);
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack : String(error));
  process.exitCode = 1;
});
