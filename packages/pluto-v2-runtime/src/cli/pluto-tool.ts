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
  readonly format: OutputFormat;
  readonly method: 'GET' | 'POST';
  readonly path: string;
  readonly body?: unknown;
};

type ParsedCli = ParsedHelp | ParsedCommand;

export type PlutoToolRuntimeEnv = {
  readonly apiUrl: string;
  readonly token: string;
  readonly actor: string;
};

const COMMANDS: ReadonlyArray<CommandName> = [
  'create-task',
  'change-task-state',
  'send-mailbox',
  'publish-artifact',
  'complete-run',
  'read-state',
  'read-artifact',
  'read-transcript',
];

const GLOBAL_HELP = [
  'Usage: pluto-tool <command> [flags]',
  '',
  'Commands:',
  '  create-task',
  '  change-task-state',
  '  send-mailbox',
  '  publish-artifact',
  '  complete-run',
  '  read-state',
  '  read-artifact',
  '  read-transcript',
  '',
  'Flags:',
  '  --format=json|text  Output format (default: json)',
  '  --help              Show help',
].join('\n');

const HELP_BY_COMMAND: Record<CommandName, string> = {
  'create-task': 'Usage: pluto-tool create-task --owner=<role|manager> --title=<text> [--depends-on=<id>...] [--format=json|text]',
  'change-task-state': 'Usage: pluto-tool change-task-state --task-id=<id> --to=<state> [--format=json|text]',
  'send-mailbox': 'Usage: pluto-tool send-mailbox --to=<role|manager> --kind=<kind> --body=<text|@path> [--format=json|text]',
  'publish-artifact': 'Usage: pluto-tool publish-artifact --kind=<final|intermediate> --media-type=<mime> --byte-size=<n> [--body=<text|@path>] [--format=json|text]',
  'complete-run': 'Usage: pluto-tool complete-run --status=<succeeded|failed|cancelled> --summary=<text> [--format=json|text]',
  'read-state': 'Usage: pluto-tool read-state [--format=json|text]',
  'read-artifact': 'Usage: pluto-tool read-artifact --artifact-id=<id> [--format=json|text]',
  'read-transcript': 'Usage: pluto-tool read-transcript --actor-key=<key> [--format=json|text]',
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
  return {
    apiUrl: normalizeApiUrl(requireEnv('PLUTO_RUN_API_URL', env)),
    token: requireEnv('PLUTO_RUN_TOKEN', env),
    actor: requireEnv('PLUTO_RUN_ACTOR', env),
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

export async function parseCliArgs(argv: readonly string[]): Promise<ParsedCli> {
  const [commandToken, ...rest] = argv;
  if (commandToken == null || commandToken === '--help') {
    return {
      kind: 'help',
      text: GLOBAL_HELP,
    };
  }

  if (!isCommandName(commandToken)) {
    throw new Error(`Unknown command: ${commandToken}`);
  }

  const { format, help, flags } = parseFlagTokens(rest);
  if (help) {
    return {
      kind: 'help',
      text: HELP_BY_COMMAND[commandToken],
    };
  }

  switch (commandToken) {
    case 'create-task': {
      const owner = parseActorFlag(requireOne(flags, 'owner', commandToken), '--owner');
      const title = requireOne(flags, 'title', commandToken);
      const dependsOn = takeMany(flags, 'depends-on');
      assertKnownFlags(flags, commandToken);
      return {
        kind: 'command',
        name: commandToken,
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
        format,
        method: 'POST',
        path: '/tools/complete-run',
        body: { status, summary },
      };
    }
    case 'read-state':
      assertKnownFlags(flags, commandToken);
      return {
        kind: 'command',
        name: commandToken,
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
      'Pluto-Run-Actor': env.actor,
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
          const error = (data as { error?: { message?: string; code?: string } }).error;
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
    case 'read-artifact':
      return JSON.stringify(result, null, 2);
    case 'read-transcript':
      return JSON.stringify(result, null, 2);
    case 'read-state':
      return JSON.stringify(result, null, 2);
  }
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
    const result = await callApi(runtimeEnv, parsed);
    if (parsed.format === 'text') {
      io.stdout.write(`${textSummary(parsed, result.data)}\n`);
      return 0;
    }

    io.stdout.write(`${JSON.stringify(result.data, null, 2)}\n`);
    return 0;
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
