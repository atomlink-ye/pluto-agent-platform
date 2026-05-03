import { rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type {
  AgentEvent,
  BlockerReasonV0,
  CoordinationTranscriptRefV0,
  EvidencePacketV0,
  TeamRunResult,
  TeamTask,
} from "../contracts/types.js";
import { validateEvidencePacketV0 } from "./evidence/validate-v0.js";
import { generateEvidencePacket, type GenerateEvidenceInput } from "./evidence/generate-v0.js";
import { renderEvidenceMarkdown } from "./evidence/render.js";
import { redactEvidencePacketV0 } from "./evidence/redact.js";

export type { GenerateEvidenceInput };
export type { EvidencePacketValidationResult } from "./evidence/validate-v0.js";

export {
  redactSecrets,
  redactEventPayload,
  redactWorkspacePath,
  redactEvidencePacketV0,
} from "./evidence/redact.js";

export { validateEvidencePacketV0 };

export { generateEvidencePacket };

export { renderEvidenceMarkdown };

export async function writeEvidence(
  runDir: string,
  packet: EvidencePacketV0,
): Promise<{ mdPath: string; jsonPath: string }> {
  const mdPath = join(runDir, "evidence.md");
  const jsonPath = join(runDir, "evidence.json");
  const redactedPacket = redactEvidencePacketV0(packet);
  const validation = validateEvidencePacketV0(redactedPacket);
  if (!validation.ok) {
    throw new Error(`evidence_packet_invalid: ${validation.errors.join("; ")}`);
  }

  try {
    await writeFile(mdPath, renderEvidenceMarkdown(redactedPacket), "utf8");
    await writeFile(jsonPath, JSON.stringify(redactedPacket, null, 2) + "\n", "utf8");
  } catch (cause) {
    await Promise.all([
      rm(mdPath, { force: true }).catch(() => {}),
      rm(jsonPath, { force: true }).catch(() => {}),
    ]);
    throw cause;
  }

  return { mdPath, jsonPath };
}