import { mkdir, writeFile, appendFile } from "node:fs/promises";
import { join } from "node:path";
import type { AgentEvent, FinalArtifact } from "../contracts/types.js";

/**
 * Disk-backed run state. MVP keeps it minimal:
 *   .pluto/runs/<runId>/events.jsonl   — append-only event log
 *   .pluto/runs/<runId>/artifact.md    — final artifact (overwritten once)
 *
 * The store is process-local and synchronous-ish; it is acceptable for a
 * single-tenant control plane that runs one team at a time.
 */
export class RunStore {
  private readonly dataDir: string;

  constructor(opts: { dataDir?: string } = {}) {
    this.dataDir = opts.dataDir ?? process.env.PLUTO_DATA_DIR ?? ".pluto";
  }

  runDir(runId: string): string {
    return join(this.dataDir, "runs", runId);
  }

  async ensure(runId: string): Promise<void> {
    await mkdir(this.runDir(runId), { recursive: true });
  }

  async appendEvent(event: AgentEvent): Promise<void> {
    await this.ensure(event.runId);
    await appendFile(
      join(this.runDir(event.runId), "events.jsonl"),
      JSON.stringify(event) + "\n",
      "utf8",
    );
  }

  async writeArtifact(artifact: FinalArtifact): Promise<string> {
    await this.ensure(artifact.runId);
    const path = join(this.runDir(artifact.runId), "artifact.md");
    await writeFile(path, artifact.markdown, "utf8");
    return path;
  }
}
