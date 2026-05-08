import { readFileSync } from 'node:fs';
import { extname } from 'node:path';

import { AuthoredSpecSchema, type AuthoredSpec } from '@pluto/v2-core';
import yaml from 'js-yaml';

import { resolvePlaybookSync } from './playbook-resolver.js';

function parseSerializedSpec(filePath: string, content: string): unknown {
  if (extname(filePath) === '.json') {
    return JSON.parse(content);
  }

  try {
    return yaml.load(content, { schema: yaml.FAILSAFE_SCHEMA });
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

export function parseAuthoredSpec(content: string, filePath = '<inline>'): AuthoredSpec {
  const authored = AuthoredSpecSchema.parse(parseSerializedSpec(filePath, content));
  assertManagerDeclaredForCompleteRun(authored);
  assertAgenticLoaderRequirements(authored, filePath);
  return authored;
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

function assertAgenticLoaderRequirements(authored: AuthoredSpec, filePath: string): void {
  if (authored.orchestration?.mode !== 'agentic') {
    return;
  }

  if (!authored.declaredActors.includes('lead')) {
    throw new Error('agentic declaredActors must include lead');
  }

  const leadActor = authored.actors.lead;
  if (leadActor == null || leadActor.kind !== 'role' || leadActor.role !== 'lead') {
    throw new Error('agentic actors.lead must be { kind: "role", role: "lead" }');
  }

  if (!authored.declaredActors.includes('manager')) {
    throw new Error('agentic declaredActors must include manager');
  }

  const managerActor = authored.actors.manager;
  if (managerActor == null || managerActor.kind !== 'manager') {
    throw new Error('agentic actors.manager must be { kind: "manager" }');
  }

  if (authored.userTask == null || authored.userTask.trim().length === 0) {
    throw new Error('agentic userTask must be non-empty');
  }

  if (authored.playbookRef == null || authored.playbookRef.trim().length === 0) {
    throw new Error('agentic playbookRef must be a non-empty markdown path');
  }

  const playbookRef = authored.playbookRef.trim();
  if (!playbookRef.toLowerCase().endsWith('.md')) {
    throw new Error('agentic playbookRef must reference a markdown file');
  }

  resolvePlaybookSync({
    specPath: filePath === '<inline>' ? `${process.cwd()}/inline-spec.yaml` : filePath,
    playbookRef,
  });
}

export function loadAuthoredSpec(filePath: string): AuthoredSpec {
  const content = readFileSync(filePath, 'utf8');
  return parseAuthoredSpec(content, filePath);
}
