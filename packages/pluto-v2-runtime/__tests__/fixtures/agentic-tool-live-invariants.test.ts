import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import type { RunEvent } from '@pluto/v2-core';

import { EvidencePacketShape, type EvidencePacket } from '../../src/evidence/evidence-packet.js';

type UsageSummary = {
  totalTurns: number;
  usageStatus: 'reported' | 'unavailable' | string;
};

const REPO_ROOT = fileURLToPath(new URL('../../../../', import.meta.url));
const FIXTURES_ROOT = join(REPO_ROOT, 'tests', 'fixtures', 'live-smoke');
const MANIFEST_PATH = join(FIXTURES_ROOT, 'agentic-tool-live-runid.txt');
const SCENARIO_PATH = join(
  REPO_ROOT,
  'packages',
  'pluto-v2-runtime',
  'test-fixtures',
  'scenarios',
  'hello-team-agentic-tool-mock',
  'scenario.yaml',
);
const TOOL_LANE_SOURCE_PATH = join(
  REPO_ROOT,
  'packages',
  'pluto-v2-runtime',
  'src',
  'adapters',
  'paseo',
  'run-paseo.ts',
);
const RETIRED_PARSER_PATH = join(
  REPO_ROOT,
  'packages',
  'pluto-v2-runtime',
  'src',
  'adapters',
  'paseo',
  'paseo-directive.ts',
);
const MUTATING_EVENT_KINDS = new Set([
  'task_created',
  'task_state_changed',
  'mailbox_message_appended',
  'artifact_published',
  'run_completed',
]);

function readRunId(): string {
  return readFileSync(MANIFEST_PATH, 'utf8').trim();
}

function parseJsonLines<T>(filePath: string): T[] {
  return readFileSync(filePath, 'utf8')
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .map((line) => JSON.parse(line) as T);
}

describe('agentic_tool live smoke invariants', () => {
  it('matches the expected live-run contract', () => {
    expect(existsSync(MANIFEST_PATH)).toBe(true);

    const runId = readRunId();
    const fixtureDir = join(FIXTURES_ROOT, runId);
    const events = parseJsonLines<RunEvent>(join(fixtureDir, 'events.jsonl'));
    const evidencePacket = JSON.parse(readFileSync(join(fixtureDir, 'evidence-packet.json'), 'utf8')) as EvidencePacket;
    const usageSummary = JSON.parse(readFileSync(join(fixtureDir, 'usage-summary.json'), 'utf8')) as UsageSummary;
    const authoredSpecText = readFileSync(join(fixtureDir, 'authored-spec.yaml'), 'utf8').trim();
    const scenarioText = readFileSync(SCENARIO_PATH, 'utf8').trim();
    const playbookText = readFileSync(join(fixtureDir, 'playbook.md'), 'utf8');
    const playbookSha = readFileSync(join(fixtureDir, 'playbook.sha256'), 'utf8').trim();
    const serializedEvents = JSON.stringify(events);
    const acceptedMutations = events.filter((event) =>
      event.outcome === 'accepted' && MUTATING_EVENT_KINDS.has(event.kind),
    );
    const leadMutations = acceptedMutations.filter((event) => event.actor.kind === 'role' && event.actor.role === 'lead');
    const subActorMutations = acceptedMutations.filter((event) => event.actor.kind === 'role' && event.actor.role !== 'lead');

    expect(EvidencePacketShape.parse(evidencePacket)).toEqual(evidencePacket);
    expect(evidencePacket.status).toBe('succeeded');
    expect(events.at(-1)?.kind).toBe('run_completed');
    expect(events.filter((event) => event.kind === 'run_completed')).toHaveLength(1);
    expect(leadMutations.length).toBeGreaterThanOrEqual(2);
    expect(subActorMutations.length).toBeGreaterThanOrEqual(1);
    expect(events.some((event) =>
      event.kind === 'mailbox_message_appended'
      && event.outcome === 'accepted'
      && event.payload.toActor.kind === 'role'
      && event.payload.toActor.role === 'lead'
      && (event.payload.kind === 'completion' || event.payload.kind === 'final'),
    )).toBe(true);
    expect(serializedEvents).not.toContain('multi_fence_rejection');
    expect(serializedEvents).not.toContain('parse_repair_attempt');
    expect(serializedEvents).not.toContain('```json');
    expect(existsSync(RETIRED_PARSER_PATH)).toBe(false);
    expect(readFileSync(TOOL_LANE_SOURCE_PATH, 'utf8')).not.toContain('paseo-directive');
    expect(usageSummary.usageStatus === 'reported' || usageSummary.usageStatus === 'unavailable').toBe(true);
    expect(authoredSpecText).toBe(scenarioText);
    expect(playbookSha).toBe(createHash('sha256').update(playbookText).digest('hex'));
    expect(usageSummary.totalTurns).toBeLessThanOrEqual(50);
  });

  it.skip('records pluto-tool invocations instead of curl or mcporter in the captured transcript fixture', () => {
    const runId = readRunId();
    const fixtureDir = join(FIXTURES_ROOT, runId, 'paseo-transcripts');
    const leadTranscript = readFileSync(join(fixtureDir, 'role:lead.txt'), 'utf8');

    expect(leadTranscript).toContain('pluto-tool');
    expect(leadTranscript).not.toContain('curl');
    expect(leadTranscript).not.toContain('mcporter');
  });
});
