#!/usr/bin/env node
import { readFile } from 'node:fs/promises';
import process from 'node:process';
import { pathToFileURL } from 'node:url';

import {
  ACTOR_ROLE_VALUES,
  ARTIFACT_PUBLISHED_KIND_VALUES,
  MAILBOX_MESSAGE_KIND_VALUES,
  RUN_COMPLETED_STATUS_VALUES,
  TASK_STATE_VALUES,
  type ActorRef,
} from '@pluto/v2-core';

type OutputFormat = 'json' | 'text';

type CommandName =
  | 'create-task'
  | 'change-task-state'
  | 'send-mailbox'
  | 'publish-artifact'
  | 'complete-run'
  | 'wait'
  | 'read-state'
  | 'read-artifact'
  | 'read-transcript';

type ParsedHelp = {
  readonly kind: 'help';
  readonly text: string;
};

type ParsedCommand = {
  readonly kind: 'command';
  readonly name: CommandName;
  readonly actor?: string;
  readonly requiresActor: boolean;
  readonly format: OutputFormat;
  readonly method: 'GET' | 'POST';
  readonly path: string;
  readonly body?: unknown;
};

type ParsedCli = ParsedHelp | ParsedCommand;

export type PlutoToolRuntimeEnv = {
  readonly apiUrl: string;
  readonly token: string;
  readonly actor?: string;
};

type ParsedGlobalFlags = {
  readonly actor?: string;
  readonly help: boolean;
  readonly commandToken?: string;
  readonly rest: readonly string[];
};

const COMMANDS: ReadonlyArray<CommandName> = [
  'create-task',
  'change-task-state',
  'send-mailbox',
  'publish-artifact',
  'complete-run',
  'wait',
  'read-state',
  'read-artifact',
  'read-transcript',
];

const GLOBAL_HELP = [
  'Usage: pluto-tool [--actor <key>] <command> [flags]',
  '',
  'Commands:',
  '  create-task',
  '  change-task-state',
  '  send-mailbox',
  '  publish-artifact',
  '  complete-run',
  '  wait',
  '  read-state',
  '  read-artifact',
  '  read-transcript',
  '',
  'Flags:',
  '  --actor <key>       Explicit actor key (required for mutating commands)',
  '  --format=json|text  Output format (default: json)',
  '  --help              Show help',
].join('\n');

const HELP_BY_COMMAND: Record<CommandName, string> = {
  'create-task': 'Usage: pluto-tool --actor <key> create-task --owner=<role|manager> --title=<text> [--depends-on=<id>...] [--format=json|text]',
  'change-task-state': 'Usage: pluto-tool --actor <key> change-task-state --task-id=<id> --to=<state> [--format=json|text]',
  'send-mailbox': 'Usage: pluto-tool --actor <key> send-mailbox --to=<role|manager> --kind=<kind> --body=<text|@path> [--format=json|text]',
  'publish-artifact': 'Usage: pluto-tool --actor <key> publish-artifact --kind=<final|intermediate> --media-type=<mime> --byte-size=<n> [--body=<text|@path>] [--format=json|text]',
  'complete-run': 'Usage: pluto-tool --actor <key> complete-run --status=<succeeded|failed|cancelled> --summary=<text> [--format=json|text]',
  'wait': 'Usage: pluto-tool --actor <key> wait [--timeout-sec=<0-1200>] [--format=json|text]',
  'read-state': 'Usage: pluto-tool [--actor <key>] read-state [--format=json|text]',
  'read-artifact': 'Usage: pluto-tool [--actor <key>] read-artifact --artifact-id=<id> [--format=json|text]',
  'read-transcript': 'Usage: pluto-tool [--actor <key>] read-transcript --actor-key=<key> [--format=json|text]',
};

function isCommandName(value: string): value is CommandName {
  return COMMANDS.includes(value as CommandName);
}

function roleActor(role: string): ActorRef | null {
  if (!(ACTOR_ROLE_VALUES as readonly string[]).includes(role)) {
    return null;
  }

  return {
    kind: 'role',
    role: role as (typeof ACTOR_ROLE_VALUES)[number],
  };
}

function actorKey(actor: ActorRef): string {
  switch (actor.kind) {
    case 'manager':
      return 'manager';
    case 'system':
      return 'system';
    case 'role':
      return `role:${actor.role}`;
    default:
      throw new Error(`Unsupported actor kind: ${(actor as { kind: string }).kind}`);
  }
}

function parseActorFlag(value: string, flagName: string): ActorRef {
  if (value === 'manager') {
    return { kind: 'manager' };
  }

  const fromPlainRole = roleActor(value);
  if (fromPlainRole != null) {
    return fromPlainRole;
  }

  if (value.startsWith('role:')) {
    const fromPrefixedRole = roleActor(value.slice('role:'.length));
    if (fromPrefixedRole != null) {
      return fromPrefixedRole;
    }
  }

  throw new Error(`${flagName} must be one of: manager, ${ACTOR_ROLE_VALUES.join(', ')}`);
}

function parseSessionActorKey(value: string, flagName: string): string {
  const normalized = value.trim();
  if (normalized === 'manager') {
    return 'manager';
  }

  if (normalized === 'system') {
    return 'system';
  }

  const actor = parseActorFlag(normalized, flagName);
  return actorKey(actor);
}

function normalizeApiUrl(value: string): string {
  return value.endsWith('/') ? value.slice(0, -1) : value;
}

function requireEnv(name: string, env: NodeJS.ProcessEnv): string {
  const value = env[name];
  if (typeof value === 'string' && value.trim().length > 0) {
    return value;
  }

  throw new Error(
    `Missing ${name}. Pluto runtime sessions are expected to set PLUTO_RUN_API_URL, PLUTO_RUN_TOKEN, and PLUTO_RUN_ACTOR automatically.`,
  );
}

export function readRuntimeEnv(env: NodeJS.ProcessEnv = process.env): PlutoToolRuntimeEnv {
  const actor = env.PLUTO_RUN_ACTOR;
  return {
    apiUrl: normalizeApiUrl(requireEnv('PLUTO_RUN_API_URL', env)),
    token: requireEnv('PLUTO_RUN_TOKEN', env),
    ...(typeof actor === 'string' && actor.trim().length > 0 ? { actor } : {}),
  };
}

function parseGlobalFlags(argv: readonly string[]): ParsedGlobalFlags {
  let actor: string | undefined;
  let help = false;

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token == null) {
      break;
    }

    if (!token.startsWith('--')) {
      return {
        actor,
        help,
        commandToken: token,
        rest: argv.slice(index + 1),
      };
    }

    if (token === '--help') {
      help = true;
      continue;
    }

    if (token === '--actor') {
      const value = argv[index + 1];
      if (value == null || value.startsWith('--')) {
        throw new Error('Missing value for --actor');
      }
      if (actor != null) {
        throw new Error('--actor may only be provided once');
      }
      actor = parseSessionActorKey(value, '--actor');
      index += 1;
      continue;
    }

    if (token.startsWith('--actor=')) {
      if (actor != null) {
        throw new Error('--actor may only be provided once');
      }
      actor = parseSessionActorKey(token.slice('--actor='.length), '--actor');
      continue;
    }

    throw new Error(`Unexpected global flag: ${token}`);
  }

  return {
    actor,
    help,
    rest: [],
  };
}

function parseFlagTokens(tokens: readonly string[]): {
  format: OutputFormat;
  help: boolean;
  flags: Map<string, string[]>;
} {
  let format: OutputFormat = 'json';
  let help = false;
  const flags = new Map<string, string[]>();

  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index];
    if (token == null) {
      break;
    }
    if (token === '--help') {
      help = true;
      continue;
    }

    if (!token.startsWith('--')) {
      throw new Error(`Unexpected positional argument: ${token}`);
    }

    const flag = token.slice(2);
    const equalsIndex = flag.indexOf('=');
    const key = equalsIndex >= 0 ? flag.slice(0, equalsIndex) : flag;
    const inlineValue = equalsIndex >= 0 ? flag.slice(equalsIndex + 1) : undefined;
    const value = inlineValue ?? tokens[index + 1];

    if (key === 'format') {
      if (value !== 'json' && value !== 'text') {
        throw new Error('--format must be json or text');
      }
      format = value;
      if (inlineValue === undefined) {
        index += 1;
      }
      continue;
    }

    if (value == null || value.startsWith('--')) {
      throw new Error(`Missing value for --${key}`);
    }

    const existing = flags.get(key) ?? [];
    existing.push(value);
    flags.set(key, existing);

    if (inlineValue === undefined) {
      index += 1;
    }
  }

  return { format, help, flags };
}

function takeOne(flags: Map<string, string[]>, key: string): string | undefined {
  const values = flags.get(key);
  if (values == null || values.length === 0) {
    return undefined;
  }

  flags.delete(key);
  if (values.length !== 1) {
    throw new Error(`--${key} may only be provided once`);
  }

  return values[0];
}

function takeMany(flags: Map<string, string[]>, key: string): string[] {
  const values = flags.get(key) ?? [];
  flags.delete(key);
  return values;
}

function assertKnownFlags(flags: Map<string, string[]>, command: CommandName): void {
  if (flags.size === 0) {
    return;
  }

  throw new Error(`Unknown flags for ${command}: ${[...flags.keys()].map((key) => `--${key}`).join(', ')}`);
}

async function readBodyValue(value: string): Promise<string> {
  if (!value.startsWith('@')) {
    return value;
  }

  return readFile(value.slice(1), 'utf8');
}

function requireOne(flags: Map<string, string[]>, key: string, command: CommandName): string {
  const value = takeOne(flags, key);
  if (value != null) {
    return value;
  }

  throw new Error(`${command} requires --${key}`);
}

function parsePositiveInteger(value: string, flagName: string): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 0) {
    throw new Error(`${flagName} must be a non-negative integer`);
  }

  return parsed;
}

function parseWaitTimeoutSec(value: string): number {
  const parsed = parsePositiveInteger(value, '--timeout-sec');
  if (parsed > 1200) {
    throw new Error('--timeout-sec must be 1200 or less');
  }

  return parsed;
}

export async function parseCliArgs(argv: readonly string[]): Promise<ParsedCli> {
  const parsedGlobals = parseGlobalFlags(argv);
  if (parsedGlobals.commandToken == null) {
    return {
      kind: 'help',
      text: GLOBAL_HELP,
    };
  }

  const { actor: globalActor, commandToken, help: globalHelp, rest } = parsedGlobals;

  if (!isCommandName(commandToken)) {
    throw new Error(`Unknown command: ${commandToken}`);
  }

  if (globalHelp) {
    return {
      kind: 'help',
      text: HELP_BY_COMMAND[commandToken],
    };
  }

  const { format, help, flags } = parseFlagTokens(rest);
  if (help) {
    return {
      kind: 'help',
      text: HELP_BY_COMMAND[commandToken],
    };
  }

  const actorFlag = takeOne(flags, 'actor');
  const requestedActor = actorFlag == null
    ? globalActor
    : (() => {
        const parsedActor = parseSessionActorKey(actorFlag, '--actor');
        if (globalActor != null) {
          throw new Error('--actor may only be provided once');
        }
        return parsedActor;
      })();

  switch (commandToken) {
    case 'create-task': {
      const owner = parseActorFlag(requireOne(flags, 'owner', commandToken), '--owner');
      const title = requireOne(flags, 'title', commandToken);
      const dependsOn = takeMany(flags, 'depends-on');
      assertKnownFlags(flags, commandToken);
      return {
        kind: 'command',
        name: commandToken,
        actor: requestedActor,
        requiresActor: true,
        format,
        method: 'POST',
        path: '/tools/create-task',
        body: {
          title,
          ownerActor: owner,
          dependsOn,
        },
      };
    }
    case 'change-task-state': {
      const taskId = requireOne(flags, 'task-id', commandToken);
      const to = requireOne(flags, 'to', commandToken);
      if (!(TASK_STATE_VALUES as readonly string[]).includes(to)) {
        throw new Error(`--to must be one of: ${TASK_STATE_VALUES.join(', ')}`);
      }
      assertKnownFlags(flags, commandToken);
      return {
        kind: 'command',
        name: commandToken,
        actor: requestedActor,
        requiresActor: true,
        format,
        method: 'POST',
        path: '/tools/change-task-state',
        body: { taskId, to },
      };
    }
    case 'send-mailbox': {
      const toActor = parseActorFlag(requireOne(flags, 'to', commandToken), '--to');
      const kind = requireOne(flags, 'kind', commandToken);
      if (!(MAILBOX_MESSAGE_KIND_VALUES as readonly string[]).includes(kind)) {
        throw new Error(`--kind must be one of: ${MAILBOX_MESSAGE_KIND_VALUES.join(', ')}`);
      }
      const body = await readBodyValue(requireOne(flags, 'body', commandToken));
      assertKnownFlags(flags, commandToken);
      return {
        kind: 'command',
        name: commandToken,
        actor: requestedActor,
        requiresActor: true,
        format,
        method: 'POST',
        path: '/tools/append-mailbox-message',
        body: { toActor, kind, body },
      };
    }
    case 'publish-artifact': {
      const kind = requireOne(flags, 'kind', commandToken);
      if (!(ARTIFACT_PUBLISHED_KIND_VALUES as readonly string[]).includes(kind)) {
        throw new Error(`--kind must be one of: ${ARTIFACT_PUBLISHED_KIND_VALUES.join(', ')}`);
      }
      const mediaType = requireOne(flags, 'media-type', commandToken);
      const byteSize = parsePositiveInteger(requireOne(flags, 'byte-size', commandToken), '--byte-size');
      const bodyValue = takeOne(flags, 'body');
      assertKnownFlags(flags, commandToken);
      return {
        kind: 'command',
        name: commandToken,
        actor: requestedActor,
        requiresActor: true,
        format,
        method: 'POST',
        path: '/tools/publish-artifact',
        body: {
          kind,
          mediaType,
          byteSize,
          ...(bodyValue == null ? {} : { body: await readBodyValue(bodyValue) }),
        },
      };
    }
    case 'complete-run': {
      const status = requireOne(flags, 'status', commandToken);
      if (!(RUN_COMPLETED_STATUS_VALUES as readonly string[]).includes(status)) {
        throw new Error(`--status must be one of: ${RUN_COMPLETED_STATUS_VALUES.join(', ')}`);
      }
      const summary = requireOne(flags, 'summary', commandToken);
      assertKnownFlags(flags, commandToken);
      return {
        kind: 'command',
        name: commandToken,
        actor: requestedActor,
        requiresActor: true,
        format,
        method: 'POST',
        path: '/tools/complete-run',
        body: { status, summary },
      };
    }
    case 'wait': {
      const timeoutSecRaw = takeOne(flags, 'timeout-sec');
      assertKnownFlags(flags, commandToken);
      return {
        kind: 'command',
        name: commandToken,
        actor: requestedActor,
        requiresActor: true,
        format,
        method: 'POST',
        path: '/tools/wait-for-event',
        body: {
          timeoutSec: timeoutSecRaw == null ? 300 : parseWaitTimeoutSec(timeoutSecRaw),
        },
      };
    }
    case 'read-state':
      assertKnownFlags(flags, commandToken);
      return {
        kind: 'command',
        name: commandToken,
        actor: requestedActor,
        requiresActor: true,
        format,
        method: 'GET',
        path: '/state',
      };
    case 'read-artifact': {
      const artifactId = requireOne(flags, 'artifact-id', commandToken);
      assertKnownFlags(flags, commandToken);
      return {
        kind: 'command',
        name: commandToken,
        actor: requestedActor,
        requiresActor: false,
        format,
        method: 'GET',
        path: `/artifacts/${encodeURIComponent(artifactId)}`,
      };
    }
    case 'read-transcript': {
      const actorKey = requireOne(flags, 'actor-key', commandToken);
      assertKnownFlags(flags, commandToken);
      return {
        kind: 'command',
        name: commandToken,
        actor: requestedActor,
        requiresActor: false,
        format,
        method: 'GET',
        path: `/transcripts/${encodeURIComponent(actorKey)}`,
      };
    }
  }
}

type ApiResult = {
  readonly data: unknown;
  readonly contentType: string;
};

async function callApi(env: PlutoToolRuntimeEnv, command: ParsedCommand): Promise<ApiResult> {
  const response = await fetch(`${env.apiUrl}${command.path}`, {
    method: command.method,
    headers: {
      authorization: `Bearer ${env.token}`,
      ...(env.actor == null ? {} : { 'Pluto-Run-Actor': env.actor }),
      ...(command.body === undefined ? {} : { 'content-type': 'application/json' }),
    },
    ...(command.body === undefined ? {} : { body: JSON.stringify(command.body) }),
  });
  const text = await response.text();
  const contentType = response.headers.get('content-type') ?? '';
  const data = contentType.includes('application/json') && text.length > 0 ? JSON.parse(text) : text;

  if (!response.ok) {
    const message = typeof data === 'string'
      ? data
        : (() => {
          const error = (data as { error?: { message?: string; code?: string; detail?: string } }).error;
          if (error?.code && error.detail) {
            return `${error.code}: ${error.detail}`;
          }
          if (error?.code && error.message) {
            return `${error.code}: ${error.message}`;
          }
          if (error?.message) {
            return error.message;
          }
          return `HTTP ${response.status}`;
        })();
    throw new Error(message);
  }

  return { data, contentType };
}

function resolveActorForCommand(parsed: ParsedCommand, runtimeEnv: PlutoToolRuntimeEnv): string | undefined {
  const candidate = parsed.actor ?? runtimeEnv.actor;
  if (candidate == null || candidate.trim().length === 0) {
    if (parsed.requiresActor) {
      throw new Error('missing_actor: pass --actor <key> or set PLUTO_RUN_ACTOR');
    }
    return undefined;
  }

  return parseSessionActorKey(candidate, parsed.actor == null ? 'PLUTO_RUN_ACTOR' : '--actor');
}

function withActorEnvelope(actor: string, data: unknown): unknown {
  if (data != null && typeof data === 'object' && !Array.isArray(data)) {
    return {
      actor,
      ...(data as Record<string, unknown>),
    };
  }

  return {
    actor,
    value: data,
  };
}

function shouldWrapJsonResult(command: ParsedCommand): boolean {
  return command.name !== 'wait';
}

function textSummary(command: ParsedCommand, result: unknown): string {
  if (typeof result === 'string') {
    return result;
  }

  if (command.name === 'read-state') {
    return JSON.stringify(result, null, 2);
  }

  const record = result as Record<string, unknown>;
  switch (command.name) {
    case 'create-task':
      return record.accepted === true
        ? `task created: ${String(record.taskId ?? '')}`.trim()
        : `task rejected: ${String(record.reason ?? 'unknown')}`;
    case 'change-task-state':
      return record.accepted === true ? 'task state updated' : `task update rejected: ${String(record.reason ?? 'unknown')}`;
    case 'send-mailbox':
      return record.accepted === true ? 'mailbox message sent' : `mailbox message rejected: ${String(record.reason ?? 'unknown')}`;
    case 'publish-artifact':
      return record.accepted === true
        ? `artifact published: ${String(record.artifactId ?? '')}`.trim()
        : `artifact publish rejected: ${String(record.reason ?? 'unknown')}`;
    case 'complete-run':
      return record.accepted === true ? 'run completed' : `run completion rejected: ${String(record.reason ?? 'unknown')}`;
    case 'wait':
      if (record.outcome === 'event') {
        return `event received: ${String((record.latestEvent as { kind?: string })?.kind ?? 'unknown')}`;
      }
      if (record.outcome === 'timeout') {
        return 'wait timed out';
      }
      return `wait cancelled: ${String(record.reason ?? 'unknown')}`;
    case 'read-artifact':
      return JSON.stringify(result, null, 2);
    case 'read-transcript':
      return JSON.stringify(result, null, 2);
  }
}

function isCancelledWaitResult(command: ParsedCommand, result: unknown): boolean {
  return command.name === 'wait'
    && result != null
    && typeof result === 'object'
    && (result as { outcome?: unknown }).outcome === 'cancelled';
}

export async function runCli(
  argv: readonly string[],
  env: NodeJS.ProcessEnv = process.env,
  io: Pick<typeof process, 'stdout' | 'stderr'> = process,
): Promise<number> {
  try {
    const parsed = await parseCliArgs(argv);
    if (parsed.kind === 'help') {
      io.stdout.write(`${parsed.text}\n`);
      return 0;
    }

    const runtimeEnv = readRuntimeEnv(env);
    const actor = resolveActorForCommand(parsed, runtimeEnv);
    const result = await callApi({
      ...runtimeEnv,
      ...(actor == null ? {} : { actor }),
    }, parsed);
    if (parsed.format === 'text') {
      io.stdout.write(`${textSummary(parsed, result.data)}\n`);
      return isCancelledWaitResult(parsed, result.data) ? 1 : 0;
    }

    io.stdout.write(`${JSON.stringify(
      actor == null || !shouldWrapJsonResult(parsed)
        ? result.data
        : withActorEnvelope(actor, result.data),
      null,
      2,
    )}\n`);
    return isCancelledWaitResult(parsed, result.data) ? 1 : 0;
  } catch (error) {
    io.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    return 1;
  }
}

const isEntrypoint = process.argv[1] != null && import.meta.url === pathToFileURL(process.argv[1]).href;

if (isEntrypoint) {
  const exitCode = await runCli(process.argv.slice(2));
  process.exitCode = exitCode;
}
