import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import { replayAll } from '@pluto/v2-core';

import { assembleEvidencePacket } from '../../src/evidence/evidence-packet.js';
import { translateLegacyEvents } from '../../src/legacy/v1-translator.js';

const FIXTURE_DIR = new URL(
  '../../../../tests/fixtures/live-smoke/86557df1-0b4a-4bd4-8a75-027a4dcd5d38/',
  import.meta.url,
);

const legacyEvents = readFileSync(new URL('./events.jsonl', FIXTURE_DIR), 'utf8')
  .trim()
  .split('\n')
  .map((line) => JSON.parse(line) as Record<string, unknown>);

const legacyPacket = JSON.parse(readFileSync(new URL('./evidence-packet.json', FIXTURE_DIR), 'utf8')) as {
  runId: string;
  kind: string;
  status: string;
  summary: string | null;
  generatedAt: string;
  artifactRefs: unknown[];
};

describe('hello-team parity', () => {
  it('matches the legacy evidence packet row-by-row for the in-scope parity rows', () => {
    const translated = translateLegacyEvents(legacyEvents);
    const packet = assembleEvidencePacket(replayAll(translated), translated, legacyPacket.runId);
    const legacyArtifactEventCount = legacyEvents.filter((event) => event.type === 'artifact_created').length;

    expect(packet.runId).toBe(legacyPacket.runId);
    expect(packet.kind).toBe(legacyPacket.kind);
    expect(packet.status).toBe(legacyPacket.status);
    expect(packet.summary).toBe(legacyPacket.summary);
    expect(packet.artifacts).toHaveLength(legacyArtifactEventCount);
    expect(Number.isNaN(Date.parse(packet.generatedAt))).toBe(false);
    expect(Number.isNaN(Date.parse(legacyPacket.generatedAt))).toBe(false);
  });
});
