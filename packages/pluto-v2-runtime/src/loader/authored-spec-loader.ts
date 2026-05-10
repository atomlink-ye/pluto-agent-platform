import { readFileSync } from 'node:fs';
import { extname } from 'node:path';

import { AuthoredSpecSchema, actorKey, type ActorRef, type AuthoredSpec } from '@pluto/v2-core';
import yaml from 'js-yaml';

import { resolvePlaybookSync } from './playbook-resolver.js';

type CoreOrchestration = Exclude<AuthoredSpec['orchestration'], undefined>;

export const RUNTIME_ORCHESTRATION_MODE_VALUES = [
  'deterministic',
  'agentic_tool',
] as const;

export type RuntimeOrchestrationMode = (typeof RUNTIME_ORCHESTRATION_MODE_VALUES)[number];

export type RuntimeOrchestration = Omit<CoreOrchestration, 'mode'> & {
  readonly mode?: RuntimeOrchestrationMode;
};

/**
 * Loader-populated playbook metadata for agentic authored specs.
 * `ref` preserves the authored relative reference; `body` and `sha256`
 * come from resolving and reading the markdown file relative to the spec.
 */
export interface LoadedPlaybook {
  readonly ref: string;
  readonly body: string;
  readonly sha256: string;
}

/**
 * Loader output for authored specs. Deterministic specs surface `playbook: null`.
 */
export type LoadedAuthoredSpec = Omit<AuthoredSpec, 'orchestration'> & {
  readonly orchestration?: RuntimeOrchestration;
  readonly playbook: LoadedPlaybook | null;
};

function toRuntimeOrchestrationMode(mode: unknown): RuntimeOrchestrationMode | undefined {
  switch (mode) {
    case 'deterministic':
    case 'agentic_tool':
      return mode;
    default:
      return undefined;
  }
}

function normalizeModeForCore(mode: unknown): unknown {
  const runtimeMode = toRuntimeOrchestrationMode(mode);
  if (runtimeMode === 'agentic_tool') {
    return 'agentic';
  }

  return mode;
}

function normalizeParsedSpecForCore(parsed: unknown): unknown {
  if (parsed == null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return parsed;
  }

  const record = parsed as Record<string, unknown>;
  const orchestration = record.orchestration;
  if (orchestration == null || typeof orchestration !== 'object' || Array.isArray(orchestration)) {
    return parsed;
  }

  return {
    ...record,
    orchestration: {
      ...(orchestration as Record<string, unknown>),
      mode: normalizeModeForCore((orchestration as Record<string, unknown>).mode),
    },
  };
}

function runtimeModeFromParsedSpec(parsed: unknown): RuntimeOrchestrationMode | undefined {
  if (parsed == null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return undefined;
  }

  const orchestration = (parsed as Record<string, unknown>).orchestration;
  if (orchestration == null || typeof orchestration !== 'object' || Array.isArray(orchestration)) {
    return undefined;
  }

  return toRuntimeOrchestrationMode((orchestration as Record<string, unknown>).mode);
}

function isRuntimeAgenticMode(mode: RuntimeOrchestrationMode | undefined): boolean {
  return mode === 'agentic_tool';
}

function parseSerializedSpec(filePath: string, content: string): unknown {
  if (extname(filePath) === '.json') {
    return JSON.parse(content);
  }

  try {
    return yaml.load(content, { schema: yaml.DEFAULT_SCHEMA });
  } catch (error) {
    if (error instanceof Error && /expected a single document in the stream/i.test(error.message)) {
      throw new Error('Expected exactly one YAML document');
    }

    if (error instanceof Error && /unknown tag/i.test(error.message)) {
      throw new Error('Unsafe YAML tags are not allowed');
    }

    throw error;
  }
}

function loadResolvedPlaybook(authored: LoadedAuthoredSpec, filePath: string): LoadedPlaybook | null {
  if (!isRuntimeAgenticMode(authored.orchestration?.mode)) {
    return null;
  }

  const playbookRef = authored.playbookRef?.trim();
  if (!playbookRef) {
    return null;
  }

  const resolved = resolvePlaybookSync({
    specPath: filePath === '<inline>' ? `${process.cwd()}/inline-spec.yaml` : filePath,
    playbookRef,
  });

  return {
    ref: resolved.ref,
    body: resolved.body,
    sha256: resolved.sha256,
  };
}

function toLoadedAuthoredSpec(
  authored: AuthoredSpec,
  filePath: string,
  runtimeMode: RuntimeOrchestrationMode | undefined,
): LoadedAuthoredSpec {
  const loaded = {
    ...authored,
    ...(authored.orchestration == null
      ? {}
      : {
          orchestration: {
            ...authored.orchestration,
            ...(runtimeMode == null ? {} : { mode: runtimeMode }),
          },
        }),
  } as LoadedAuthoredSpec;
  Object.defineProperty(loaded, 'playbook', {
    value: loadResolvedPlaybook(loaded, filePath),
    enumerable: false,
    configurable: false,
    writable: false,
  });
  return loaded;
}

export function parseAuthoredSpec(content: string, filePath = '<inline>'): LoadedAuthoredSpec {
  const parsedSpec = parseSerializedSpec(filePath, content);
  assertOrchestrationModeAllowed(parsedSpec, filePath);
  const runtimeMode = runtimeModeFromParsedSpec(parsedSpec);
  const authored = AuthoredSpecSchema.parse(normalizeParsedSpecForCore(parsedSpec));
  assertManagerDeclaredForCompleteRun(authored);
  assertUniqueActorKeys(authored);
  assertAgenticLoaderRequirements(authored, filePath, runtimeMode);
  return toLoadedAuthoredSpec(authored, filePath, runtimeMode);
}

function assertUniqueActorKeys(authored: AuthoredSpec): void {
  const seenByKey = new Map<string, string>();

  for (const actorName of authored.declaredActors) {
    const actor = authored.actors[actorName] as ActorRef | undefined;
    if (actor == null) {
      continue;
    }

    const key = actorKey(actor);
    const firstActorName = seenByKey.get(key);
    if (firstActorName != null) {
      throw new Error(
        `duplicate_actor_key: declaredActors "${firstActorName}" and "${actorName}" both resolve to actorKey "${key}"`,
      );
    }

    seenByKey.set(key, actorName);
  }
}

function assertOrchestrationModeAllowed(parsed: unknown, filePath: string): void {
  if (parsed == null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return;
  }
  const orchestration = (parsed as Record<string, unknown>).orchestration;
  if (orchestration == null || typeof orchestration !== 'object' || Array.isArray(orchestration)) {
    return;
  }
  const mode = (orchestration as Record<string, unknown>).mode;
  if (mode === undefined) {
    return;
  }
  if (mode !== 'deterministic' && mode !== 'agentic_tool') {
    throw new Error(
      `${filePath}: orchestration.mode '${String(mode)}' is not supported. ` +
        `T4-S4 narrowed the runtime mode union to 'deterministic' | 'agentic_tool' (the legacy 'agentic' / 'agentic_text' lanes are removed).`,
    );
  }
}

function assertManagerDeclaredForCompleteRun(authored: AuthoredSpec): void {
  const usesCompleteRun = authored.fakeScript?.some((step) => step.intent === 'complete_run') ?? false;
  if (!usesCompleteRun) {
    return;
  }

  const managerDeclared = authored.declaredActors.some((actorName) => authored.actors[actorName]?.kind === 'manager');
  if (!managerDeclared) {
    throw new Error('fakeScript complete_run steps require manager in declaredActors');
  }
}

function assertAgenticLoaderRequirements(
  authored: AuthoredSpec,
  filePath: string,
  runtimeMode: RuntimeOrchestrationMode | undefined,
): void {
  if (!isRuntimeAgenticMode(runtimeMode)) {
    return;
  }

  if (!authored.declaredActors.includes('lead')) {
    throw new Error('agentic_tool declaredActors must include lead');
  }

  const leadActor = authored.actors.lead;
  if (leadActor == null || leadActor.kind !== 'role' || leadActor.role !== 'lead') {
    throw new Error('agentic_tool actors.lead must be { kind: "role", role: "lead" }');
  }

  if (!authored.declaredActors.includes('manager')) {
    throw new Error('agentic_tool declaredActors must include manager');
  }

  const managerActor = authored.actors.manager;
  if (managerActor == null || managerActor.kind !== 'manager') {
    throw new Error('agentic_tool actors.manager must be { kind: "manager" }');
  }

  if (authored.userTask == null || authored.userTask.trim().length === 0) {
    throw new Error('agentic_tool userTask must be non-empty');
  }

  if (authored.playbookRef == null || authored.playbookRef.trim().length === 0) {
    throw new Error('agentic_tool playbookRef must be a non-empty markdown path');
  }

  const playbookRef = authored.playbookRef.trim();
  if (!playbookRef.toLowerCase().endsWith('.md')) {
    throw new Error('agentic_tool playbookRef must reference a markdown file');
  }

  resolvePlaybookSync({
    specPath: filePath === '<inline>' ? `${process.cwd()}/inline-spec.yaml` : filePath,
    playbookRef,
  });
}

export function loadAuthoredSpec(filePath: string): LoadedAuthoredSpec {
  const content = readFileSync(filePath, 'utf8');
  return parseAuthoredSpec(content, filePath);
}
