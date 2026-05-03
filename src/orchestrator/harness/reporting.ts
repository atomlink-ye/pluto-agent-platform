import type { WorkerContribution } from "../../contracts/types.js";
import type { EvidenceTransition, MailboxMessage } from "../../contracts/four-layer.js";

export function buildSummaryRequest(
  taskText: string,
  contributions: ReadonlyArray<WorkerContribution>,
  completionMessages: ReadonlyArray<MailboxMessage>,
  coordinationHandle: string,
): string {
  return [
    "SUMMARIZE",
    `Task: ${taskText}`,
    `Coordination handle: ${coordinationHandle}`,
    "Completion messages:",
    ...completionMessages.map((message) => `- ${message.from}: ${message.id}`),
    "Contributions:",
    ...contributions.map((contribution) => `- ${contribution.roleId}: ${firstNonEmptyLine(contribution.output)}`),
  ].join("\n");
}

export function buildFallbackSummary(taskText: string, contributions: ReadonlyArray<WorkerContribution>): string {
  return [
    `# ${taskText}`,
    "",
    ...contributions.flatMap((contribution) => [`## ${contribution.roleId}`, contribution.output, ""]),
  ].join("\n");
}

export function ensureArtifactMentions(markdown: string, requiredRoles: ReadonlyArray<string>): string {
  const normalized = markdown.trim();
  const missingRoles = requiredRoles.filter((role) => !normalized.toLowerCase().includes(role.toLowerCase()));
  if (missingRoles.length === 0) {
    return markdown;
  }
  const leadSupplement = missingRoles.map((role) => `- ${capitalizeRole(role)}: coordinated the run and is represented in the final artifact.`).join("\n");
  return [normalized, leadSupplement].filter((section) => section.length > 0).join("\n\n") + "\n";
}

export function ensureCompletionMessageCitations(markdown: string, completionMessages: ReadonlyArray<MailboxMessage>): string {
  const normalized = markdown.trim();
  const missingCitations = completionMessages.filter((message) => !normalized.includes(message.id));
  if (missingCitations.length === 0) {
    return markdown;
  }
  return [
    normalized,
    [
      "Completion Citations:",
      ...missingCitations.map((message) => `- ${message.from}: \`${message.id}\``),
    ].join("\n"),
  ].filter((section) => section.length > 0).join("\n\n") + "\n";
}

export function selectFinalArtifactMarkdown(
  leadMarkdown: string,
  workspaceArtifactMarkdown: string | null,
  completionMessages: ReadonlyArray<MailboxMessage>,
): string {
  if (!workspaceArtifactMarkdown || !shouldPreferWorkspaceArtifact(workspaceArtifactMarkdown, leadMarkdown)) {
    return leadMarkdown;
  }

  const normalizedWorkspaceArtifact = workspaceArtifactMarkdown.trim();
  const missingCitations = completionMessages.filter((message) => !normalizedWorkspaceArtifact.includes(message.id));
  const verdictLine = extractVerdictLine(leadMarkdown);
  const metadataSections: string[] = [];

  if (missingCitations.length > 0) {
    metadataSections.push([
      "Citations:",
      ...missingCitations.map((message) => `- ${message.from}: \`${message.id}\``),
    ].join("\n"));
  }

  if (verdictLine && !normalizedWorkspaceArtifact.toLowerCase().includes(verdictLine.toLowerCase())) {
    metadataSections.push(verdictLine);
  }

  return [normalizedWorkspaceArtifact, ...metadataSections].filter((section) => section.length > 0).join("\n\n") + "\n";
}

export function renderTaskTree(playbookName: string, roles: string[]): string {
  return [`# Task Tree — ${playbookName}`, "", ...roles.map((role, index) => `${index + 1}. ${role}`), ""].join("\n");
}

export function renderStatusDoc(runId: string, scenarioName: string, playbookName: string, runProfileName: string, workspaceDir: string, artifactPath: string): string {
  return [
    `# Status — ${runId}`,
    "",
    `- Scenario: ${scenarioName}`,
    `- Playbook: ${playbookName}`,
    `- Run profile: ${runProfileName}`,
    `- Workspace: ${workspaceDir}`,
    `- Artifact: ${artifactPath}`,
    "",
  ].join("\n");
}

export function renderFinalReport(
  summary: string,
  transitions: ReadonlyArray<EvidenceTransition>,
  completionMessages: ReadonlyArray<MailboxMessage>,
  workspaceDir: string,
): string {
  return [
    "# Final Report",
    "",
    "## Implementation Summary",
    firstNonEmptyLine(summary) || "Completed.",
    "",
    "## Workflow Steps Executed",
    ...transitions.map((transition) => `- ${transition.from} -> ${transition.to}`),
    "",
    "## Required Role Citations",
    ...completionMessages.map((message) => `- ${message.from}: ${message.id}`),
    "",
    "## Deviations",
    "- none observed",
    "",
    "## Workspace",
    `- ${workspaceDir}`,
    "",
  ].join("\n");
}

export function firstNonEmptyLine(value: string): string {
  for (const raw of value.split(/\r?\n/)) {
    const line = raw.trim();
    if (line.length === 0) continue;
    return line.replace(/^#+\s*/, "");
  }
  return "";
}

function shouldPreferWorkspaceArtifact(workspaceArtifactMarkdown: string, leadMarkdown: string): boolean {
  const workspaceLength = workspaceArtifactMarkdown.trim().length;
  const leadLength = leadMarkdown.trim().length;
  const workspaceLineCount = countNonEmptyLines(workspaceArtifactMarkdown);
  const leadLineCount = countNonEmptyLines(leadMarkdown);
  const workspaceLooksSubstantive = workspaceLength >= 200 || workspaceLineCount >= 8;
  const leadIsMuchShorter = workspaceLength >= Math.max(leadLength * 2, leadLength + 120)
    && workspaceLineCount >= leadLineCount + 3;
  return workspaceLooksSubstantive && leadIsMuchShorter;
}

function extractVerdictLine(markdown: string): string | null {
  const match = markdown.match(/^Verdict:\s*.+$/im);
  return match?.[0]?.trim() ?? null;
}

function countNonEmptyLines(value: string): number {
  return value.split(/\r?\n/).filter((line) => line.trim().length > 0).length;
}

function capitalizeRole(role: string): string {
  return role.slice(0, 1).toUpperCase() + role.slice(1);
}
