import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import process from 'node:process';

import { classifyPaseoError } from './v2-cli-bridge-error.js';

type ActorRef =
  | { kind: 'manager' }
  | { kind: 'system' }
  | { kind: 'role'; role: string };

type IdProvider = {
  next(): string;
};

type ClockProvider = {
  nowIso(): string;
};

type PaseoAgentSpec = {
  readonly provider: string;
  readonly model: string;
  readonly mode: string;
  readonly thinking?: string;
  readonly title: string;
  readonly initialPrompt: string;
  readonly labels?: ReadonlyArray<string>;
  readonly cwd?: string;
};

type PaseoCliClient = {
  spawnAgent(spec: PaseoAgentSpec): Promise<{ agentId: string }>;
  sendPrompt(agentId: string, prompt: string): Promise<void>;
  waitIdle(agentId: string, timeoutSec: number): Promise<{ exitCode: number }>;
  readTranscript(agentId: string, tailLines: number): Promise<string>;
  usageEstimate(agentId: string): Promise<unknown>;
  deleteAgent(agentId: string): Promise<void>;
};

type LoadAuthoredSpecFn = (filePath: string) => unknown;

type RunPaseoFn = (
  authored: unknown,
  adapter: unknown,
  options: {
    client: PaseoCliClient;
    idProvider: IdProvider;
    clockProvider: ClockProvider;
    paseoAgentSpec: (actor: ActorRef) => PaseoAgentSpec;
    waitTimeoutSec?: number;
  },
) => Promise<{
  evidencePacket: {
    status: 'succeeded' | 'failed' | 'cancelled' | 'in_progress';
    summary: string | null;
  };
}>;

type MakePaseoCliClientFn = (input: {
  bin?: string;
  host?: string;
  cwd: string;
}) => PaseoCliClient;

type MakePaseoAdapterFn = (input: {
  idProvider: IdProvider;
  clockProvider: ClockProvider;
}) => unknown;

export interface V2BridgeInput {
  readonly specPath: string;
  readonly workspaceCwd: string;
  readonly evidenceOutputDir: string;
  readonly paseoHost?: string;
  readonly paseoBin?: string;
  readonly stderr: NodeJS.WritableStream;
}

export interface V2BridgeResult {
  readonly status: 'succeeded' | 'failed' | 'cancelled';
  readonly summary: string | null;
  readonly evidencePacketPath: string;
  readonly transcriptPaths: ReadonlyArray<string>;
  readonly exitCode: 0 | 1 | 2;
}

export interface V2BridgeDeps {
  readonly loadAuthoredSpec: LoadAuthoredSpecFn;
  readonly runPaseo: RunPaseoFn;
  readonly makePaseoCliClient: MakePaseoCliClientFn;
  readonly makePaseoAdapter: MakePaseoAdapterFn;
  readonly defaultIdProvider: IdProvider;
  readonly defaultClockProvider: ClockProvider;
}

const EVIDENCE_PACKET_FILE = 'evidence-packet.json';
const TRANSCRIPT_DIR = 'paseo-transcripts';

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

function buildPaseoAgentSpec(actor: ActorRef, workspaceCwd: string): PaseoAgentSpec {
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
  evidenceOutputDir: string,
  transcriptByActor: ReadonlyMap<string, string>,
): Promise<ReadonlyArray<string>> {
  const transcriptDir = join(evidenceOutputDir, TRANSCRIPT_DIR);
  await mkdir(transcriptDir, { recursive: true });

  const transcriptPaths: string[] = [];
  for (const actorKey of [...transcriptByActor.keys()].sort()) {
    const transcriptPath = join(transcriptDir, `${actorKey}.txt`);
    await writeFile(transcriptPath, transcriptByActor.get(actorKey) ?? '', 'utf8');
    transcriptPaths.push(transcriptPath);
  }

  return transcriptPaths;
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
      return `v2 AuthoredSpec does not support v1.6-only field ${field}; use --runtime=v1 for legacy specs.`;
    }
  }

  return errorSummary(error);
}

async function writeTranscriptsBestEffort(
  evidenceOutputDir: string,
  transcriptByActor: ReadonlyMap<string, string>,
): Promise<ReadonlyArray<string>> {
  try {
    return await writeTranscripts(evidenceOutputDir, transcriptByActor);
  } catch {
    return [];
  }
}

export async function runViaV2Bridge(
  input: V2BridgeInput,
  deps: V2BridgeDeps,
): Promise<V2BridgeResult> {
  const evidencePacketPath = join(input.evidenceOutputDir, EVIDENCE_PACKET_FILE);
  const promptByTitle = new Map<string, string>();
  const transcriptByActor = new Map<string, string>();

  try {
    const authored = deps.loadAuthoredSpec(input.specPath);
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

    const result = await deps.runPaseo(authored, adapter, {
      client,
      idProvider: deps.defaultIdProvider,
      clockProvider: deps.defaultClockProvider,
      paseoAgentSpec: (actor) => {
        const spec = buildPaseoAgentSpec(actor, input.workspaceCwd);
        promptByTitle.set(spec.title, spec.initialPrompt);
        return spec;
      },
      waitTimeoutSec: 600,
    });

    await mkdir(input.evidenceOutputDir, { recursive: true });
    await writeFile(evidencePacketPath, JSON.stringify(result.evidencePacket, null, 2), 'utf8');
    const transcriptPaths = await writeTranscripts(input.evidenceOutputDir, transcriptByActor);

    const status = normalizeBridgeStatus(
      result.evidencePacket.status === 'in_progress' ? 'failed' : result.evidencePacket.status,
    );

    return {
      status,
      summary: normalizeSummary(result.evidencePacket.summary),
      evidencePacketPath,
      transcriptPaths,
      exitCode: toExitCode(status),
    };
  } catch (error) {
    const transcriptPaths = await writeTranscriptsBestEffort(input.evidenceOutputDir, transcriptByActor);
    const summary = formatBridgeError(error);
    input.stderr.write(`${summary}\n`);
    return {
      status: 'failed',
      summary,
      evidencePacketPath,
      transcriptPaths,
      exitCode: classifyPaseoError(error) === 'capability_unavailable' ? 2 : 1,
    };
  }
}
