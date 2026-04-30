#!/usr/bin/env tsx
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { existsSync, readFileSync } from "node:fs";

import { FakeAdapter } from "../src/adapters/fake/index.js";
import { DEFAULT_TEAM, RunStore, TeamRunService, validateEvidencePacketV0 } from "../src/orchestrator/index.js";
import type { AgentEvent, AgentEventType, FinalArtifact, TeamRunResult } from "../src/contracts/types.js";

type DimensionId = "event_sequence" | "role_coverage" | "artifact_cleanliness" | "worker_contributions" | "evidence_quality";

interface RubricDimension {
  id: DimensionId;
  weight: number;
  description: string;
}

export interface DimensionScore {
  id: DimensionId;
  weight: number;
  passed: boolean;
  score: number;
  observations: string[];
}

export interface EvalReport {
  evalId: "workflow-quality-v1";
  runId: string;
  status: TeamRunResult["status"];
  passed: boolean;
  totalScore: number;
  dimensions: DimensionScore[];
  summary: {
    eventTypes: AgentEventType[];
    completedWorkers: string[];
    artifactChars: number;
  };
}

const REQUIRED_ROLES = ["lead", "planner", "generator", "evaluator"] as const;
const FORBIDDEN_PROTOCOL_FRAGMENTS = [
  "Instructions from the Team Lead:",
  "Reply with your contribution only",
] as const;

const RUBRIC: RubricDimension[] = [
  {
    id: "event_sequence",
    weight: 0.3,
    description: "Run event log follows the expected workflow lifecycle order.",
  },
  {
    id: "role_coverage",
    weight: 0.2,
    description: "Lead, planner, generator, and evaluator are represented.",
  },
  {
    id: "artifact_cleanliness",
    weight: 0.2,
    description: "Final artifact has no leaked internal prompt protocol fragments.",
  },
  {
    id: "worker_contributions",
    weight: 0.15,
    description: "At least two workers complete and contribute to the artifact.",
  },
  {
    id: "evidence_quality",
    weight: 0.15,
    description: "Evidence packet is present, well-formed, and contains no secret-shaped content.",
  },
];

export function scoreRun(
  result: Pick<TeamRunResult, "runId" | "status" | "events" | "artifact">,
  evidenceDir?: string,
): EvalReport {
  const dimensions = RUBRIC.map((dimension) => scoreDimension(dimension, result, evidenceDir));
  const totalWeight = RUBRIC.reduce((sum, dimension) => sum + dimension.weight, 0);
  const earned = dimensions.reduce((sum, dimension) => sum + dimension.score, 0);
  const completedWorkers = result.events
    .filter((ev) => ev.type === "worker_completed" && ev.roleId)
    .map((ev) => String(ev.roleId));

  return {
    evalId: "workflow-quality-v1",
    runId: result.runId,
    status: result.status,
    passed: result.status === "completed" && dimensions.every((dimension) => dimension.passed),
    totalScore: Number((earned / totalWeight).toFixed(4)),
    dimensions,
    summary: {
      eventTypes: result.events.map((ev) => ev.type),
      completedWorkers,
      artifactChars: result.artifact?.markdown.length ?? 0,
    },
  };
}

async function runWorkflowEval(): Promise<EvalReport> {
  const workspace = await mkdtemp(join(tmpdir(), "pluto-workflow-eval-"));
  try {
    let idSeq = 0;
    const nextId = () => `eval-id-${String(idSeq++).padStart(4, "0")}`;
    const fixedClock = () => new Date("2026-04-29T00:00:00.000Z");

    const adapter = new FakeAdapter({ team: DEFAULT_TEAM, idGen: nextId, clock: fixedClock });
    const store = new RunStore({ dataDir: join(workspace, ".pluto") });
    const service = new TeamRunService({
      adapter,
      team: DEFAULT_TEAM,
      store,
      idGen: nextId,
      clock: fixedClock,
      pumpIntervalMs: 1,
      timeoutMs: 5_000,
    });

    const result = await service.run({
      id: "workflow-quality-v1-fake-task",
      title: "Pluto MVP-alpha workflow quality reference run",
      prompt:
        "Produce a markdown artifact that demonstrates team convergence. The artifact must clearly include the team lead synthesis plus planner, generator, and evaluator contributions, and it must not expose internal adapter prompt protocol text.",
      workspacePath: workspace,
      artifactPath: join(workspace, "workflow-quality-v1.md"),
      minWorkers: 2,
    });

    const evidenceDir = store.runDir(result.runId);
    return scoreRun(result, evidenceDir);
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
}

function scoreDimension(
  dimension: RubricDimension,
  result: Pick<TeamRunResult, "status" | "events" | "artifact">,
  evidenceDir?: string,
): DimensionScore {
  const observations: string[] = [];
  const passed = (() => {
    switch (dimension.id) {
      case "event_sequence":
        return scoreEventSequence(result.events, observations);
      case "role_coverage":
        return scoreRoleCoverage(result.events, result.artifact, observations);
      case "artifact_cleanliness":
        return scoreArtifactCleanliness(result.artifact, observations);
      case "worker_contributions":
        return scoreWorkerContributions(result.events, result.artifact, observations);
      case "evidence_quality":
        return scoreEvidenceQuality(evidenceDir, observations);
    }
  })();

  if (observations.length === 0) observations.push(dimension.description);
  return {
    id: dimension.id,
    weight: dimension.weight,
    passed,
    score: passed ? dimension.weight : 0,
    observations,
  };
}

function scoreEventSequence(events: AgentEvent[], observations: string[]): boolean {
  const types = events.map((ev) => ev.type);
  const terminal = types.at(-1);
  const requiredOrder: AgentEventType[] = [
    "run_started",
    "lead_started",
    "worker_requested",
    "worker_started",
    "worker_completed",
    "lead_message",
    "artifact_created",
    "run_completed",
  ];

  let cursor = -1;
  for (const required of requiredOrder) {
    const nextIndex = types.findIndex((type, index) => index > cursor && type === required);
    if (nextIndex === -1) {
      observations.push(`missing or out-of-order event: ${required}`);
      return false;
    }
    cursor = nextIndex;
  }

  if (terminal !== "run_completed") {
    observations.push(`terminal event is ${terminal ?? "absent"}, expected run_completed`);
    return false;
  }

  observations.push("required lifecycle events are present in order and terminate with run_completed");
  return true;
}

function scoreRoleCoverage(events: AgentEvent[], artifact: FinalArtifact | undefined, observations: string[]): boolean {
  if (!artifact) {
    observations.push("missing final artifact");
    return false;
  }

  const eventRoles = new Set(events.flatMap((ev) => (ev.roleId ? [ev.roleId] : [])));
  const contributionRoles = new Set(artifact.contributions.map((contribution) => contribution.roleId));
  const artifactText = artifact.markdown.toLowerCase();
  const missing = REQUIRED_ROLES.filter((role) => {
    const representedInWorkflow = role === "lead" ? eventRoles.has(role) : eventRoles.has(role) || contributionRoles.has(role);
    return !representedInWorkflow || !artifactText.includes(role);
  });

  if (missing.length > 0) {
    observations.push(`missing role coverage: ${missing.join(", ")}`);
    return false;
  }

  observations.push("lead, planner, generator, and evaluator are represented in workflow evidence and artifact text");
  return true;
}

function scoreArtifactCleanliness(artifact: FinalArtifact | undefined, observations: string[]): boolean {
  if (!artifact) {
    observations.push("missing final artifact");
    return false;
  }

  const scannedText = [artifact.markdown, ...artifact.contributions.map((contribution) => contribution.output)].join("\n");
  const leaked = FORBIDDEN_PROTOCOL_FRAGMENTS.filter((fragment) => scannedText.includes(fragment));
  if (leaked.length > 0) {
    observations.push(`forbidden protocol fragment leaked: ${leaked.join(", ")}`);
    return false;
  }

  observations.push("no forbidden adapter protocol fragments found in artifact or worker outputs");
  return true;
}

function scoreWorkerContributions(events: AgentEvent[], artifact: FinalArtifact | undefined, observations: string[]): boolean {
  const completed = events.filter((ev) => ev.type === "worker_completed").length;
  const contributions = artifact?.contributions.length ?? 0;
  if (completed < 2 || contributions < 2) {
    observations.push(`insufficient workers: completed=${completed}, contributions=${contributions}`);
    return false;
  }

  observations.push(`worker completion threshold met: completed=${completed}, contributions=${contributions}`);
  return true;
}

function scoreEvidenceQuality(evidenceDir: string | undefined, observations: string[]): boolean {
  if (!evidenceDir) {
    observations.push("no evidence directory provided to eval");
    return false;
  }

  const mdPath = join(evidenceDir, "evidence.md");
  const jsonPath = join(evidenceDir, "evidence.json");

  if (!existsSync(mdPath)) {
    observations.push("evidence.md is missing");
    return false;
  }
  if (!existsSync(jsonPath)) {
    observations.push("evidence.json is missing");
    return false;
  }

  try {
    const jsonContent = readFileSync(jsonPath, "utf8");
    const parsed: unknown = JSON.parse(jsonContent);
    if (!validateEvidencePacketV0(parsed)) {
      observations.push("evidence.json does not validate against EvidencePacketV0");
      return false;
    }

    const secretPatterns = [
      /\b(?:sk|pk)[_-][A-Za-z0-9_-]{16,}\b/i,
      /\b(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{36,}\b/,
      /\beyJ[A-Za-z0-9_-]{20,}/,
    ];
    const mdContent = readFileSync(mdPath, "utf8");
    const allContent = mdContent + jsonContent;
    for (const pattern of secretPatterns) {
      if (pattern.test(allContent)) {
        observations.push(`evidence files contain secret-shaped content matching ${pattern.source}`);
        return false;
      }
    }

    observations.push("evidence.md and evidence.json are present, schema-valid, and contain no secret-shaped content");
    return true;
  } catch (err) {
    observations.push(`evidence validation error: ${err instanceof Error ? err.message : String(err)}`);
    return false;
  }
}

function renderMarkdownSummary(report: EvalReport): string {
  const lines = [
    `# workflow-quality-v1 eval ${report.passed ? "PASS" : "FAIL"}`,
    "",
    `- runId: ${report.runId}`,
    `- status: ${report.status}`,
    `- totalScore: ${report.totalScore}`,
    `- completedWorkers: ${report.summary.completedWorkers.join(", ")}`,
    "",
    "## Dimensions",
  ];
  for (const dimension of report.dimensions) {
    lines.push(
      `- ${dimension.passed ? "PASS" : "FAIL"} ${dimension.id} (${dimension.score}/${dimension.weight}): ${dimension.observations.join("; ")}`,
    );
  }
  return lines.join("\n");
}

async function main(): Promise<void> {
  const report = await runWorkflowEval();
  const evalsDir = dirname(fileURLToPath(import.meta.url));
  const reportPath = join(evalsDir, "reports", "workflow-quality-latest.json");
  await mkdir(dirname(reportPath), { recursive: true });
  await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");

  console.log(renderMarkdownSummary(report));
  process.exitCode = report.passed ? 0 : 1;
}

const invokedPath = process.argv[1] ? pathToFileURL(process.argv[1]).href : "";
if (invokedPath === import.meta.url) {
  main().catch((err) => {
    console.error(err instanceof Error ? err.stack : String(err));
    process.exit(1);
  });
}
