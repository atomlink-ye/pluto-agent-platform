#!/usr/bin/env node
import { access, readFile, readdir } from 'node:fs/promises';
import { basename, join, relative, resolve } from 'node:path';
import process from 'node:process';
import { pathToFileURL } from 'node:url';

import {
  ActorRoleSchema,
  CANONICAL_AUTHORITY_POLICY,
  ArtifactPublishedPayloadSchema,
  MailboxProjectionMessageSchema,
  RunEventSchema,
  TaskProjectionViewStateSchema,
  actorKey,
  initialState,
  reduce,
  replayAll,
  type ActorRef,
  type MailboxProjectionMessage,
  type RunEvent,
  type RunState,
  type TaskProjectionTask,
  type TeamContext,
} from '@pluto/v2-core';
import { z } from 'zod';

import { EvidencePacketShape, type EvidencePacket, type RuntimeDiagnostics } from '../evidence/evidence-packet.js';
import { parseAuthoredSpec } from '../loader/authored-spec-loader.js';

type CommandName = 'replay' | 'explain' | 'audit';
type OutputFormat = 'json' | 'text';
type WarningSink = (message: string) => void;

type ParsedHelp = {
  readonly kind: 'help';
  readonly text: string;
};

type ParsedCommand = {
  readonly kind: 'command';
  readonly name: CommandName;
  readonly runId: string;
  readonly format: OutputFormat;
  readonly runDir?: string;
};

type ParsedCli = ParsedHelp | ParsedCommand;

type ProjectionLayout = {
  readonly runDir: string;
  readonly eventsPath: string;
  readonly tasksPath: string | null;
  readonly mailboxPath: string | null;
  readonly artifactsPath: string | null;
  readonly evidencePacketPath: string | null;
  readonly finalReconciliationPath: string | null;
  readonly runStatePath: string | null;
  readonly artifactDir: string | null;
};

type JsonMap = Record<string, unknown>;

type ReplayDrift = {
  readonly path: string;
  readonly replayed: unknown;
  readonly projection: unknown;
};

type ReplaySummary = {
  readonly runId: string;
  readonly runDir: string;
  readonly projectionPath: string;
  readonly state: Pick<RunState, 'runId' | 'sequence' | 'status'>;
  readonly drift: ReplayDrift | null;
};

type ExplainTaskHistoryEntry = {
  readonly at: string | null;
  readonly from: string;
  readonly to: string;
};

type ExplainTask = {
  readonly taskId: string;
  readonly state: string;
  readonly owner: string;
  readonly summary: string;
  readonly dependsOn: readonly string[];
  readonly history: readonly ExplainTaskHistoryEntry[];
};

type ExplainMailboxMessage = {
  readonly messageId: string;
  readonly from: string;
  readonly to: string;
  readonly kind: string;
  readonly timestamp: string | null;
  readonly body: string;
};

type ExplainArtifact = {
  readonly artifactId: string;
  readonly kind: string;
  readonly ref: string;
  readonly byteSize: number;
};

type ExplainOutput = {
  readonly runId: string;
  readonly runDir: string;
  readonly metadata: {
    readonly startedAt: string | null;
    readonly finishedAt: string | null;
    readonly status: string;
    readonly durationMs: number | null;
    readonly durationText: string | null;
    readonly turnCount: number | null;
    readonly eventCount: number;
    readonly summary: string | null;
  };
  readonly actors: readonly string[];
  readonly tasks: readonly ExplainTask[];
  readonly tasksDriftDetected: boolean;
  readonly mailboxByActor: readonly {
    readonly actor: string;
    readonly messages: readonly ExplainMailboxMessage[];
  }[];
  readonly citations: readonly EvidencePacket['citations'][number][];
  readonly artifacts: readonly ExplainArtifact[];
  readonly runtimeDiagnostics: RuntimeDiagnostics | null;
  readonly finalReconciliation: JsonMap | null;
  readonly failureClassification: string | null;
  readonly failureClassificationSource: 'structured' | 'summary' | 'none';
};

type Io = {
  readonly stdout: Pick<NodeJS.WritableStream, 'write'>;
  readonly stderr: Pick<NodeJS.WritableStream, 'write'>;
};

type TaskProjectionMap = z.infer<typeof TaskProjectionViewStateSchema>['tasks'];
type ArtifactProjection = z.infer<typeof ArtifactProjectionSchema>;
type SpecContext = Pick<TeamContext, 'declaredActors' | 'initialTasks'>;

const COMMANDS: readonly CommandName[] = ['replay', 'explain', 'audit'];
const DEFAULT_RUN_ROOT = join('.pluto', 'runs');
const MAX_BODY_PREVIEW = 120;
const SPEC_FILE_CANDIDATES = [
  'authored-spec.yaml',
  'spec.yaml',
  'spec.yml',
  'spec.json',
  'scenario.yaml',
  'scenario.yml',
  'scenario.json',
] as const;

const HELP_TEXT = [
  'Usage: pluto:runs <command> <runId> [flags]',
  '',
  'Commands:',
  '  replay   Re-derive the run state from events.jsonl and compare it to the task projection',
  '  explain  Print a readable run narrative (or JSON with --format=json)',
  '  audit    Report final-reconciliation audit pass / failed_audit; exit 0/1/2',
  '',
  'Flags:',
  '  --run-dir <path>      Use an explicit run directory (or a parent containing <runId>)',
  '  --format=json|text    Output format for explain (default: text)',
  '  --help                Show help',
].join('\n');

const ArtifactProjectionSchema = z.array(ArtifactPublishedPayloadSchema);
const RunStateRunIdSchema = z.object({
  runId: z.string(),
}).passthrough();

const noopWarn: WarningSink = () => {};

function isCommandName(value: string): value is CommandName {
  return COMMANDS.includes(value as CommandName);
}

function toClosedActorRef(
  actor:
    | ActorRef
    | { readonly kind: 'manager' | 'system' }
    | { readonly kind: 'role'; readonly role: string }
    | null
    | undefined,
): ActorRef | null {
  if (actor == null) {
    return null;
  }

  if (actor.kind !== 'role') {
    return actor;
  }

  return ActorRoleSchema.safeParse(actor.role).success ? actor as ActorRef : null;
}

function cloneAuthorityPolicy(): TeamContext['policy'] {
  const cloneMatcher = <T extends Record<string, unknown>>(matcher: T): T => {
    const transitions = (matcher as { transitions?: unknown }).transitions;
    if (Array.isArray(transitions)) {
      return {
        ...matcher,
        transitions: [...transitions],
      } as T;
    }

    return { ...matcher };
  };

  return {
    append_mailbox_message: CANONICAL_AUTHORITY_POLICY.append_mailbox_message.map(cloneMatcher),
    create_task: CANONICAL_AUTHORITY_POLICY.create_task.map(cloneMatcher),
    change_task_state: CANONICAL_AUTHORITY_POLICY.change_task_state.map(cloneMatcher),
    publish_artifact: CANONICAL_AUTHORITY_POLICY.publish_artifact.map(cloneMatcher),
    complete_run: CANONICAL_AUTHORITY_POLICY.complete_run.map(cloneMatcher),
  };
}

function actorLabel(actor: ActorRef | { readonly kind: 'broadcast' }): string {
  return actor.kind === 'broadcast' ? 'broadcast' : actorKey(actor);
}

function truncateBody(body: string): string {
  const normalized = body.replace(/\s+/g, ' ').trim();
  if (normalized.length <= MAX_BODY_PREVIEW) {
    return normalized;
  }

  return `${normalized.slice(0, MAX_BODY_PREVIEW - 3)}...`;
}

function toDurationText(durationMs: number | null): string | null {
  if (durationMs == null || Number.isNaN(durationMs) || durationMs < 0) {
    return null;
  }

  if (durationMs < 1000) {
    return `${durationMs} ms`;
  }

  const totalSeconds = Math.floor(durationMs / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  const parts = [
    hours > 0 ? `${hours}h` : null,
    minutes > 0 ? `${minutes}m` : null,
    `${seconds}s`,
  ].filter((value): value is string => value != null);
  return parts.join(' ');
}

function toComparable(value: unknown): unknown {
  if (value instanceof Set) {
    return [...value].sort();
  }

  if (Array.isArray(value)) {
    return value.map((entry) => toComparable(entry));
  }

  if (value != null && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, entry]) => [key, toComparable(entry)]),
    );
  }

  return value;
}

function firstDiff(replayed: unknown, projection: unknown, path = 'tasks'): ReplayDrift | null {
  if (Object.is(replayed, projection)) {
    return null;
  }

  if (Array.isArray(replayed) && Array.isArray(projection)) {
    const length = Math.max(replayed.length, projection.length);
    for (let index = 0; index < length; index += 1) {
      if (index >= replayed.length || index >= projection.length) {
        return {
          path: `${path}[${index}]`,
          replayed: replayed[index],
          projection: projection[index],
        };
      }

      const diff = firstDiff(replayed[index], projection[index], `${path}[${index}]`);
      if (diff) {
        return diff;
      }
    }

    return null;
  }

  if (replayed != null && projection != null && typeof replayed === 'object' && typeof projection === 'object') {
    const leftRecord = replayed as Record<string, unknown>;
    const rightRecord = projection as Record<string, unknown>;
    const keys = [...new Set([...Object.keys(leftRecord), ...Object.keys(rightRecord)])].sort();
    for (const key of keys) {
      if (!(key in leftRecord) || !(key in rightRecord)) {
        return {
          path: `${path}.${key}`,
          replayed: leftRecord[key],
          projection: rightRecord[key],
        };
      }

      const diff = firstDiff(leftRecord[key], rightRecord[key], `${path}.${key}`);
      if (diff) {
        return diff;
      }
    }

    return null;
  }

  return { path, replayed, projection };
}

function parseCliArgs(argv: readonly string[]): ParsedCli {
  if (argv.includes('--help')) {
    return { kind: 'help', text: HELP_TEXT };
  }

  const commandToken = argv[0];
  if (commandToken == null || !isCommandName(commandToken)) {
    throw new Error('expected command: replay, explain, or audit');
  }

  const runId = argv[1]?.trim();
  if (!runId) {
    throw new Error(`${commandToken} requires <runId>`);
  }

  let format: OutputFormat = 'text';
  let runDir: string | undefined;

  for (let index = 2; index < argv.length; index += 1) {
    const token = argv[index];
    if (token == null) {
      break;
    }

    if (token === '--format') {
      const value = argv[index + 1];
      if (value !== 'json' && value !== 'text') {
        throw new Error('--format must be json or text');
      }
      format = value;
      index += 1;
      continue;
    }

    if (token.startsWith('--format=')) {
      const value = token.slice('--format='.length);
      if (value !== 'json' && value !== 'text') {
        throw new Error('--format must be json or text');
      }
      format = value;
      continue;
    }

    if (token === '--run-dir') {
      const value = argv[index + 1];
      if (value == null || value.trim().length === 0) {
        throw new Error('--run-dir requires a value');
      }
      runDir = value;
      index += 1;
      continue;
    }

    if (token.startsWith('--run-dir=')) {
      const value = token.slice('--run-dir='.length).trim();
      if (value.length === 0) {
        throw new Error('--run-dir requires a value');
      }
      runDir = value;
      continue;
    }

    throw new Error(`unknown flag: ${token}`);
  }

  return {
    kind: 'command',
    name: commandToken,
    runId,
    format,
    ...(runDir ? { runDir } : {}),
  };
}

async function pathExists(filePath: string): Promise<boolean> {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function firstExistingPath(candidates: readonly string[]): Promise<string | null> {
  for (const candidate of candidates) {
    if (await pathExists(candidate)) {
      return candidate;
    }
  }

  return null;
}

async function resolveRunDir(runId: string, override: string | undefined, cwd = process.cwd()): Promise<string> {
  if (override == null) {
    return join(resolve(cwd), DEFAULT_RUN_ROOT, runId);
  }

  const explicit = resolve(override);
  if (await pathExists(join(explicit, 'events.jsonl'))) {
    return explicit;
  }

  const nested = join(explicit, runId);
  if (await pathExists(join(nested, 'events.jsonl'))) {
    return nested;
  }

  return explicit;
}

async function discoverLayout(runId: string, override: string | undefined): Promise<ProjectionLayout> {
  const runDir = await resolveRunDir(runId, override);
  return {
    runDir,
    eventsPath: join(runDir, 'events.jsonl'),
    tasksPath: await firstExistingPath([
      join(runDir, 'projections', 'tasks.json'),
      join(runDir, 'state', 'tasks.json'),
      join(runDir, 'tasks.json'),
    ]),
    mailboxPath: await firstExistingPath([
      join(runDir, 'projections', 'mailbox.jsonl'),
      join(runDir, 'state', 'mailbox.jsonl'),
      join(runDir, 'mailbox.jsonl'),
    ]),
    artifactsPath: await firstExistingPath([
      join(runDir, 'projections', 'artifacts.json'),
      join(runDir, 'state', 'artifacts.json'),
      join(runDir, 'artifacts.json'),
    ]),
    evidencePacketPath: await firstExistingPath([join(runDir, 'evidence-packet.json')]),
    finalReconciliationPath: await firstExistingPath([join(runDir, 'evidence', 'final-reconciliation.json')]),
    runStatePath: await firstExistingPath([join(runDir, 'state', 'run-state.json')]),
    artifactDir: (await pathExists(join(runDir, 'artifacts'))) ? join(runDir, 'artifacts') : null,
  };
}

async function readJsonLines<T>(filePath: string, schema: z.ZodType<T>): Promise<T[]> {
  const raw = await readFile(filePath, 'utf8');
  return raw
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .map((line, index) => {
      try {
        return schema.parse(JSON.parse(line));
      } catch (error) {
        throw new Error(`${basename(filePath)}:${index + 1} ${error instanceof Error ? error.message : String(error)}`);
      }
    });
}

async function readJsonFile<T>(filePath: string, schema: z.ZodType<T>): Promise<T> {
  return schema.parse(JSON.parse(await readFile(filePath, 'utf8')));
}

function parseTaskProjection(input: unknown): TaskProjectionMap {
  const direct = TaskProjectionViewStateSchema.shape.tasks.safeParse(input);
  if (direct.success) {
    return direct.data;
  }

  const wrapped = TaskProjectionViewStateSchema.safeParse(input);
  if (wrapped.success) {
    return wrapped.data.tasks;
  }

  throw new Error('tasks projection must be a task map or { tasks } object');
}

async function readTaskProjection(filePath: string): Promise<TaskProjectionMap> {
  return parseTaskProjection(JSON.parse(await readFile(filePath, 'utf8')));
}

async function maybeReadMailbox(filePath: string | null): Promise<MailboxProjectionMessage[]> {
  if (filePath == null) {
    return [];
  }

  return readJsonLines(filePath, MailboxProjectionMessageSchema);
}

async function maybeReadArtifacts(filePath: string | null): Promise<ArtifactProjection> {
  if (filePath == null) {
    return [];
  }

  return readJsonFile(filePath, ArtifactProjectionSchema);
}

async function maybeReadEvidencePacket(filePath: string | null): Promise<EvidencePacket | null> {
  if (filePath == null) {
    return null;
  }

  const parsed = await readJsonFile(filePath, EvidencePacketShape);
  return {
    ...parsed,
    initiatingActor: parsed.initiatingActor ?? null,
  };
}

async function maybeReadFinalReconciliation(filePath: string | null): Promise<JsonMap | null> {
  if (filePath == null) {
    return null;
  }

  const parsed = JSON.parse(await readFile(filePath, 'utf8'));
  if (parsed == null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('final-reconciliation evidence must be a JSON object');
  }

  return parsed as JsonMap;
}

function collectInferredActors(events: readonly RunEvent[]): ActorRef[] {
  const actors = new Map<string, ActorRef>();
  const pushActor = (value: ActorRef | null | undefined) => {
    if (value != null) {
      actors.set(actorKey(value), value);
    }
  };

  for (const event of events) {
    pushActor(event.actor);

    if (event.kind === 'task_created') {
      pushActor(event.payload.ownerActor);
      continue;
    }

    if (event.kind === 'mailbox_message_appended') {
      pushActor(event.payload.fromActor);
      if (event.payload.toActor.kind !== 'broadcast') {
        pushActor(event.payload.toActor);
      }
    }
  }

  return [...actors.values()].sort((left, right) => actorKey(left).localeCompare(actorKey(right)));
}

function toWarning(message: string): string {
  return `WARNING: ${message}`;
}

async function maybeReadSpecContext(runDir: string, warn: WarningSink = noopWarn): Promise<SpecContext | null> {
  for (const candidate of SPEC_FILE_CANDIDATES) {
    const specPath = join(runDir, candidate);
    if (!(await pathExists(specPath))) {
      continue;
    }

    try {
      const authored = parseAuthoredSpec(await readFile(specPath, 'utf8'), specPath);
      const declaredActors = authored.declaredActors
        .map((actorName) => toClosedActorRef(authored.actors[actorName]))
        .filter((actor): actor is ActorRef => actor != null);

      return {
        declaredActors,
        initialTasks: (authored.initialTasks ?? []).map((task) => ({
          taskId: task.taskId,
          title: task.title,
          ownerActor: task.ownerActor == null ? null : toClosedActorRef(authored.actors[task.ownerActor]),
          dependsOn: task.dependsOn,
        })),
      };
    } catch (error) {
      warn(
        toWarning(
          `unable to parse ${relative(runDir, specPath)} for replay context recovery; falling back to inferred actors (${error instanceof Error ? error.message : String(error)})`,
        ),
      );
    }
  }

  return null;
}

async function reconstructTeamContext(
  runDir: string,
  events: readonly RunEvent[],
  warn: WarningSink = noopWarn,
): Promise<TeamContext> {
  const runStarted = events.find((event): event is Extract<RunEvent, { kind: 'run_started' }> => event.kind === 'run_started');
  if (runStarted == null) {
    throw new Error('events.jsonl is missing run_started');
  }

  const specContext = await maybeReadSpecContext(runDir, warn);
  return {
    runId: runStarted.runId,
    scenarioRef: runStarted.payload.scenarioRef,
    runProfileRef: runStarted.payload.runProfileRef,
    declaredActors: specContext?.declaredActors ?? collectInferredActors(events),
    initialTasks: specContext?.initialTasks ?? [],
    policy: cloneAuthorityPolicy(),
  };
}

async function runIdFromStateFile(filePath: string | null): Promise<string | null> {
  if (filePath == null) {
    return null;
  }

  try {
    const parsed = RunStateRunIdSchema.safeParse(JSON.parse(await readFile(filePath, 'utf8')));
    return parsed.success ? parsed.data.runId : null;
  } catch {
    return null;
  }
}

async function assertRunIdMatches(
  expectedRunId: string,
  layout: ProjectionLayout,
  events: readonly RunEvent[],
  warn: WarningSink = noopWarn,
): Promise<void> {
  const runIdFromState = await runIdFromStateFile(layout.runStatePath);
  if (runIdFromState != null) {
    if (runIdFromState !== expectedRunId) {
      throw new Error(`RUN_ID_MISMATCH: expected ${expectedRunId}, found ${runIdFromState}`);
    }
    return;
  }

  const runIdFromEvents = events[0]?.runId ?? null;
  if (typeof runIdFromEvents === 'string' && runIdFromEvents.length > 0) {
    if (runIdFromEvents !== expectedRunId) {
      throw new Error(`RUN_ID_MISMATCH: expected ${expectedRunId}, found ${runIdFromEvents}`);
    }
    return;
  }

  warn(toWarning(`unable to verify runId for ${layout.runDir}; continuing without mismatch check`));
}

function taskHistoryIndex(events: readonly RunEvent[]): ReadonlyMap<string, readonly ExplainTaskHistoryEntry[]> {
  const histories = new Map<string, ExplainTaskHistoryEntry[]>();

  for (const event of events) {
    if (event.kind !== 'task_state_changed') {
      continue;
    }

    const entries = histories.get(event.payload.taskId) ?? [];
    entries.push({
      at: event.timestamp,
      from: event.payload.from,
      to: event.payload.to,
    });
    histories.set(event.payload.taskId, entries);
  }

  return histories;
}

function toExplainTasks(
  taskSource: TaskProjectionMap,
  histories: ReadonlyMap<string, readonly ExplainTaskHistoryEntry[]>,
): readonly ExplainTask[] {
  return Object.entries(taskSource)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([taskId, task]) => ({
      taskId,
      state: task.state,
      owner: task.ownerActor == null ? 'unassigned' : actorLabel(task.ownerActor),
      summary: task.title,
      dependsOn: task.dependsOn,
      history: histories.get(taskId) ?? [],
    }));
}

function recordOf(value: unknown): Record<string, unknown> | null {
  return value != null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function finalReconciliationAuditStatus(finalReconciliation: JsonMap | null): string | null {
  const audit = recordOf(finalReconciliation?.audit);
  return typeof audit?.status === 'string' ? audit.status : null;
}

function hasRuntimeDiagnostics(runtimeDiagnostics: RuntimeDiagnostics | null): boolean {
  return (runtimeDiagnostics?.bridgeUnavailable?.length ?? 0) > 0
    || (runtimeDiagnostics?.taskCloseoutRejected?.length ?? 0) > 0
    || (runtimeDiagnostics?.waitTraces?.length ?? 0) > 0;
}

function classifyFailureFromSummary(status: string, summary: string | null): string | null {
  if (status !== 'failed' && status !== 'cancelled') {
    return null;
  }

  const normalized = summary?.toLowerCase() ?? '';
  if (normalized.includes('timeout') || normalized.includes('timed out')) {
    const taskMatch = summary?.match(/task\s+([A-Za-z0-9-]+)/i);
    return taskMatch ? `task ${taskMatch[1]} timed out` : 'task timed out';
  }

  if (normalized.includes('actor mismatch')) {
    return 'actor mismatch';
  }

  if (normalized.includes('audit')) {
    return 'audit failure';
  }

  return summary?.trim() || `${status} without a summary`;
}

function classifyFailure(args: {
  readonly status: string;
  readonly summary: string | null;
  readonly runtimeDiagnostics: RuntimeDiagnostics | null;
  readonly finalReconciliation: JsonMap | null;
}): { readonly classification: string | null; readonly source: 'structured' | 'summary' | 'none' } {
  if (finalReconciliationAuditStatus(args.finalReconciliation) === 'failed_audit') {
    return {
      classification: 'audit failure',
      source: 'structured',
    };
  }

  const timedOutTrace = args.runtimeDiagnostics?.waitTraces?.find((trace) => trace.kind === 'wait_timed_out');
  if (timedOutTrace?.kind === 'wait_timed_out') {
    return {
      classification: `${timedOutTrace.actor} wait timed out`,
      source: 'structured',
    };
  }

  const rejectedCloseout = args.runtimeDiagnostics?.taskCloseoutRejected?.[0];
  if (rejectedCloseout != null) {
    return {
      classification: `task ${rejectedCloseout.taskId} closeout rejected`,
      source: 'structured',
    };
  }

  const bridgeUnavailable = args.runtimeDiagnostics?.bridgeUnavailable?.[0];
  if (bridgeUnavailable != null) {
    return {
      classification: `bridge unavailable for ${bridgeUnavailable.actor}`,
      source: 'structured',
    };
  }

  const cancelledTrace = args.runtimeDiagnostics?.waitTraces?.find((trace) => trace.kind === 'wait_cancelled');
  if (cancelledTrace?.kind === 'wait_cancelled') {
    return {
      classification: `${cancelledTrace.actor} wait cancelled: ${cancelledTrace.reason}`,
      source: 'structured',
    };
  }

  const summaryClassification = classifyFailureFromSummary(args.status, args.summary);
  if (summaryClassification != null) {
    return {
      classification: summaryClassification,
      source: 'summary',
    };
  }

  return {
    classification: null,
    source: 'none',
  };
}

async function artifactRefFor(layout: ProjectionLayout, artifactId: string): Promise<string> {
  if (layout.artifactDir == null) {
    return artifactId;
  }

  const entries = await readdir(layout.artifactDir);
  const match = entries.find((entry) => entry === `${artifactId}.txt` || entry.startsWith(`${artifactId}.`));
  return match == null ? artifactId : relative(layout.runDir, join(layout.artifactDir, match));
}

function renderTaskHistory(entries: readonly ExplainTaskHistoryEntry[]): string | null {
  const [first, ...rest] = entries;
  if (first == null) {
    return null;
  }

  let rendered = `${first.from} -> ${first.to} (${first.at ?? 'unknown'})`;
  for (const entry of rest) {
    rendered += ` -> ${entry.to} (${entry.at ?? 'unknown'})`;
  }

  return rendered;
}

function appendRuntimeDiagnostics(lines: string[], runtimeDiagnostics: RuntimeDiagnostics | null): void {
  if (!hasRuntimeDiagnostics(runtimeDiagnostics)) {
    return;
  }

  lines.push('', 'Diagnostics');

  for (const entry of runtimeDiagnostics?.bridgeUnavailable ?? []) {
    lines.push(`- bridge_unavailable | actor=${entry.actor} | reason=${entry.reason} | latencyMs=${entry.latencyMs}`);
  }

  for (const entry of runtimeDiagnostics?.taskCloseoutRejected ?? []) {
    lines.push(`- task_closeout_rejected | actor=${entry.actor} | taskId=${entry.taskId} | reason=${entry.reason}`);
  }

  for (const trace of runtimeDiagnostics?.waitTraces ?? []) {
    switch (trace.kind) {
      case 'wait_armed':
        lines.push(`- wait_armed | actor=${trace.actor} | fromSequence=${trace.fromSequence} | at=${trace.armedAt}`);
        break;
      case 'wait_unblocked':
        lines.push(`- wait_unblocked | actor=${trace.actor} | sequence=${trace.sequence} | latencyMs=${trace.latencyMs}`);
        break;
      case 'wait_timed_out':
        lines.push(`- wait_timed_out | actor=${trace.actor} | timeoutMs=${trace.timeoutMs}`);
        break;
      case 'wait_cancelled':
        lines.push(`- wait_cancelled | actor=${trace.actor} | reason=${trace.reason}`);
        break;
    }
  }
}

async function replayRun(
  runId: string,
  override: string | undefined,
  warn: WarningSink = noopWarn,
): Promise<ReplaySummary> {
  const layout = await discoverLayout(runId, override);
  if (!(await pathExists(layout.eventsPath))) {
    throw new Error(`missing events.jsonl at ${layout.eventsPath}`);
  }

  if (layout.tasksPath == null) {
    throw new Error(`missing task projection for ${layout.runDir}`);
  }

  const events = await readJsonLines(layout.eventsPath, RunEventSchema);
  await assertRunIdMatches(runId, layout, events, warn);
  const teamContext = await reconstructTeamContext(layout.runDir, events, warn);
  const projection = await readTaskProjection(layout.tasksPath);
  const replayedViews = replayAll(events);

  let state = initialState(teamContext);
  for (const event of events) {
    state = reduce(state, event);
  }

  return {
    runId,
    runDir: layout.runDir,
    projectionPath: layout.tasksPath,
    state: {
      runId: state.runId,
      sequence: state.sequence,
      status: state.status,
    },
    drift: firstDiff(
      toComparable(replayedViews.task.tasks),
      toComparable(projection),
    ),
  };
}

async function explainRun(
  runId: string,
  override: string | undefined,
  warn: WarningSink = noopWarn,
): Promise<ExplainOutput> {
  const layout = await discoverLayout(runId, override);
  if (!(await pathExists(layout.eventsPath))) {
    throw new Error(`missing events.jsonl at ${layout.eventsPath}`);
  }

  const events = await readJsonLines(layout.eventsPath, RunEventSchema);
  await assertRunIdMatches(runId, layout, events, warn);
  const views = replayAll(events);
  const evidencePacket = await maybeReadEvidencePacket(layout.evidencePacketPath);
  const mailboxProjection = await maybeReadMailbox(layout.mailboxPath);
  const artifactsProjection = await maybeReadArtifacts(layout.artifactsPath);
  const finalReconciliation = await maybeReadFinalReconciliation(layout.finalReconciliationPath);
  const taskProjection = layout.tasksPath == null ? null : await readTaskProjection(layout.tasksPath);

  const replayTasks = views.task.tasks;
  const taskDrift = taskProjection == null
    ? null
    : firstDiff(toComparable(replayTasks), toComparable(taskProjection));
  const taskSource = taskProjection ?? replayTasks;
  const histories = taskHistoryIndex(events);
  const mailboxSource = mailboxProjection.length > 0 ? mailboxProjection : views.mailbox.messages;
  const timestampByMessageId = new Map(
    events
      .filter((event): event is Extract<RunEvent, { kind: 'mailbox_message_appended' }> => event.kind === 'mailbox_message_appended')
      .map((event) => [event.payload.messageId, event.timestamp] as const),
  );

  const tasks = toExplainTasks(taskSource, histories);
  const mailboxEntries = mailboxSource.map((message) => ({
    messageId: message.messageId,
    from: actorLabel(message.fromActor),
    to: actorLabel(message.toActor),
    kind: message.kind,
    timestamp: timestampByMessageId.get(message.messageId) ?? null,
    body: truncateBody(message.body),
  } satisfies ExplainMailboxMessage));
  const mailboxByActor = [...new Set(mailboxEntries.map((message) => message.from))]
    .sort((left, right) => left.localeCompare(right))
    .map((actor) => ({
      actor,
      messages: mailboxEntries.filter((message) => message.from === actor),
    }));

  const artifacts = await Promise.all(
    (artifactsProjection.length > 0 ? artifactsProjection : evidencePacket?.artifacts ?? []).map(async (artifact) => ({
      artifactId: artifact.artifactId,
      kind: artifact.kind,
      ref: await artifactRefFor(layout, artifact.artifactId),
      byteSize: artifact.byteSize,
    } satisfies ExplainArtifact)),
  );

  const runRecord = views.evidence.run;
  const startedAt = evidencePacket?.startedAt ?? runRecord?.startedAt ?? null;
  const finishedAt = evidencePacket?.completedAt ?? runRecord?.completedAt ?? null;
  const durationMs = startedAt != null && finishedAt != null
    ? Date.parse(finishedAt) - Date.parse(startedAt)
    : null;
  const summary = evidencePacket?.summary ?? runRecord?.summary ?? null;
  const status = evidencePacket?.status ?? runRecord?.status ?? 'in_progress';
  const failure = classifyFailure({
    status,
    summary,
    runtimeDiagnostics: evidencePacket?.runtimeDiagnostics ?? null,
    finalReconciliation,
  });

  return {
    runId,
    runDir: layout.runDir,
    metadata: {
      startedAt,
      finishedAt,
      status,
      durationMs,
      durationText: toDurationText(durationMs),
      turnCount: null,
      eventCount: events.length,
      summary,
    },
    actors: collectInferredActors(events).map((actor) => actorLabel(actor)),
    tasks,
    tasksDriftDetected: taskDrift != null,
    mailboxByActor,
    citations: evidencePacket?.citations ?? [],
    artifacts: artifacts.sort((left, right) => left.artifactId.localeCompare(right.artifactId)),
    runtimeDiagnostics: evidencePacket?.runtimeDiagnostics ?? null,
    finalReconciliation,
    failureClassification: failure.classification,
    failureClassificationSource: failure.source,
  };
}

type AuditFailureEntry = {
  readonly kind: string;
  readonly ref: string | null;
};

type AuditOutput = {
  readonly runId: string;
  readonly runDir: string;
  readonly evidencePath: string | null;
  readonly status: 'pass' | 'failed_audit' | 'absent';
  readonly summary: string | null;
  readonly completedTaskIds: readonly string[];
  readonly citedMessageIds: readonly string[];
  readonly citedArtifactRefs: readonly string[];
  readonly unresolvedIssues: readonly string[];
  readonly failures: readonly AuditFailureEntry[];
};

function readStringArray(value: unknown): readonly string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.filter((entry): entry is string => typeof entry === 'string');
}

function readAuditFailures(value: unknown): readonly AuditFailureEntry[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.flatMap((entry) => {
    const record = recordOf(entry);
    if (record == null || typeof record.kind !== 'string') {
      return [];
    }
    return [{
      kind: record.kind,
      ref: typeof record.ref === 'string' ? record.ref : null,
    }];
  });
}

async function auditRun(
  runId: string,
  override: string | undefined,
  warn: WarningSink = noopWarn,
): Promise<AuditOutput> {
  const layout = await discoverLayout(runId, override);
  if (!(await pathExists(layout.eventsPath))) {
    throw new Error(`missing events.jsonl at ${layout.eventsPath}`);
  }

  const events = await readJsonLines(layout.eventsPath, RunEventSchema);
  await assertRunIdMatches(runId, layout, events, warn);

  const finalReconciliation = await maybeReadFinalReconciliation(layout.finalReconciliationPath);
  if (finalReconciliation == null) {
    return {
      runId,
      runDir: layout.runDir,
      evidencePath: layout.finalReconciliationPath,
      status: 'absent',
      summary: null,
      completedTaskIds: [],
      citedMessageIds: [],
      citedArtifactRefs: [],
      unresolvedIssues: [],
      failures: [],
    };
  }

  const auditRecord = recordOf(finalReconciliation.audit);
  const auditStatusRaw = typeof auditRecord?.status === 'string' ? auditRecord.status : null;
  const status: AuditOutput['status'] = auditStatusRaw === 'pass'
    ? 'pass'
    : auditStatusRaw === 'failed_audit'
      ? 'failed_audit'
      : 'absent';

  return {
    runId,
    runDir: layout.runDir,
    evidencePath: layout.finalReconciliationPath,
    status,
    summary: typeof finalReconciliation.summary === 'string' ? finalReconciliation.summary : null,
    completedTaskIds: readStringArray(finalReconciliation.completedTaskIds),
    citedMessageIds: readStringArray(finalReconciliation.citedMessageIds),
    citedArtifactRefs: readStringArray(finalReconciliation.citedArtifactRefs),
    unresolvedIssues: readStringArray(finalReconciliation.unresolvedIssues),
    failures: readAuditFailures(auditRecord?.failures),
  };
}

function renderAuditText(output: AuditOutput): string {
  if (output.status === 'absent') {
    return `ABSENT - no final-reconciliation evidence at ${output.evidencePath ?? '<runDir>/evidence/final-reconciliation.json'}`;
  }

  const header = output.status === 'pass'
    ? 'PASS - final reconciliation audit succeeded'
    : 'FAILED_AUDIT - final reconciliation audit reported failures';

  const lines = [header];
  if (output.summary != null) {
    lines.push(`Summary: ${output.summary}`);
  }
  if (output.completedTaskIds.length > 0) {
    lines.push(`Completed tasks (${output.completedTaskIds.length}): ${output.completedTaskIds.join(', ')}`);
  }
  if (output.citedMessageIds.length > 0) {
    lines.push(`Cited messages (${output.citedMessageIds.length}): ${output.citedMessageIds.join(', ')}`);
  }
  if (output.citedArtifactRefs.length > 0) {
    lines.push(`Cited artifacts (${output.citedArtifactRefs.length}): ${output.citedArtifactRefs.join(', ')}`);
  }
  if (output.unresolvedIssues.length > 0) {
    lines.push(`Unresolved issues (${output.unresolvedIssues.length}):`);
    for (const issue of output.unresolvedIssues) {
      lines.push(`  - ${issue}`);
    }
  }
  if (output.failures.length > 0) {
    lines.push('Failures:');
    for (const failure of output.failures) {
      lines.push(`  - ${failure.kind}${failure.ref ? `: ${failure.ref}` : ''}`);
    }
  }

  return lines.join('\n');
}

function renderReplayText(summary: ReplaySummary): string {
  if (summary.drift == null) {
    return 'PASS - replay matches projection';
  }

  return [
    `DRIFT - replay diverged at field ${summary.drift.path}`,
    `replayed: ${JSON.stringify(summary.drift.replayed)}`,
    `projection: ${JSON.stringify(summary.drift.projection)}`,
  ].join('\n');
}

function renderExplainText(output: ExplainOutput): string {
  const lines = [
    'Run Metadata',
    `- Run ID: ${output.runId}`,
    `- Run Dir: ${output.runDir}`,
    `- Status: ${output.metadata.status}`,
    `- Started: ${output.metadata.startedAt ?? 'unknown'}`,
    `- Finished: ${output.metadata.finishedAt ?? 'unknown'}`,
    `- Duration: ${output.metadata.durationText ?? 'unknown'}`,
    `- Event count: ${output.metadata.eventCount}`,
    `- Turn count: ${output.metadata.turnCount ?? 'unavailable'}`,
    `- Summary: ${output.metadata.summary ?? 'none'}`,
  ];

  if (output.tasksDriftDetected) {
    lines.push('- DRIFT: tasks projection differs from replay-derived tasks');
  }

  lines.push('', 'Actors');
  for (const actor of output.actors) {
    lines.push(`- ${actor}`);
  }

  lines.push('', 'Tasks');
  for (const task of output.tasks) {
    lines.push(`- ${task.taskId}: ${task.state} | owner=${task.owner} | summary=${task.summary}`);
    const history = renderTaskHistory(task.history);
    if (history != null) {
      lines.push(`  ${history}`);
    }
  }

  lines.push('', 'Mailbox');
  for (const group of output.mailboxByActor) {
    lines.push(`- ${group.actor}`);
    for (const message of group.messages) {
      lines.push(`  ${message.from} -> ${message.to} | ${message.kind} | ${message.timestamp ?? 'unknown'}`);
      lines.push(`  ${message.body}`);
    }
  }

  if (output.citations.length > 0) {
    lines.push('', 'Evidence');
    for (const citation of output.citations) {
      lines.push(`- [${citation.kind}] ${citation.text} (${citation.observedAt})`);
    }
  }

  lines.push('', 'Artifacts');
  for (const artifact of output.artifacts) {
    lines.push(`- ${artifact.kind} | ${artifact.ref} | ${artifact.byteSize} bytes`);
  }

  if (output.finalReconciliation != null) {
    lines.push('', 'Final Reconciliation');
    if (typeof output.finalReconciliation.summary === 'string') {
      lines.push(`- Summary: ${output.finalReconciliation.summary}`);
    }
    for (const [key, value] of Object.entries(output.finalReconciliation)) {
      if (key === 'summary') {
        continue;
      }
      lines.push(`- ${key}: ${JSON.stringify(value)}`);
    }
  }

  appendRuntimeDiagnostics(lines, output.runtimeDiagnostics);

  if (output.failureClassification != null) {
    lines.push('', 'Failure Classification');
    lines.push(`- Source: ${output.failureClassificationSource}`);
    lines.push(`- ${output.failureClassification}`);
  }

  return `${lines.join('\n')}\n`;
}

export async function runCli(argv: readonly string[], io: Io = process): Promise<0 | 1 | 2> {
  try {
    const parsed = parseCliArgs(argv);
    if (parsed.kind === 'help') {
      io.stdout.write(`${parsed.text}\n`);
      return 0;
    }

    const warn: WarningSink = (message) => {
      io.stderr.write(`${message}\n`);
    };

    if (parsed.name === 'replay') {
      const summary = await replayRun(parsed.runId, parsed.runDir, warn);
      io.stdout.write(`${renderReplayText(summary)}\n`);
      return summary.drift == null ? 0 : 1;
    }

    if (parsed.name === 'audit') {
      const output = await auditRun(parsed.runId, parsed.runDir, warn);
      io.stdout.write(
        parsed.format === 'json'
          ? `${JSON.stringify(output, null, 2)}\n`
          : `${renderAuditText(output)}\n`,
      );
      if (output.status === 'pass') {
        return 0;
      }
      if (output.status === 'failed_audit') {
        return 1;
      }
      return 2;
    }

    const output = await explainRun(parsed.runId, parsed.runDir, warn);
    io.stdout.write(
      parsed.format === 'json'
        ? `${JSON.stringify(output, null, 2)}\n`
        : renderExplainText(output),
    );
    return 0;
  } catch (error) {
    io.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    return 2;
  }
}

export const __internal = {
  assertRunIdMatches,
  auditRun,
  classifyFailure,
  discoverLayout,
  explainRun,
  firstDiff,
  parseCliArgs,
  replayRun,
  renderAuditText,
  renderExplainText,
  renderReplayText,
  reconstructTeamContext,
  resolveRunDir,
};

const isEntrypoint = process.argv[1] != null && import.meta.url === pathToFileURL(process.argv[1]).href;

if (isEntrypoint) {
  const exitCode = await runCli(process.argv.slice(2));
  process.exitCode = exitCode;
}
