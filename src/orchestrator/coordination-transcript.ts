import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { CoordinationTranscriptRecordV0, CoordinationTranscriptRefV0 } from "../contracts/types.js";
import { redactObject } from "./redactor.js";

export interface CoordinationTranscript {
  readonly ref: CoordinationTranscriptRefV0;
  append(input: Omit<CoordinationTranscriptRecordV0, "schemaVersion" | "seq">): Promise<CoordinationTranscriptRecordV0>;
  readAll(): Promise<CoordinationTranscriptRecordV0[]>;
}

export class FileBackedCoordinationTranscript implements CoordinationTranscript {
  readonly ref: CoordinationTranscriptRefV0;
  private seq = 0;

  constructor(input: { runId: string; runDir: string; roomRef?: string }) {
    this.ref = {
      kind: "file",
      path: join(input.runDir, "coordination-transcript.jsonl"),
      roomRef: input.roomRef ?? `file-transcript:${input.runId}`,
    };
  }

  async append(input: Omit<CoordinationTranscriptRecordV0, "schemaVersion" | "seq">): Promise<CoordinationTranscriptRecordV0> {
    await mkdir(dirname(this.ref.path), { recursive: true });
    this.seq += 1;
    const record: CoordinationTranscriptRecordV0 = {
      schemaVersion: 0,
      seq: this.seq,
      ...input,
      payload: input.payload ? redactObject(input.payload) as Record<string, unknown> : undefined,
    };
    await writeFile(this.ref.path, JSON.stringify(record) + "\n", { flag: "a", encoding: "utf8" });
    return record;
  }

  async readAll(): Promise<CoordinationTranscriptRecordV0[]> {
    let raw = "";
    try {
      raw = await readFile(this.ref.path, "utf8");
    } catch {
      return [];
    }
    return raw
      .split("\n")
      .filter((line) => line.trim().length > 0)
      .map((line) => JSON.parse(line) as CoordinationTranscriptRecordV0);
  }
}

export function createDefaultCoordinationTranscript(input: {
  runId: string;
  runDir: string;
  roomRef?: string;
}): CoordinationTranscript {
  return new FileBackedCoordinationTranscript(input);
}
