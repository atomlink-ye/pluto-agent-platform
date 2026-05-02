import { readFile } from "node:fs/promises";
import { isAbsolute, relative, resolve } from "node:path";

import type {
  ArtifactContract,
  ArtifactContractFileRequirement,
  RunProfile,
  StdoutContract,
} from "../contracts/four-layer.js";

export type AcceptanceIssueCode =
  | "missing_required_file"
  | "invalid_required_file"
  | "unreadable_required_file"
  | "missing_required_section"
  | "missing_stdout_line"
  | "invalid_stdout_pattern";

export interface AcceptanceIssue {
  code: AcceptanceIssueCode;
  message: string;
  path?: string;
  section?: string;
  requirement?: string;
}

export interface AcceptanceCheckResult {
  ok: boolean;
  issues: AcceptanceIssue[];
}

export interface AcceptanceRunnerInput {
  artifactRootDir: string;
  stdout: string;
  runProfile: Pick<RunProfile, "artifactContract" | "stdoutContract">;
}

export async function runAcceptanceChecks(input: AcceptanceRunnerInput): Promise<AcceptanceCheckResult> {
  const issues: AcceptanceIssue[] = [];
  issues.push(...await validateArtifactContract(input.runProfile.artifactContract, input.artifactRootDir));
  issues.push(...validateStdoutContract(input.runProfile.stdoutContract, input.stdout));
  return { ok: issues.length === 0, issues };
}

export async function validateArtifactContract(
  contract: ArtifactContract | undefined,
  artifactRootDir: string,
): Promise<AcceptanceIssue[]> {
  if (!contract?.requiredFiles?.length) {
    return [];
  }

  const issues: AcceptanceIssue[] = [];
  for (const requirement of contract.requiredFiles) {
    const resolved = resolveArtifactRequirementPath(artifactRootDir, requirement);
    if (!resolved.ok) {
      issues.push(resolved.issue);
      continue;
    }
    const fileContent = await readRequiredFile(resolved.path);
    if (!fileContent.ok) {
      issues.push(fileContent.issue);
      continue;
    }

    const requiredSections = typeof requirement === "string" ? [] : requirement.requiredSections ?? [];
    issues.push(...validateRequiredSections(fileContent.content, requiredSections, resolved.path));
  }

  return issues;
}

export function validateStdoutContract(
  contract: StdoutContract | undefined,
  stdout: string,
): AcceptanceIssue[] {
  if (!contract?.requiredLines?.length) {
    return [];
  }

  const issues: AcceptanceIssue[] = [];
  for (const requirement of contract.requiredLines) {
    if (typeof requirement === "string") {
      if (!stdout.includes(requirement)) {
        issues.push({
          code: "missing_stdout_line",
          message: `stdout missing required line: ${requirement}`,
          requirement,
        });
      }
      continue;
    }

    try {
      const pattern = new RegExp(requirement.pattern, requirement.flags);
      if (!pattern.test(stdout)) {
        issues.push({
          code: "missing_stdout_line",
          message: `stdout missing required pattern: /${requirement.pattern}/${requirement.flags ?? ""}`,
          requirement: requirement.pattern,
        });
      }
    } catch (error) {
      issues.push({
        code: "invalid_stdout_pattern",
        message: `invalid stdout pattern /${requirement.pattern}/${requirement.flags ?? ""}: ${error instanceof Error ? error.message : String(error)}`,
        requirement: requirement.pattern,
      });
    }
  }

  return issues;
}

export function resolveArtifactRequirementPath(
  artifactRootDir: string,
  requirement: string | ArtifactContractFileRequirement,
): { ok: true; path: string } | { ok: false; issue: AcceptanceIssue } {
  const path = typeof requirement === "string" ? requirement : requirement.path;
  const root = resolve(artifactRootDir);
  const candidate = isAbsolute(path) ? resolve(path) : resolve(root, path);
  const relativePath = relative(root, candidate);
  if (relativePath.startsWith("..") || isAbsolute(relativePath)) {
    return {
      ok: false,
      issue: {
        code: "invalid_required_file",
        message: `required artifact path escapes artifact root: ${path}`,
        path: candidate,
      },
    };
  }
  return { ok: true, path: candidate };
}

export function validateRequiredSections(
  fileContent: string,
  requiredSections: string[],
  resolvedPath: string,
): AcceptanceIssue[] {
  if (requiredSections.length === 0) {
    return [];
  }

  const presentSections = new Set(listMarkdownSections(fileContent).map(normalizeSectionName));
  return requiredSections.flatMap((section) => {
    if (presentSections.has(normalizeSectionName(section))) {
      return [];
    }
    return [{
      code: "missing_required_section" as const,
      message: `required section missing in ${resolvedPath}: ${section}`,
      path: resolvedPath,
      section,
    }];
  });
}

export function listMarkdownSections(fileContent: string): string[] {
  return fileContent
    .split(/\r?\n/)
    .map((line) => line.match(/^#{1,6}\s+(.+?)\s*$/)?.[1])
    .filter((heading): heading is string => Boolean(heading));
}

function normalizeSectionName(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

async function readRequiredFile(
  filePath: string,
): Promise<{ ok: true; content: string } | { ok: false; issue: AcceptanceIssue }> {
  try {
    return { ok: true, content: await readFile(filePath, "utf8") };
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === "ENOENT" || code === "EISDIR") {
      return {
        ok: false,
        issue: {
          code: "missing_required_file",
          message: `required artifact file missing: ${filePath}`,
          path: filePath,
        },
      };
    }
    return {
      ok: false,
      issue: {
        code: "unreadable_required_file",
        message: `required artifact file unreadable: ${filePath} (${error instanceof Error ? error.message : String(error)})`,
        path: filePath,
      },
    };
  }
}
