import { readFileSync } from 'node:fs';

import { counterIdProvider, fixedClockProvider, type RunEvent } from '@pluto/v2-core';
import { describe, expect, it } from 'vitest';

import { loadScenarioSpec, runFake } from '../../../src/index.js';

const FIXTURE_DIR = new URL('../../../test-fixtures/scenarios/hello-team/', import.meta.url);
const SCENARIO_PATH = new URL('./scenario.yaml', FIXTURE_DIR).pathname;
const EXPECTED_EVENTS_PATH = new URL('./expected-events.jsonl', FIXTURE_DIR).pathname;
const EXPECTED_PACKET_PATH = new URL('./expected-evidence-packet.json', FIXTURE_DIR).pathname;
const FIXED_TIME = '2026-05-07T00:00:00.000Z';

const readJsonLines = (filePath: string): RunEvent[] =>
  readFileSync(filePath, 'utf8')
    .trim()
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line) as RunEvent);

describe('runFake', () => {
  it('produces deterministic hello-team events twice', () => {
    const authored = loadScenarioSpec(SCENARIO_PATH);
    const first = runFake(authored, {
      idProvider: counterIdProvider(1),
      clockProvider: fixedClockProvider(FIXED_TIME),
    });
    const second = runFake(authored, {
      idProvider: counterIdProvider(1),
      clockProvider: fixedClockProvider(FIXED_TIME),
    });

    expect(JSON.stringify(first.events)).toBe(JSON.stringify(second.events));
    expect(JSON.stringify(first.evidencePacket)).toBe(JSON.stringify(second.evidencePacket));
  });

  it('matches the checked-in hello-team fixtures', () => {
    const authored = loadScenarioSpec(SCENARIO_PATH);
    const result = runFake(authored, {
      idProvider: counterIdProvider(1),
      clockProvider: fixedClockProvider(FIXED_TIME),
    });
    const expectedPacket = JSON.parse(readFileSync(EXPECTED_PACKET_PATH, 'utf8')) as Record<string, unknown>;

    expect(`${result.events.map((event) => JSON.stringify(event)).join('\n')}\n`).toBe(readFileSync(EXPECTED_EVENTS_PATH, 'utf8'));
    expect(result.evidencePacket).toMatchObject(expectedPacket);
    expect(result.evidencePacket.initiatingActor ?? null).toBeNull();
  });
});
