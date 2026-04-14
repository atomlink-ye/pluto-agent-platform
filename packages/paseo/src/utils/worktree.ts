export interface WorktreeConfig {
  branchName: string;
  worktreePath: string;
}

export interface PaseoWorktreeInfo {
  path: string;
  createdAt: string;
  branchName?: string;
  head?: string;
}

export function validateBranchSlug(value: string): { valid: boolean; error?: string } {
  const trimmed = value.trim();
  if (!trimmed) return { valid: false, error: "Branch slug is required" };
  if (!/^[a-z0-9][a-z0-9/-]*[a-z0-9]$/.test(trimmed) || trimmed.includes("--")) {
    return {
      valid: false,
      error: "Branch slug must use lowercase letters, numbers, slashes, and hyphens",
    };
  }
  return { valid: true };
}

export async function listPaseoWorktrees(): Promise<PaseoWorktreeInfo[]> {
  return [];
}

export async function deletePaseoWorktree(): Promise<void> {
  return;
}
