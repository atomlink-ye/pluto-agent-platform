import type { EvidencePacketV0 } from "../../contracts/types.js";
import { redactString } from "../redactor.js";

export function renderEvidenceMarkdown(packet: EvidencePacketV0): string {
  const lines: string[] = [];
  lines.push(`# Evidence Packet — ${packet.runId}`);
  lines.push("");
  lines.push(`- **Status:** ${packet.status}`);
  if (packet.blockerReason) {
    lines.push(`- **Blocker:** ${packet.blockerReason}`);
  }
  lines.push(`- **Task:** ${packet.taskTitle}`);
  lines.push(`- **Started:** ${packet.startedAt}`);
  lines.push(`- **Finished:** ${packet.finishedAt}`);
  if (packet.workspace) {
    lines.push(`- **Workspace:** ${packet.workspace}`);
  }
  lines.push("");
  lines.push("## Workers");
  lines.push("");
  for (const w of packet.workers) {
    lines.push(`### ${w.role}`);
    lines.push(`- Session: ${w.sessionId ?? "n/a"}`);
    lines.push(`- Contribution: ${w.contributionSummary || "(none)"}`);
    lines.push("");
  }
  lines.push("## Validation");
  lines.push(`- Outcome: ${packet.validation.outcome}`);
  if (packet.validation.reason) {
    lines.push(`- Reason: ${packet.validation.reason}`);
  }
  lines.push("");
  if (packet.risks.length > 0) {
    lines.push("## Risks");
    for (const r of packet.risks) {
      lines.push(`- ${r}`);
    }
    lines.push("");
  }
  if (packet.openQuestions.length > 0) {
    lines.push("## Open Questions");
    for (const q of packet.openQuestions) {
      lines.push(`- ${q}`);
    }
    lines.push("");
  }
  lines.push("## Cited Inputs");
  lines.push(`- Prompt: ${packet.citedInputs.taskPrompt}`);
  if (packet.citedInputs.workspaceMarkers.length > 0) {
    lines.push(`- Workspace markers: ${packet.citedInputs.workspaceMarkers.join(", ")}`);
  }
  lines.push("");
  lines.push(`---`);
  lines.push(`Schema version: ${packet.schemaVersion} | Classifier version: ${packet.classifierVersion} | Generated: ${packet.generatedAt}`);
  lines.push("");
  return redactString(lines.join("\n"));
}