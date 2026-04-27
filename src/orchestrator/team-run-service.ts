import { randomUUID } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import type {
  AgentEvent,
  AgentEventType,
  FinalArtifact,
  TeamConfig,
  TeamRunResult,
  TeamTask,
  WorkerContribution,
} from "../contracts/types.js";
import type { PaseoTeamAdapter } from "../contracts/adapter.js";
import { getRole } from "./team-config.js";
import { RunStore } from "./run-store.js";

export interface TeamRunServiceOptions {
  adapter: PaseoTeamAdapter;
  team: TeamConfig;
  store?: RunStore;
  /** Hard ceiling on the whole run. Defaults to 10 minutes. */
  timeoutMs?: number;
  /** Pump interval when no events were returned. */
  pumpIntervalMs?: number;
  /** ID generator override (tests). */
  idGen?: () => string;
  /** Clock override (tests). */
  clock?: () => Date;
}

export class TeamRunService {
  private readonly adapter: PaseoTeamAdapter;
  private readonly team: TeamConfig;
  private readonly store: RunStore;
  private readonly timeoutMs: number;
  private readonly pumpIntervalMs: number;
  private readonly idGen: () => string;
  private readonly clock: () => Date;

  constructor(opts: TeamRunServiceOptions) {
    this.adapter = opts.adapter;
    this.team = opts.team;
    this.store = opts.store ?? new RunStore();
    this.timeoutMs = opts.timeoutMs ?? 10 * 60 * 1000;
    this.pumpIntervalMs = opts.pumpIntervalMs ?? 25;
    this.idGen = opts.idGen ?? (() => randomUUID());
    this.clock = opts.clock ?? (() => new Date());
  }

  async run(task: TeamTask): Promise<TeamRunResult> {
    if (task.minWorkers < 2) {
      throw new Error(
        `team_task_min_workers_too_low: MVP requires >=2 workers, got ${task.minWorkers}`,
      );
    }
    const runId = this.idGen();
    const collected: AgentEvent[] = [];
    const workersDispatched = new Set<string>();
    const contributions: WorkerContribution[] = [];

    const emit = async (
      type: AgentEventType,
      payload: Record<string, unknown> = {},
    ): Promise<AgentEvent> => {
      const ev: AgentEvent = {
        id: this.idGen(),
        runId,
        ts: this.clock().toISOString(),
        type,
        payload,
      };
      collected.push(ev);
      await this.store.appendEvent(ev);
      return ev;
    };

    const recordAdapterEvent = async (ev: AgentEvent) => {
      collected.push(ev);
      await this.store.appendEvent(ev);
    };

    await this.store.ensure(runId);
    await emit("run_started", { taskId: task.id, teamId: this.team.id, prompt: task.prompt });

    try {
      await this.adapter.startRun({ runId, task, team: this.team });
      const leadRole = getRole(this.team, this.team.leadRoleId);
      const lead = await this.adapter.createLeadSession({
        runId,
        task,
        role: leadRole,
      });

      const expectedWorkers = this.team.roles.filter((r) => r.kind === "worker").length;
      const requiredCompletions = Math.max(task.minWorkers, expectedWorkers);

      let summarized = false;
      let leadSummaryMd: string | undefined;
      const startedAt = Date.now();

      while (true) {
        if (Date.now() - startedAt > this.timeoutMs) {
          throw new Error("team_run_timeout");
        }
        const batch = await this.adapter.readEvents({ runId });
        if (batch.length === 0) {
          if (leadSummaryMd !== undefined) break;
          await delay(this.pumpIntervalMs);
          continue;
        }

        for (const ev of batch) {
          await recordAdapterEvent(ev);

          if (ev.type === "worker_requested") {
            const targetRole = String(
              ev.payload?.["targetRole"] ?? ev.roleId ?? "",
            );
            if (!targetRole || workersDispatched.has(targetRole)) continue;
            const role = getRole(this.team, targetRole);
            const instructions = String(
              ev.payload?.["instructions"] ?? `Work on: ${task.prompt}`,
            );
            workersDispatched.add(targetRole);
            await this.adapter.createWorkerSession({
              runId,
              role,
              instructions,
            });
          } else if (ev.type === "worker_completed") {
            const roleId = String(ev.roleId ?? ev.payload?.["targetRole"] ?? "");
            const sessionId = String(ev.sessionId ?? "");
            const output = String(ev.payload?.["output"] ?? "");
            contributions.push({
              roleId: roleId as WorkerContribution["roleId"],
              sessionId,
              output,
            });
          } else if (ev.type === "lead_message") {
            const kind = String(ev.payload?.["kind"] ?? "");
            if (kind === "summary") {
              leadSummaryMd = String(ev.payload?.["markdown"] ?? "");
            }
          }
        }

        if (
          !summarized &&
          contributions.length >= requiredCompletions
        ) {
          summarized = true;
          await this.adapter.sendMessage({
            runId,
            sessionId: lead.sessionId,
            message: this.buildSummaryRequest(task, contributions),
          });
        }
      }

      if (contributions.length < requiredCompletions) {
        throw new Error(
          `team_run_underdispatched: required=${requiredCompletions} got=${contributions.length}`,
        );
      }
      if (!leadSummaryMd) {
        throw new Error("team_run_missing_summary");
      }

      const artifact: FinalArtifact = {
        runId,
        markdown: leadSummaryMd,
        leadSummary: this.firstNonEmptyLine(leadSummaryMd),
        contributions,
      };
      const artifactPath = await this.store.writeArtifact(artifact);
      await emit("artifact_created", { path: artifactPath, bytes: artifact.markdown.length });
      await emit("run_completed", {
        workerCount: contributions.length,
        roles: contributions.map((c) => c.roleId),
      });

      return { runId, status: "completed", artifact, events: collected };
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : String(cause);
      await emit("run_failed", { message });
      return {
        runId,
        status: "failed",
        events: collected,
        failure: { message, cause },
      };
    } finally {
      await this.adapter.endRun({ runId }).catch(() => {});
    }
  }

  private buildSummaryRequest(task: TeamTask, contributions: WorkerContribution[]): string {
    const lines = contributions.map(
      (c) => `- ${c.roleId}: ${c.output.slice(0, 280)}`,
    );
    return [
      `All ${contributions.length} workers have reported.`,
      "Synthesize the final artifact in markdown.",
      "Include each role's contribution clearly.",
      "Begin with a single-line summary.",
      "Keyword: SUMMARIZE.",
      "",
      `Task: ${task.title}`,
      `Goal: ${task.prompt}`,
      "",
      "Contributions:",
      ...lines,
    ].join("\n");
  }

  private firstNonEmptyLine(md: string): string {
    for (const raw of md.split(/\r?\n/)) {
      const line = raw.trim();
      if (line.length === 0) continue;
      if (line.startsWith("#")) return line.replace(/^#+\s*/, "");
      return line;
    }
    return "";
  }
}
