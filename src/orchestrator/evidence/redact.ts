import type { EvidencePacketV0 } from "../../contracts/types.js";
import {
  redactObject,
  redactString,
  redactWorkspacePath as redactCanonicalWorkspacePath,
} from "../redactor.js";

export function redactSecrets(text: string): string {
  return redactString(text);
}

export function redactEventPayload(payload: unknown): unknown {
  return redactObject(payload);
}

export function redactWorkspacePath(workspacePath: string): string {
  return redactCanonicalWorkspacePath(workspacePath);
}

export function redactEvidencePacketV0(packet: EvidencePacketV0): EvidencePacketV0 {
  const redacted = redactObject(packet) as EvidencePacketV0;
  if (packet.orchestration?.transcript && redacted.orchestration?.transcript) {
    redacted.orchestration.transcript = {
      kind: redactString(packet.orchestration.transcript.kind) as "file" | "shared_channel",
      path: redactString(packet.orchestration.transcript.path),
      roomRef: redactString(packet.orchestration.transcript.roomRef),
    };
  }
  return redacted;
}