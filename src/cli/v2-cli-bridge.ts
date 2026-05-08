import { mkdir, writeFile } from 'node:fs/promises';
import { basename, extname, join, resolve } from 'node:path';
import process from 'node:process';

import {
  buildUsageSummary,
  loadAuthoredSpec,
  makePaseoAdapter,
  makePaseoCliClient,
  renderFinalReport,
  runPaseo,
  type EvidencePacket,
} from '@pluto/v2-runtime';
import type { PaseoAgentSpec, PaseoCliClient } from '@pluto/v2-runtime';
import { replayAll, SCHEMA_VERSION, type ActorRef, type AuthoredSpec, type ClockProvider, type IdProvider } from '@pluto/v2-core';
import type { LoadedAuthoredSpec } from '@pluto/v2-runtime';

import { classifyPaseoError } from './v2-cli-bridge-error.js';

export interface V2BridgeInput {
  readonly specPath: string;
  readonly workspaceCwd: string;
  readonly evidenceOutputDir: string;
  readonly runRootDir?: string;
  readonly paseoHost?: string;
  readonly paseoBin?: string;
  readonly stderr: NodeJS.WritableStream;
}

export interface V2BridgeResult {
  readonly status: 'succeeded' | 'failed' | 'cancelled';
  readonly summary: string | null;
  readonly runDir: string;
  readonly evidencePacketPath: string;
  readonly transcriptPaths: ReadonlyArray<string>;
  readonly exitCode: 0 | 1 | 2;
}

export interface V2BridgeDeps {
  readonly loadAuthoredSpec: typeof loadAuthoredSpec;
  readonly runPaseo: typeof runPaseo;
  readonly makePaseoCliClient: typeof makePaseoCliClient;
  readonly makePaseoAdapter: typeof makePaseoAdapter;
  readonly defaultIdProvider: IdProvider;
  readonly defaultClockProvider: ClockProvider;
}

const EVIDENCE_PACKET_FILE = 'evidence-packet.json';
const EVENTS_FILE = 'events.jsonl';
const FINAL_REPORT_FILE = 'final-report.md';
const USAGE_SUMMARY_FILE = 'usage-summary.json';
const PROJECTIONS_DIR = 'projections';
const PROJECTIONS_TASKS_FILE = 'tasks.json';
const PROJECTIONS_MAILBOX_FILE = 'mailbox.jsonl';
const PROJECTIONS_ARTIFACTS_FILE = 'artifacts.json';
const TRANSCRIPT_DIR = 'paseo-transcripts';

type PaseoAgentEnvHandoff = {
  readonly apiUrl: string;
  readonly bearerToken: string;
  readonly actorKey: string;
};

function actorKeyOf(actor: ActorRef): string {
  switch (actor.kind) {
    case 'manager':
      return 'manager';
    case 'system':
      return 'system';
    case 'role':
      return `role:${actor.role}`;
  }
}

function actorBootstrapPrompt(actor: ActorRef): string {
  switch (actor.kind) {
    case 'manager':
      return 'You are Pluto\'s manager actor. Follow the prompt exactly and return only the required response.';
    case 'system':
      return 'You are Pluto\'s system actor. Follow the prompt exactly and return only the required response.';
    case 'role':
      return `You are Pluto\'s ${actor.role} actor. Follow the prompt exactly and return only the required response.`;
  }
}

function buildPaseoAgentSpec(
  actor: ActorRef,
  workspaceCwd: string,
  handoff?: PaseoAgentEnvHandoff,
): PaseoAgentSpec {
  const provider = process.env.PASEO_PROVIDER ?? 'opencode';
  const model = process.env.PASEO_MODEL ?? 'openai/gpt-5.4-mini';
  const mode = process.env.PASEO_MODE ?? 'build';
  const thinking = process.env.PASEO_THINKING;

  return {
    provider,
    model,
    mode,
    ...(thinking ? { thinking } : {}),
    title: `pluto-${actorKeyOf(actor)}`,
    labels: ['slice=v2-cli'],
    initialPrompt: actorBootstrapPrompt(actor),
    cwd: workspaceCwd,
    ...(handoff == null
      ? {}
      : {
          env: {
            PLUTO_RUN_API_URL: handoff.apiUrl,
            PLUTO_RUN_TOKEN: handoff.bearerToken,
            PLUTO_RUN_ACTOR: handoff.actorKey,
          },
        }),
  };
}

function wrapPaseoClient(
  client: PaseoCliClient,
  promptByTitle: ReadonlyMap<string, string>,
  transcriptByActor: Map<string, string>,
): PaseoCliClient {
  const actorByAgentId = new Map<string, string>();

  return {
    async spawnAgent(spec) {
      const session = await client.spawnAgent({
        ...spec,
        initialPrompt: [promptByTitle.get(spec.title), spec.initialPrompt].filter(Boolean).join('\n\n'),
      });
      actorByAgentId.set(session.agentId, spec.title.startsWith('pluto-') ? spec.title.slice('pluto-'.length) : spec.title);
      return session;
    },
    sendPrompt(agentId, prompt) {
      return client.sendPrompt(agentId, prompt);
    },
    waitIdle(agentId, timeoutSec) {
      return client.waitIdle(agentId, timeoutSec);
    },
    async readTranscript(agentId, tailLines) {
      const transcript = await client.readTranscript(agentId, tailLines);
      const actorKey = actorByAgentId.get(agentId);
      if (actorKey) {
        transcriptByActor.set(actorKey, transcript);
      }
      return transcript;
    },
    usageEstimate(agentId) {
      return client.usageEstimate(agentId);
    },
    deleteAgent(agentId) {
      return client.deleteAgent(agentId);
    },
  };
}

async function writeTranscripts(
  runDir: string,
  transcriptByActor: ReadonlyMap<string, string>,
): Promise<ReadonlyArray<string>> {
  const transcriptDir = join(runDir, TRANSCRIPT_DIR);
  await mkdir(transcriptDir, { recursive: true });

  const transcriptPaths: string[] = [];
  for (const actorKey of [...transcriptByActor.keys()].sort()) {
    const transcriptPath = join(transcriptDir, `${actorKey}.txt`);
    await writeFile(transcriptPath, transcriptByActor.get(actorKey) ?? '', 'utf8');
    transcriptPaths.push(transcriptPath);
  }

  return transcriptPaths;
}

function toJsonl(lines: ReadonlyArray<unknown>): string {
  return `${lines.map((line) => JSON.stringify(line)).join('\n')}\n`;
}

function fallbackRunId(specPath: string): string {
  return basename(specPath, extname(specPath)) || 'v2-cli';
}

function resolveRunDir(input: Pick<V2BridgeInput, 'workspaceCwd' | 'evidenceOutputDir' | 'runRootDir' | 'specPath'>, runId: string): string {
  if (input.runRootDir) {
    return resolve(input.runRootDir, runId);
  }

  const evidenceDir = resolve(input.evidenceOutputDir);
  if (basename(evidenceDir) === 'evidence') {
    return join(resolve(evidenceDir, '..'), 'runs', runId);
  }

  return join(resolve(input.workspaceCwd), '.pluto', 'runs', runId);
}

function fallbackAuthoredSpec(specPath: string, runId = fallbackRunId(specPath)): LoadedAuthoredSpec {
  return {
    runId,
    scenarioRef: specPath,
    runProfileRef: 'paseo-v2-cli',
    actors: {},
    declaredActors: [],
    playbook: null,
  };
}

function toCoreAuthoredSpec(loaded: LoadedAuthoredSpec): AuthoredSpec {
  const { playbook: _playbook, orchestration, ...rest } = loaded;
  if (!orchestration) {
    return rest as AuthoredSpec;
  }
  const coreMode =
    orchestration.mode === 'agentic_tool'
      ? 'agentic'
      : orchestration.mode;
  return {
    ...rest,
    orchestration: {
      ...orchestration,
      ...(coreMode === undefined ? {} : { mode: coreMode }),
    },
  } as AuthoredSpec;
}

function buildFailedEvidencePacket(args: {
  readonly authored: LoadedAuthoredSpec;
  readonly summary: string | null;
}): EvidencePacket {
  const timestamp = new Date().toISOString();
  return {
    schemaVersion: SCHEMA_VERSION,
    kind: 'evidence_packet',
    runId: args.authored.runId,
    status: 'failed',
    summary: args.summary,
    startedAt: null,
    completedAt: null,
    generatedAt: timestamp,
    citations: [],
    tasks: {},
    mailboxMessages: [],
    artifacts: [],
  };
}

async function writeRunArtifacts(args: {
  readonly runDir: string;
  readonly authored: LoadedAuthoredSpec;
  readonly result: Awaited<ReturnType<typeof runPaseo>>;
  readonly transcriptByActor: ReadonlyMap<string, string>;
  readonly specByTitle: ReadonlyMap<string, PaseoAgentSpec>;
}): Promise<ReadonlyArray<string>> {
  const evidencePacketPath = join(args.runDir, EVIDENCE_PACKET_FILE);
  const finalReportPath = join(args.runDir, FINAL_REPORT_FILE);
  const usageSummaryPath = join(args.runDir, USAGE_SUMMARY_FILE);
  const eventsPath = join(args.runDir, EVENTS_FILE);
  const projectionsDir = join(args.runDir, PROJECTIONS_DIR);
  const tasksPath = join(projectionsDir, PROJECTIONS_TASKS_FILE);
  const mailboxPath = join(projectionsDir, PROJECTIONS_MAILBOX_FILE);
  const artifactsPath = join(projectionsDir, PROJECTIONS_ARTIFACTS_FILE);

  await mkdir(projectionsDir, { recursive: true });

  const views = replayAll(args.result.events);
  const actorSpecByKey = new Map<string, PaseoAgentSpec>();
  for (const [title, spec] of args.specByTitle.entries()) {
    const actorKey = title.startsWith('pluto-') ? title.slice('pluto-'.length) : title;
    actorSpecByKey.set(actorKey, spec);
  }

  const coreAuthored = toCoreAuthoredSpec(args.authored);
  const usageSummary = buildUsageSummary({
    authored: coreAuthored,
    evidencePacket: args.result.evidencePacket,
    usage: args.result.usage,
    actorSpecByKey,
    evidencePacketPath,
  });

  await writeFile(eventsPath, toJsonl(args.result.events), 'utf8');
  await writeFile(tasksPath, JSON.stringify(views.task.tasks, null, 2), 'utf8');
  await writeFile(mailboxPath, toJsonl(views.mailbox.messages), 'utf8');
  await writeFile(artifactsPath, JSON.stringify(args.result.evidencePacket.artifacts, null, 2), 'utf8');
  await writeFile(evidencePacketPath, JSON.stringify(args.result.evidencePacket, null, 2), 'utf8');
  await writeFile(
    finalReportPath,
    renderFinalReport({
      runId: args.authored.runId,
      status: args.result.evidencePacket.status,
      summary: args.result.evidencePacket.summary,
      evidence: views.evidence,
      tasks: views.task,
      mailbox: views.mailbox,
      artifacts: args.result.evidencePacket.artifacts,
    }),
    'utf8',
  );
  await writeFile(usageSummaryPath, JSON.stringify(usageSummary, null, 2), 'utf8');

  return writeTranscripts(args.runDir, args.transcriptByActor);
}

async function writeFailedRunArtifacts(args: {
  readonly runDir: string;
  readonly authored: LoadedAuthoredSpec;
  readonly summary: string | null;
  readonly transcriptByActor: ReadonlyMap<string, string>;
}): Promise<ReadonlyArray<string>> {
  const evidencePacketPath = join(args.runDir, EVIDENCE_PACKET_FILE);
  const finalReportPath = join(args.runDir, FINAL_REPORT_FILE);
  const usageSummaryPath = join(args.runDir, USAGE_SUMMARY_FILE);
  const eventsPath = join(args.runDir, EVENTS_FILE);
  const projectionsDir = join(args.runDir, PROJECTIONS_DIR);
  const tasksPath = join(projectionsDir, PROJECTIONS_TASKS_FILE);
  const mailboxPath = join(projectionsDir, PROJECTIONS_MAILBOX_FILE);
  const artifactsPath = join(projectionsDir, PROJECTIONS_ARTIFACTS_FILE);
  const views = replayAll([]);
  const coreAuthored = toCoreAuthoredSpec(args.authored);
  const evidencePacket = buildFailedEvidencePacket({
    authored: args.authored,
    summary: args.summary,
  });
  const usageSummary = buildUsageSummary({
    authored: coreAuthored,
    evidencePacket,
    usage: {
      totalInputTokens: 0,
      totalOutputTokens: 0,
      totalCostUsd: 0,
      byActor: new Map(),
      perTurn: [],
      usageStatus: 'unavailable',
      reportedBy: 'paseo.usageEstimate',
      estimated: false,
    },
    evidencePacketPath,
  });

  await mkdir(projectionsDir, { recursive: true });
  await writeFile(eventsPath, toJsonl([]), 'utf8');
  await writeFile(tasksPath, JSON.stringify(views.task.tasks, null, 2), 'utf8');
  await writeFile(mailboxPath, toJsonl(views.mailbox.messages), 'utf8');
  await writeFile(artifactsPath, JSON.stringify(evidencePacket.artifacts, null, 2), 'utf8');
  await writeFile(evidencePacketPath, JSON.stringify(evidencePacket, null, 2), 'utf8');
  await writeFile(
    finalReportPath,
    renderFinalReport({
      runId: args.authored.runId,
      status: evidencePacket.status,
      summary: evidencePacket.summary,
      evidence: views.evidence,
      tasks: views.task,
      mailbox: views.mailbox,
      artifacts: evidencePacket.artifacts,
    }),
    'utf8',
  );
  await writeFile(usageSummaryPath, JSON.stringify(usageSummary, null, 2), 'utf8');

  return writeTranscripts(args.runDir, args.transcriptByActor);
}

function toExitCode(status: V2BridgeResult['status']): 0 | 1 {
  return status === 'succeeded' ? 0 : 1;
}

function normalizeBridgeStatus(status: unknown): V2BridgeResult['status'] {
  return status === 'succeeded' || status === 'failed' || status === 'cancelled' ? status : 'failed';
}

function normalizeSummary(summary: unknown): string | null {
  return typeof summary === 'string' || summary === null ? summary : String(summary ?? '');
}

function errorSummary(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

type ZodIssueLike = {
  readonly code?: unknown;
  readonly keys?: unknown;
  readonly path?: unknown;
};

function zodIssuesOf(error: unknown): ReadonlyArray<ZodIssueLike> {
  if (typeof error !== 'object' || error === null || !('issues' in error)) {
    return [];
  }

  const { issues } = error as { issues?: unknown };
  return Array.isArray(issues) ? issues as ReadonlyArray<ZodIssueLike> : [];
}

function firstUnsupportedField(error: unknown): string | null {
  for (const issue of zodIssuesOf(error)) {
    if (issue.code === 'unrecognized_keys') {
      if (Array.isArray(issue.keys)) {
        const firstKey = issue.keys.find((key): key is string => typeof key === 'string' && key.length > 0);
        if (firstKey) {
          return firstKey;
        }
      }

      if (Array.isArray(issue.path)) {
        const fieldPath = issue.path.filter((segment): segment is string | number => typeof segment === 'string' || typeof segment === 'number');
        if (fieldPath.length > 0) {
          return fieldPath.join('.');
        }
      }
    }
  }

  return null;
}

function formatBridgeError(error: unknown): string {
  if (classifyPaseoError(error) === 'spec_invalid') {
    const field = firstUnsupportedField(error);
    if (field) {
      return `v2 AuthoredSpec does not support v1.6-only field ${field}; recover legacy specs from the legacy-v1.6-harness-prototype branch.`;
    }
  }

  return errorSummary(error);
}

async function writeTranscriptsBestEffort(
  runDir: string,
  transcriptByActor: ReadonlyMap<string, string>,
): Promise<ReadonlyArray<string>> {
  try {
    return await writeTranscripts(runDir, transcriptByActor);
  } catch {
    return [];
  }
}

function logRunArtifactWriteFailure(stderr: NodeJS.WritableStream, error: unknown): void {
  stderr.write(`best_effort_run_dir_write_failed: ${errorSummary(error)}\n`);
}

export async function runViaV2Bridge(
  input: V2BridgeInput,
  deps: V2BridgeDeps,
): Promise<V2BridgeResult> {
  const promptByTitle = new Map<string, string>();
  const specByTitle = new Map<string, PaseoAgentSpec>();
  const transcriptByActor = new Map<string, string>();
  let authored = fallbackAuthoredSpec(input.specPath);
  let runDir = resolveRunDir(input, authored.runId);
  let evidencePacketPath = join(runDir, EVIDENCE_PACKET_FILE);
  let transcriptPaths: ReadonlyArray<string> = [];
  let status: V2BridgeResult['status'] = 'failed';
  let summary: string | null = null;
  let exitCode: V2BridgeResult['exitCode'] = 1;
  let result: Awaited<ReturnType<typeof runPaseo>> | null = null;

  try {
    authored = deps.loadAuthoredSpec(input.specPath);
    runDir = resolveRunDir(input, authored.runId);
    evidencePacketPath = join(runDir, EVIDENCE_PACKET_FILE);
    const rawClient = deps.makePaseoCliClient({
      cwd: input.workspaceCwd,
      ...(input.paseoHost ? { host: input.paseoHost } : {}),
      ...(input.paseoBin ? { bin: input.paseoBin } : {}),
    });
    const client = wrapPaseoClient(rawClient, promptByTitle, transcriptByActor);
    const adapter = deps.makePaseoAdapter({
      idProvider: deps.defaultIdProvider,
      clockProvider: deps.defaultClockProvider,
    });

    result = await deps.runPaseo(authored, adapter, {
      client,
      idProvider: deps.defaultIdProvider,
      clockProvider: deps.defaultClockProvider,
      paseoAgentSpec: (actor, handoff) => {
        const spec = buildPaseoAgentSpec(actor, input.workspaceCwd, handoff);
        promptByTitle.set(spec.title, spec.initialPrompt);
        specByTitle.set(spec.title, spec);
        return spec;
      },
      waitTimeoutSec: 600,
      workspaceCwd: input.workspaceCwd,
    });

    status = normalizeBridgeStatus(
      result.evidencePacket.status === 'in_progress' ? 'failed' : result.evidencePacket.status,
    );
    summary = normalizeSummary(result.evidencePacket.summary);
    exitCode = toExitCode(status);
  } catch (error) {
    summary = formatBridgeError(error);
    input.stderr.write(`${summary}\n`);
    status = 'failed';
    exitCode = classifyPaseoError(error) === 'capability_unavailable' ? 2 : 1;
  } finally {
    try {
      transcriptPaths = result
        ? await writeRunArtifacts({
            runDir,
            authored,
            result,
            transcriptByActor,
            specByTitle,
          })
        : await writeFailedRunArtifacts({
            runDir,
            authored,
            summary,
            transcriptByActor,
          });
    } catch (artifactError) {
      logRunArtifactWriteFailure(input.stderr, artifactError);
      transcriptPaths = await writeTranscriptsBestEffort(runDir, transcriptByActor);
    }
  }

  return {
    status,
    summary,
    runDir,
    evidencePacketPath,
    transcriptPaths,
    exitCode,
  };
}
