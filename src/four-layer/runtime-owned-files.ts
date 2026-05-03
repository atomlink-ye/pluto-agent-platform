import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

export interface RuntimeOwnedFileSnapshot {
  filePath: string;
  sha256: string;
  lineCount: number;
  writtenAt: string;
}

export async function captureRuntimeOwnedFileSnapshot(
  filePath: string,
  writtenAt: string,
): Promise<RuntimeOwnedFileSnapshot> {
  const raw = await readFile(filePath, "utf8");
  return {
    filePath,
    sha256: createHash("sha256").update(raw).digest("hex"),
    lineCount: countLines(raw),
    writtenAt,
  };
}

export async function persistRuntimeOwnedFileSnapshot(
  snapshotPath: string,
  snapshot: RuntimeOwnedFileSnapshot,
): Promise<void> {
  await mkdir(dirname(snapshotPath), { recursive: true });
  await writeFile(snapshotPath, JSON.stringify(snapshot, null, 2) + "\n", "utf8");
}

export async function readRuntimeOwnedFileSnapshot(
  snapshotPath: string,
): Promise<RuntimeOwnedFileSnapshot | null> {
  try {
    const raw = await readFile(snapshotPath, "utf8");
    return JSON.parse(raw) as RuntimeOwnedFileSnapshot;
  } catch {
    return null;
  }
}

export function runtimeOwnedSnapshotPath(runDir: string, target: "mailbox" | "tasklist"): string {
  return join(runDir, "evidence", `${target}-runtime-snapshot.json`);
}

function countLines(raw: string): number {
  if (raw.length === 0) return 0;
  const lines = raw.split(/\r?\n/);
  if (lines.at(-1) === "") {
    lines.pop();
  }
  return lines.length;
}
