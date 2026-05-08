#!/usr/bin/env tsx

import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join, relative, resolve } from 'node:path';
import process from 'node:process';
import { pathToFileURL } from 'node:url';

import {
  defaultClockProvider,
  defaultIdProvider,
  replayAll,
  type ActorRef,
  type AuthoredSpec,
} from '../../pluto-v2-core/src/index.ts';

import {
  loadAuthoredSpec,
  makePaseoAdapter,
  makePaseoCliClient,
  runPaseo,
  type PaseoAgentSpec,
  type PaseoCliClient,
} from '../src/index.js';
import { EvidencePacketShape } from '../src/evidence/evidence-packet.js';

type ActorUsageTotals = {
  turns: number;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  costUsd: number;
  provider: string | null;
  model: string | null;
  mode: string | null;
  thinking: string | null;
};

type ModelUsageTotals = {
  provider: string;
  model: string;
  mode: string | null;
  thinking: string | null;
  turns: number;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  costUsd: number;
  actors: string[];
};

const MAX_TURNS = 20;
const MAX_COST_USD = 0.5;
const TRANSCRIPT_TAIL_LINES = 200;
const DEFAULT_PROVIDER = 'opencode';
const DEFAULT_MODEL = 'openai/gpt-5.4-mini';
const DEFAULT_MODE = 'build';
const DEFAULT_WAIT_TIMEOUT_SEC = 600;

type SmokeInput = {
  authored: AuthoredSpec;
  specPath: string | null;
  authoredSpecText: string | null;
  playbookBody: string | null;
  playbookSha256: string | null;
};

function actorKey(actor: ActorRef | { readonly kind: 'broadcast' }): string {
  switch (actor.kind) {
    case 'manager':
      return 'manager';
    case 'system':
      return 'system';
    case 'broadcast':
      return 'broadcast';
    case 'role':
      return `role:${actor.role}`;
  }
}

function initialPromptForActor(actor: ActorRef): string {
  const actorName = actor.kind === 'role' ? actor.role : actor.kind;
  const roleInstruction = (() => {
    switch (actor.kind) {
      case 'manager':
        return 'Coordinate the run and complete it only when the team output is ready.';
      case 'system':
        return 'Provide system-level control messages only when explicitly required.';
      case 'role':
        switch (actor.role) {
          case 'planner':
            return 'Plan the next deterministic runtime step and answer only through the requested directive.';
          case 'generator':
            return 'Produce the requested artifact or task-state directive for the current deterministic runtime step.';
          case 'evaluator':
            return 'Review the current output and answer only through the requested evaluation directive.';
          default:
            return 'Follow the current actor role instructions and answer only through the requested directive.';
        }
    }
  })();

  return [
    `You are the ${actorName} actor for a Pluto v2 live smoke run.`,
    `System role instruction: ${roleInstruction}`,
    'Wait for the next prompt and follow it exactly.',
  ].join('\n');
}

function authoredSpecFor(runId: string): AuthoredSpec {
  return {
    runId,
    scenarioRef: 'scenario/hello-team-real',
    runProfileRef: 'paseo-live-smoke',
    actors: {
      manager: { kind: 'manager' },
      planner: { kind: 'role', role: 'planner' },
      generator: { kind: 'role', role: 'generator' },
      evaluator: { kind: 'role', role: 'evaluator' },
    },
    declaredActors: ['manager', 'planner', 'generator', 'evaluator'],
  };
}

function parseSpecArg(argv: readonly string[]): string | null {
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--spec') {
      return argv[index + 1] ?? null;
    }
    if (arg.startsWith('--spec=')) {
      return arg.slice('--spec='.length);
    }
  }

  return null;
}

async function loadSmokeInput(repoRoot: string, argv: readonly string[]): Promise<SmokeInput> {
  const specArg = parseSpecArg(argv);
  if (specArg == null || specArg.trim().length === 0) {
    const runId = process.env.PLUTO_V2_SMOKE_RUN_ID?.trim() || randomUUID();
    return {
      authored: authoredSpecFor(runId),
      specPath: null,
      authoredSpecText: null,
      playbookBody: null,
      playbookSha256: null,
    };
  }

  const specPath = resolve(repoRoot, specArg);
  const authored = loadAuthoredSpec(specPath);
  const authoredSpecText = await readFile(specPath, 'utf8');

  return {
    authored,
    specPath,
    authoredSpecText,
    playbookBody: authored.playbook?.body ?? null,
    playbookSha256: authored.playbook?.sha256 ?? null,
  };
}

function renderFinalReport(input: {
  readonly runId: string;
  readonly status: string;
  readonly summary: string | null;
  readonly evidence: ReturnType<typeof replayAll>['evidence'];
  readonly tasks: ReturnType<typeof replayAll>['task'];
  readonly mailbox: ReturnType<typeof replayAll>['mailbox'];
  readonly artifacts: ReadonlyArray<{
    artifactId: string;
    kind: string;
    mediaType: string;
    byteSize: number;
  }>;
}): string {
  const lines = [
    '# Pluto v2 Paseo Live Smoke',
    '',
    `- Run ID: ${input.runId}`,
    `- Status: ${input.status}`,
    `- Summary: ${input.summary ?? 'none'}`,
    '',
    '## Evidence Citations',
  ];

  for (const citation of input.evidence.citations) {
    lines.push(`- [${citation.sequence}] ${citation.kind}: ${citation.summary}`);
  }

  lines.push('', '## Tasks');
  for (const [taskId, task] of Object.entries(input.tasks.tasks)) {
    lines.push(`- ${taskId}: ${task.title} (${task.state})`);
  }

  lines.push('', '## Mailbox');
  for (const message of input.mailbox.messages) {
    lines.push(`- [${message.sequence}] ${actorKey(message.fromActor)} -> ${actorKey(message.toActor)} (${message.kind})`);
    lines.push(`  ${message.body}`);
  }

  lines.push('', '## Artifacts');
  for (const artifact of input.artifacts) {
    lines.push(`- ${artifact.artifactId}: ${artifact.kind} ${artifact.mediaType} (${artifact.byteSize} bytes)`);
  }

  return `${lines.join('\n')}\n`;
}

function toJsonl(lines: ReadonlyArray<unknown>): string {
  return `${lines.map((line) => JSON.stringify(line)).join('\n')}\n`;
}

function makeTrackedClient(baseClient: PaseoCliClient, actorSpecByKey: Map<string, PaseoAgentSpec>) {
  const agentIdByActorKey = new Map<string, string>();
  const transcriptByActorKey = new Map<string, string>();

  const resolveActorKeyForAgent = (agentId: string): string | null => {
    for (const [actorKeyValue, trackedAgentId] of agentIdByActorKey.entries()) {
      if (trackedAgentId === agentId) {
        return actorKeyValue;
      }
    }
    return null;
  };

  const client: PaseoCliClient = {
    async spawnAgent(spec) {
      const session = await baseClient.spawnAgent(spec);
      agentIdByActorKey.set(spec.title, session.agentId);
      return session;
    },
    sendPrompt(agentId, prompt) {
      return baseClient.sendPrompt(agentId, prompt);
    },
    waitIdle(agentId, timeoutSec) {
      return baseClient.waitIdle(agentId, timeoutSec);
    },
    readTranscript(agentId, tailLines) {
      return baseClient.readTranscript(agentId, tailLines);
    },
    usageEstimate(agentId) {
      return baseClient.usageEstimate(agentId);
    },
    async deleteAgent(agentId) {
      const key = resolveActorKeyForAgent(agentId);
      if (key) {
        try {
          transcriptByActorKey.set(key, await baseClient.readTranscript(agentId, TRANSCRIPT_TAIL_LINES));
        } catch {
          transcriptByActorKey.set(key, transcriptByActorKey.get(key) ?? '');
        }
      }
      await baseClient.deleteAgent(agentId);
    },
  };

  return {
    client,
    agentIdByActorKey,
    transcriptByActorKey,
    actorSpecByKey,
  };
}

async function main(): Promise<void> {
  // Resolve repo root from the script's own location so `pnpm --filter ... exec`
  // (which runs cwd=package dir) still writes the fixture to the workspace root.
  const scriptDir = resolve(new URL('.', import.meta.url).pathname);
  const repoRoot = process.env.PLUTO_V2_REPO_ROOT?.trim() || resolve(scriptDir, '..', '..', '..');
  const smokeInput = await loadSmokeInput(repoRoot, process.argv.slice(2));
  const authored = smokeInput.authored;
  const runId = authored.runId;
  const fixtureDir = join(repoRoot, 'tests/fixtures/live-smoke', runId);
  const transcriptDir = join(fixtureDir, 'paseo-transcripts');
  await mkdir(transcriptDir, { recursive: true });

  const provider = process.env.PASEO_PROVIDER?.trim() || DEFAULT_PROVIDER;
  const model = process.env.PASEO_MODEL?.trim() || DEFAULT_MODEL;
  const mode = process.env.PASEO_MODE?.trim() || DEFAULT_MODE;
  const thinking = process.env.PASEO_THINKING?.trim() || undefined;
  const host = process.env.PASEO_HOST?.trim() || undefined;
  const bin = process.env.PASEO_BIN?.trim() || undefined;
  const waitTimeoutSec = Number.parseInt(process.env.PLUTO_V2_WAIT_TIMEOUT_SEC ?? '', 10) || DEFAULT_WAIT_TIMEOUT_SEC;
  const workspaceCwd = process.env.PLUTO_V2_WORKSPACE_CWD?.trim() || repoRoot;

  const actorSpecByKey = new Map<string, PaseoAgentSpec>();
  const paseoAgentSpec = (actor: ActorRef): PaseoAgentSpec => {
    const spec = {
      provider,
      model,
      mode,
      thinking,
      title: actorKey(actor),
      initialPrompt: initialPromptForActor(actor),
      labels: ['slice=s5', 'scenario=hello-team', `actor=${actorKey(actor)}`],
      cwd: workspaceCwd,
    } satisfies PaseoAgentSpec;
    actorSpecByKey.set(spec.title, spec);
    return spec;
  };

  const tracked = makeTrackedClient(
    makePaseoCliClient({
      bin,
      host,
      cwd: repoRoot,
      timeoutDefaultSec: waitTimeoutSec,
    }),
    actorSpecByKey,
  );

  const result = await runPaseo(authored, makePaseoAdapter({ idProvider: defaultIdProvider, clockProvider: defaultClockProvider }), {
    client: tracked.client,
    idProvider: defaultIdProvider,
    clockProvider: defaultClockProvider,
    paseoAgentSpec,
    waitTimeoutSec,
    workspaceCwd,
  });

  const replayed = replayAll(result.events);
  const parsedPacket = EvidencePacketShape.parse(result.evidencePacket);
  const evidencePacketPath = join(fixtureDir, 'evidence-packet.json');
  const finalReportPath = join(fixtureDir, 'final-report.md');
  const eventsPath = join(fixtureDir, 'events.jsonl');
  const usageSummaryPath = join(fixtureDir, 'usage-summary.json');

  const perTurn = result.usage.perTurn.map((entry) => {
    const key = actorKey(entry.actor);
    const spec = actorSpecByKey.get(key);
    return {
      turnIndex: entry.turnIndex,
      actor: entry.actor,
      actorKey: key,
      provider: spec?.provider ?? null,
      model: spec?.model ?? null,
      mode: spec?.mode ?? null,
      thinking: spec?.thinking ?? null,
      inputTokens: entry.inputTokens,
      outputTokens: entry.outputTokens,
      totalTokens: entry.inputTokens + entry.outputTokens,
      costUsd: entry.costUsd,
      waitExitCode: entry.waitExitCode,
    };
  });

  const byActor = Object.fromEntries(
    [...result.usage.byActor.entries()].map(([key, usage]) => {
      const spec = actorSpecByKey.get(key);
      const normalized: ActorUsageTotals = {
        turns: usage.turns,
        inputTokens: usage.inputTokens,
        outputTokens: usage.outputTokens,
        totalTokens: usage.inputTokens + usage.outputTokens,
        costUsd: usage.costUsd,
        provider: spec?.provider ?? null,
        model: spec?.model ?? null,
        mode: spec?.mode ?? null,
        thinking: spec?.thinking ?? null,
      };
      return [key, normalized];
    }),
  );

  const byModelAccumulator = new Map<string, ModelUsageTotals>();
  for (const turn of perTurn) {
    const providerKey = turn.provider ?? 'unknown-provider';
    const modelKey = turn.model ?? 'unknown-model';
    const breakdownKey = `${providerKey}:${modelKey}`;
    const current = byModelAccumulator.get(breakdownKey) ?? {
      provider: providerKey,
      model: modelKey,
      mode: turn.mode,
      thinking: turn.thinking,
      turns: 0,
      inputTokens: 0,
      outputTokens: 0,
      totalTokens: 0,
      costUsd: 0,
      actors: [],
    };
    current.turns += 1;
    current.inputTokens += turn.inputTokens;
    current.outputTokens += turn.outputTokens;
    current.totalTokens += turn.totalTokens;
    current.costUsd += turn.costUsd;
    if (!current.actors.includes(turn.actorKey)) {
      current.actors.push(turn.actorKey);
    }
    byModelAccumulator.set(breakdownKey, current);
  }

  const usageSummary = {
    runId,
    scenarioRef: authored.scenarioRef,
    runProfileRef: authored.runProfileRef,
    status: parsedPacket.status,
    finalSummary: parsedPacket.summary,
    totalTurns: perTurn.length,
    totalInputTokens: result.usage.totalInputTokens,
    totalOutputTokens: result.usage.totalOutputTokens,
    totalTokens: result.usage.totalInputTokens + result.usage.totalOutputTokens,
    totalCostUsd: result.usage.totalCostUsd,
    usageStatus: result.usage.usageStatus,
    reportedBy: result.usage.reportedBy,
    estimated: result.usage.estimated,
    byActor,
    perTurn,
    byModel: Object.fromEntries(byModelAccumulator.entries()),
    evidencePacketPath: relative(repoRoot, evidencePacketPath),
  };

  if (usageSummary.totalTurns > MAX_TURNS) {
    throw new Error(`live smoke exceeded turn budget: ${usageSummary.totalTurns} > ${MAX_TURNS}`);
  }
  if (usageSummary.totalCostUsd > MAX_COST_USD) {
    throw new Error(`live smoke exceeded cost budget: ${usageSummary.totalCostUsd} > ${MAX_COST_USD}`);
  }

  await writeFile(eventsPath, toJsonl(result.events), 'utf8');
  await writeFile(evidencePacketPath, JSON.stringify(parsedPacket, null, 2), 'utf8');
  await writeFile(
    finalReportPath,
    renderFinalReport({
      runId,
      status: parsedPacket.status,
      summary: parsedPacket.summary,
      evidence: replayed.evidence,
      tasks: replayed.task,
      mailbox: replayed.mailbox,
      artifacts: parsedPacket.artifacts,
    }),
    'utf8',
  );
  await writeFile(usageSummaryPath, JSON.stringify(usageSummary, null, 2), 'utf8');

  if (authored.orchestration?.mode === 'agentic_tool' && smokeInput.authoredSpecText != null) {
    await writeFile(join(fixtureDir, 'authored-spec.yaml'), smokeInput.authoredSpecText, 'utf8');
    if (smokeInput.playbookBody != null && smokeInput.playbookSha256 != null) {
      const playbookPath = join(fixtureDir, 'playbook.md');
      const playbookHash = createHash('sha256').update(smokeInput.playbookBody).digest('hex');
      await writeFile(playbookPath, smokeInput.playbookBody, 'utf8');
      await writeFile(join(fixtureDir, 'playbook.sha256'), `${playbookHash}\n`, 'utf8');
    }
    await writeFile(join(repoRoot, 'tests/fixtures/live-smoke/agentic-tool-live-runid.txt'), `${runId}\n`, 'utf8');
  }

  for (const actorName of authored.declaredActors) {
    const actor = authored.actors[actorName];
    if (!actor) {
      continue;
    }
    const key = actorKey(actor);
    const transcript = tracked.transcriptByActorKey.get(key) ?? '';
    await writeFile(join(transcriptDir, `${key}.txt`), transcript, 'utf8');
  }

  process.stdout.write(`${relative(repoRoot, fixtureDir)}\n`);
}

const entryHref = process.argv[1] ? pathToFileURL(resolve(process.argv[1])).href : null;

if (entryHref === import.meta.url) {
  void main().catch((error: unknown) => {
    const message = error instanceof Error ? error.stack ?? error.message : String(error);
    process.stderr.write(`${message}\n`);
    process.exitCode = 1;
  });
}
