import { readFileSync } from 'node:fs';
import { extname } from 'node:path';

import { AuthoredSpecSchema, type AuthoredSpec } from '@pluto/v2-core';
import yaml from 'js-yaml';

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

export function loadAuthoredSpec(filePath: string): AuthoredSpec {
  const content = readFileSync(filePath, 'utf8');
  return parseAuthoredSpec(content, filePath);
}
