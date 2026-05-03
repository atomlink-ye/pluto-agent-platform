import { readFile } from "node:fs/promises";
import { join } from "node:path";

const repoRoot = process.cwd();
const fixturesRoot = join(repoRoot, "tests", "fixtures", "live-smoke");

export function liveSmokeFixturePath(runId: string, ...segments: string[]): string {
  return join(fixturesRoot, runId, ...segments);
}

export async function readJsonLines<T>(filePath: string): Promise<T[]> {
  const raw = await readFile(filePath, "utf8");
  return raw
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .map((line) => JSON.parse(line) as T);
}

export async function readJsonFile<T>(filePath: string): Promise<T> {
  return JSON.parse(await readFile(filePath, "utf8")) as T;
}

export async function loadLiveSmokeFixture<TEvent, TMailbox>(runId: string): Promise<{
  runId: string;
  dir: string;
  events: TEvent[];
  mailboxEntries: TMailbox[];
}> {
  const dir = liveSmokeFixturePath(runId);
  return {
    runId,
    dir,
    events: await readJsonLines<TEvent>(join(dir, "events.jsonl")),
    mailboxEntries: await readJsonLines<TMailbox>(join(dir, "mailbox.jsonl")),
  };
}
