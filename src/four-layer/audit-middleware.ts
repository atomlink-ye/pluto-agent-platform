import { readFile } from "node:fs/promises";

import type { Playbook, RunProfile } from "../contracts/four-layer.js";
import {
  resolveArtifactRequirementPath,
  runAcceptanceChecks,
  validateRequiredSections,
} from "./acceptance-runner.js";

export type AuditIssueCode =
  | "missing_stage_transitions"
  | "missing_required_role"
  | "missing_revision_count"
  | "revision_cap_breached"
  | "missing_final_report"
  | "invalid_required_file"
  | "unreadable_required_file"
  | "missing_required_section"
  | "missing_required_file"
  | "missing_stdout_line"
  | "invalid_stdout_pattern";

export interface AuditStageTransition {
  from: string;
  to: string;
  observedAt?: string;
}

export interface AuditIssue {
  code: AuditIssueCode;
  message: string;
  path?: string;
  role?: string;
  section?: string;
  requirement?: string;
}

export interface AuditMiddlewareInput {
  artifactRootDir: string;
  stdout: string;
  playbook: Pick<Playbook, "audit">;
  runProfile: Pick<RunProfile, "artifactContract" | "stdoutContract">;
  stageTransitions?: AuditStageTransition[];
  stageTransitionSource?: "observed_event_stream" | "synthesized_routing";
  revisionCount?: number;
  finalReportPath?: string;
}

export interface AuditMiddlewareResult {
  ok: boolean;
  status: "succeeded" | "failed_audit";
  issues: AuditIssue[];
}

export async function runAuditMiddleware(input: AuditMiddlewareInput): Promise<AuditMiddlewareResult> {
  const acceptance = await runAcceptanceChecks({
    artifactRootDir: input.artifactRootDir,
    stdout: input.stdout,
    runProfile: input.runProfile,
  });
  const issues: AuditIssue[] = [...acceptance.issues];
  const audit = input.playbook.audit;

  if (audit?.requiredRoles?.length) {
    const transitions = input.stageTransitions;
    if (!transitions?.length) {
      const transitionLabel = input.stageTransitionSource === "synthesized_routing"
        ? "synthesized routing transitions"
        : "observed stage transitions";
      issues.push({
        code: "missing_stage_transitions",
        message: `stage coverage cannot be verified without ${transitionLabel}`,
      });
    } else {
      const observedRoles = new Set(
        transitions.flatMap((transition) => [transition.from, transition.to]).map(normalizeRoleName),
      );
      for (const role of audit.requiredRoles) {
        if (!observedRoles.has(normalizeRoleName(role))) {
          issues.push({
            code: "missing_required_role",
            message: `required role missing from stage coverage: ${role}`,
            role,
          });
        }
      }
    }
  }

  if (audit?.maxRevisionCycles !== undefined) {
    const revisionCount = input.revisionCount;
    if (typeof revisionCount !== "number" || !Number.isInteger(revisionCount) || revisionCount < 0) {
      issues.push({
        code: "missing_revision_count",
        message: "revision-cap enforcement requires a non-negative revisionCount observation",
      });
    } else if (revisionCount > audit.maxRevisionCycles) {
      issues.push({
        code: "revision_cap_breached",
        message: `revision cap breached: observed ${revisionCount}, allowed ${audit.maxRevisionCycles}`,
      });
    }
  }

  if (audit?.finalReportSections?.length) {
    const finalReportResolution = resolveFinalReportPath(input);
    if (!finalReportResolution.ok) {
      if (finalReportResolution.issue) {
        issues.push(finalReportResolution.issue);
      }
      issues.push({
        code: "missing_final_report",
        message: "final report sections cannot be verified without a final report artifact path",
      });
    } else {
      issues.push(...await validateFinalReportSections(finalReportResolution.path, audit.finalReportSections));
      if (audit.requiredRoles?.length) {
        issues.push(...await validateRequiredRoleCitations(finalReportResolution.path, audit.requiredRoles));
      }
    }
  }

  return {
    ok: issues.length === 0,
    status: issues.length === 0 ? "succeeded" : "failed_audit",
    issues,
  };
}

async function validateRequiredRoleCitations(finalReportPath: string, requiredRoles: string[]): Promise<AuditIssue[]> {
  try {
    const fileContent = await readFile(finalReportPath, "utf8");
    const section = extractMarkdownSection(fileContent, "required_role_citations");
    if (!section) {
      return requiredRoles.map((role) => ({
        code: "missing_required_role" as const,
        message: `required role missing from final-report citations: ${role}`,
        role,
        section: "required_role_citations",
        path: finalReportPath,
      }));
    }
    const normalizedSection = normalizeRoleName(section);
    return requiredRoles
      .filter((role) => !normalizedSection.includes(normalizeRoleName(role)))
      .map((role) => ({
        code: "missing_required_role" as const,
        message: `required role missing from final-report citations: ${role}`,
        role,
        section: "required_role_citations",
        path: finalReportPath,
      }));
  } catch (error) {
    return [{
      code: "unreadable_required_file",
      message: `required artifact file unreadable: ${finalReportPath} (${error instanceof Error ? error.message : String(error)})`,
      path: finalReportPath,
    }];
  }
}

function extractMarkdownSection(content: string, sectionName: string): string | null {
  const lines = content.split(/\r?\n/);
  const wanted = normalizeRoleName(sectionName).replaceAll("_", " ");
  let start = -1;
  let level = 0;
  for (let i = 0; i < lines.length; i++) {
    const match = /^(#{1,6})\s+(.+?)\s*$/.exec(lines[i] ?? "");
    if (!match) continue;
    const title = normalizeRoleName(match[2]!).replaceAll(/[-_]+/g, " ");
    if (title === wanted) {
      start = i + 1;
      level = match[1]!.length;
      break;
    }
  }
  if (start < 0) return null;
  let end = lines.length;
  for (let i = start; i < lines.length; i++) {
    const match = /^(#{1,6})\s+/.exec(lines[i] ?? "");
    if (match && match[1]!.length <= level) {
      end = i;
      break;
    }
  }
  return lines.slice(start, end).join("\n");
}

function resolveFinalReportPath(
  input: AuditMiddlewareInput,
): { ok: true; path: string } | { ok: false; issue?: AuditIssue } {
  if (input.finalReportPath) {
    const resolved = resolveArtifactRequirementPath(input.artifactRootDir, input.finalReportPath);
    return resolved.ok ? resolved : { ok: false, issue: resolved.issue };
  }

  for (const requirement of input.runProfile.artifactContract?.requiredFiles ?? []) {
    const relativePath = typeof requirement === "string" ? requirement : requirement.path;
    if (/final-report\.(md|markdown|txt)$/i.test(relativePath) || /final-report/i.test(relativePath)) {
      const resolved = resolveArtifactRequirementPath(input.artifactRootDir, requirement);
      return resolved.ok ? resolved : { ok: false, issue: resolved.issue };
    }
  }

  return { ok: false };
}

async function validateFinalReportSections(finalReportPath: string, requiredSections: string[]): Promise<AuditIssue[]> {
  try {
    const fileContent = await readFile(finalReportPath, "utf8");
    return validateRequiredSections(fileContent, requiredSections, finalReportPath);
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === "ENOENT" || code === "EISDIR") {
      return [{
        code: "missing_required_file",
        message: `required artifact file missing: ${finalReportPath}`,
        path: finalReportPath,
      }];
    }
    return [{
      code: "unreadable_required_file",
      message: `required artifact file unreadable: ${finalReportPath} (${error instanceof Error ? error.message : String(error)})`,
      path: finalReportPath,
    }];
  }
}

function normalizeRoleName(role: string): string {
  return role.trim().toLowerCase();
}
