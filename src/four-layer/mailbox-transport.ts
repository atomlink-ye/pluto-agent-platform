import type {
  MailboxEnvelope,
  RoomRef,
  TransportMessageRef,
  TransportReadResult,
  TransportSince,
} from "../contracts/four-layer.js";

export interface MailboxTransport {
  createRoom(input: { runId: string; name: string; purpose?: string }): Promise<RoomRef>;
  post(input: { room: RoomRef; envelope: MailboxEnvelope; replyTo?: string }): Promise<TransportMessageRef>;
  read(input: { room: RoomRef; since?: TransportSince; limit?: number; agentId?: string }): Promise<TransportReadResult>;
}
