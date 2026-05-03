import { readFile } from "node:fs/promises";
import { isAbsolute, relative, resolve } from "node:path";

import type { TeamRunPlaybookMetadataV0 } from "../../contracts/types.js";
import type { Run, RunProfile } from "../../contracts/four-layer.js";

function interpolatePath(value: string, rootDir: string, runId: string, cwd: string): string {
  return value.replaceAll("${repo_root}", rootDir).replaceAll("${run_id}", runId).replaceAll("${cwd}", cwd);
}

export function materializeRunWorkspace(
  workspace: NonNullable<Run["workspace"]>,
  rootDir: string,
  workspaceDir: string,
  runId: string,
): NonNullable<Run["workspace"]> {
  return {
    cwd: interpolatePath(workspace.cwd, rootDir, runId, workspaceDir),
    ...(workspace.worktree
      ? {
          worktree: {
            branch: interpolatePath(workspace.worktree.branch, rootDir, runId, workspaceDir),
            path: interpolatePath(workspace.worktree.path, rootDir, runId, workspaceDir),
            ...(workspace.worktree.baseRef ? { baseRef: workspace.worktree.baseRef } : {}),
          },
        }
      : {}),
  };
}

export function buildPlaybookMetadata(playbook: { name: string; description?: string }): TeamRunPlaybookMetadataV0 {
  return {
    id: playbook.name,
    title: playbook.description ?? playbook.name,
    schemaVersion: 0,
    orchestrationSource: "teamlead_direct",
  };
}

export async function verifyRequiredReads(
  rootDir: string,
  requiredReads: ReadonlyArray<{ kind: string; path?: string; documentId?: string; optional?: boolean }>,
) {
  for (const entry of requiredReads) {
    if (entry.kind === "repo" && entry.path) {
      const filePath = resolve(rootDir, entry.path);
      const relativePath = relative(rootDir, filePath);
      if (relativePath.startsWith("..") || isAbsolute(relativePath)) {
        throw new Error(`invalid_required_read_path:repo:${entry.path}`);
      }
      await readFile(filePath, "utf8");
      continue;
    }
    if (entry.optional) continue;
    throw new Error(`unsupported_required_read:${entry.kind}:${entry.documentId ?? entry.path ?? "unknown"}`);
  }
}

export function validateRunProfileRuntimeSupport(runProfile: RunProfile | undefined) {
  if (!runProfile) return;
  if (runProfile.approvalGates?.preLaunch?.enabled === true) {
    throw new Error("unsupported_approval_gate:preLaunch.enabled");
  }
  if (runProfile.workspace.worktree) {
    throw new Error("unsupported_worktree_materialization:workspace.worktree");
  }
  const maxActiveChildren = runProfile.concurrency?.maxActiveChildren;
  if (maxActiveChildren !== undefined && maxActiveChildren !== 1) {
    throw new Error(`unsupported_concurrency:maxActiveChildren:${maxActiveChildren}`);
  }
  for (const entry of runProfile.requiredReads ?? []) {
    if (entry.kind !== "repo") {
      throw new Error(`unsupported_required_read:${entry.kind}:${entry.documentId ?? entry.path ?? "unknown"}`);
    }
  }
}
