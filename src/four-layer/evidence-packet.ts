import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

import type {
  AuditMiddlewareResult,
  AcceptanceCheckResult,
} from "./index.js";
import type {
  EvidenceAuditEvent,
  EvidenceCommandResult,
  EvidencePacket,
  EvidenceRoleCitation,
  EvidenceTransition,
  Run,
  RunArtifactRef,
  RunStatus,
} from "../contracts/four-layer.js";
import { FOUR_LAYER_SCHEMA_VERSION } from "../contracts/four-layer.js";
import { redactObject, redactString } from "../orchestrator/redactor.js";

export interface AggregateEvidencePacketInput {
  run: Run;
  summary?: string;
  failureReason?: string | null;
  issues?: string[];
  artifactRefs?: RunArtifactRef[];
  commandResults?: EvidenceCommandResult[];
  transitions?: EvidenceTransition[];
  roleCitations?: EvidenceRoleCitation[];
  auditEvents?: EvidenceAuditEvent[];
  acceptance?: AcceptanceCheckResult;
  audit?: AuditMiddlewareResult;
  stdoutPath?: string;
  transcriptPath?: string;
  finalReportPath?: string;
  mailboxLogPath?: string;
  taskListPath?: string;
  generatedAt?: string;
}

export function aggregateEvidencePacket(input: AggregateEvidencePacketInput): EvidencePacket {
  return {
    schemaVersion: FOUR_LAYER_SCHEMA_VERSION,
    kind: "evidence_packet",
    runId: input.run.runId,
    status: normalizeEvidenceStatus(input.run.status, input.audit),
    ...(input.summary ? { summary: redactString(input.summary) } : {}),
    ...(input.failureReason !== undefined ? { failureReason: input.failureReason ? redactString(input.failureReason) : null } : {}),
    ...(input.issues?.length ? { issues: input.issues.map((issue) => redactString(issue)) } : {}),
    ...(input.run.coordinationChannel ? { coordinationChannel: redactObject(input.run.coordinationChannel) as EvidencePacket["coordinationChannel"] } : {}),
    ...(input.artifactRefs?.length ? { artifactRefs: redactObject(input.artifactRefs) as RunArtifactRef[] } : {}),
    ...(input.commandResults?.length ? { commandResults: redactObject(input.commandResults) as EvidenceCommandResult[] } : {}),
    ...(input.transitions?.length ? { transitions: redactObject(input.transitions) as EvidenceTransition[] } : {}),
    ...(input.roleCitations?.length ? { roleCitations: redactObject(input.roleCitations) as EvidenceRoleCitation[] } : {}),
    ...(input.auditEvents?.length ? { auditEvents: redactObject(input.auditEvents) as EvidenceAuditEvent[] } : {}),
    ...((input.stdoutPath || input.transcriptPath || input.finalReportPath || input.mailboxLogPath || input.taskListPath || input.acceptance || input.audit)
      ? {
          lineage: {
            ...(input.stdoutPath ? { stdoutPath: redactString(input.stdoutPath) } : {}),
            ...(input.transcriptPath ? { transcriptPath: redactString(input.transcriptPath) } : {}),
            ...(input.finalReportPath ? { finalReportPath: redactString(input.finalReportPath) } : {}),
            ...(input.mailboxLogPath ? { mailboxLogPath: redactString(input.mailboxLogPath) } : {}),
            ...(input.taskListPath ? { taskListPath: redactString(input.taskListPath) } : {}),
            ...(input.acceptance ? { acceptanceOk: input.acceptance.ok } : {}),
            ...(input.audit ? { auditOk: input.audit.ok } : {}),
          },
        }
      : {}),
    generatedAt: input.generatedAt ?? new Date().toISOString(),
  };
}

export function renderEvidencePacketMarkdown(packet: EvidencePacket): string {
  const lines = [
    `# Evidence Packet — ${packet.runId}`,
    "",
    `- **Status:** ${packet.status}`,
    ...(packet.summary ? [`- **Summary:** ${packet.summary}`] : []),
    ...(packet.failureReason ? [`- **Failure reason:** ${packet.failureReason}`] : []),
    ...(packet.coordinationChannel
      ? [
          `- **Coordination channel:** ${packet.coordinationChannel.kind}`,
          `- **Channel locator:** ${packet.coordinationChannel.locator}`,
        ]
      : []),
    "",
  ];

  if (packet.artifactRefs?.length) {
    lines.push("## Artifact refs", "");
    for (const ref of packet.artifactRefs) {
      lines.push(`- ${ref.label ?? ref.path}: ${ref.path}`);
    }
    lines.push("");
  }

  if (packet.commandResults?.length) {
    lines.push("## Command results", "");
    for (const result of packet.commandResults) {
      lines.push(`- ${result.cmd} → exit ${result.exitCode}${result.summary ? ` (${result.summary})` : ""}`);
    }
    lines.push("");
  }

  if (packet.transitions?.length) {
    lines.push("## Transitions", "");
    for (const transition of packet.transitions) {
      lines.push(`- ${transition.from} -> ${transition.to} @ ${transition.observedAt}`);
    }
    lines.push("");
  }

  if (packet.roleCitations?.length) {
    lines.push("## Role citations", "");
    for (const citation of packet.roleCitations) {
      lines.push(`- ${citation.role}${citation.summary ? `: ${citation.summary}` : ""}`);
    }
    lines.push("");
  }

  if (packet.auditEvents?.length) {
    lines.push("## Audit events", "");
    for (const event of packet.auditEvents) {
      lines.push(`- ${event.kind} @ ${event.hookBoundary}: ${event.filePath}`);
    }
    lines.push("");
  }

  if (packet.issues?.length) {
    lines.push("## Issues", "");
    for (const issue of packet.issues) {
      lines.push(`- ${issue}`);
    }
    lines.push("");
  }

  if (packet.lineage) {
    lines.push("## Lineage", "");
    if (packet.lineage.stdoutPath) lines.push(`- stdout: ${packet.lineage.stdoutPath}`);
    if (packet.lineage.transcriptPath) lines.push(`- transcript: ${packet.lineage.transcriptPath}`);
    if (packet.lineage.finalReportPath) lines.push(`- final report: ${packet.lineage.finalReportPath}`);
    if (packet.lineage.mailboxLogPath) lines.push(`- mailbox: ${packet.lineage.mailboxLogPath}`);
    if (packet.lineage.taskListPath) lines.push(`- tasks: ${packet.lineage.taskListPath}`);
    if (packet.lineage.acceptanceOk !== undefined) lines.push(`- acceptance ok: ${String(packet.lineage.acceptanceOk)}`);
    if (packet.lineage.auditOk !== undefined) lines.push(`- audit ok: ${String(packet.lineage.auditOk)}`);
    lines.push("");
  }

  return redactString(lines.join("\n"));
}

export async function writeEvidencePacket(runDir: string, packet: EvidencePacket): Promise<{ jsonPath: string; mdPath: string }> {
  const jsonPath = join(runDir, "evidence-packet.json");
  const mdPath = join(runDir, "evidence-packet.md");
  await mkdir(dirname(jsonPath), { recursive: true });
  await writeFile(jsonPath, JSON.stringify(redactObject(packet), null, 2) + "\n", "utf8");
  await writeFile(mdPath, renderEvidencePacketMarkdown(packet), "utf8");
  return { jsonPath, mdPath };
}

function normalizeEvidenceStatus(status: RunStatus, audit?: AuditMiddlewareResult): RunStatus {
  if (audit?.status === "failed_audit") {
    return "failed_audit";
  }
  return status;
}
