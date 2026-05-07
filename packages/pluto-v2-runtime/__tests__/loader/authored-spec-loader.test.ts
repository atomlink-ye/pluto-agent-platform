import { mkdtempSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { describe, expect, it } from 'vitest';

import { loadAuthoredSpec } from '../../src/index.js';

const FIXTURE_PATH = new URL('../../test-fixtures/scenarios/hello-team/scenario.yaml', import.meta.url).pathname;

describe('loadAuthoredSpec', () => {
  it('loads the hello-team fixture', () => {
    const authored = loadAuthoredSpec(FIXTURE_PATH);

    expect(authored.fakeScript).toHaveLength(5);
    expect(authored.declaredActors).toContain('manager');
  });

  it('rejects multi-document yaml', () => {
    const tempDir = mkdtempSync(join(tmpdir(), 'pluto-v2-runtime-loader-'));
    const filePath = join(tempDir, 'multi-doc.yaml');

    writeFileSync(filePath, ['runId: a', '---', 'runId: b'].join('\n'), 'utf8');

    expect(() => loadAuthoredSpec(filePath)).toThrow(/exactly one YAML document|single YAML document/);
  });

  it('rejects unsafe yaml tags', () => {
    const tempDir = mkdtempSync(join(tmpdir(), 'pluto-v2-runtime-loader-'));
    const filePath = join(tempDir, 'unsafe.yaml');

    writeFileSync(filePath, 'runId: !!js/function >\n  function nope() {}\n', 'utf8');

    expect(() => loadAuthoredSpec(filePath)).toThrow(/Unsafe YAML tags/);
  });

  it('rejects complete_run fakeScript without a declared manager', () => {
    const tempDir = mkdtempSync(join(tmpdir(), 'pluto-v2-runtime-loader-'));
    const filePath = join(tempDir, 'no-manager.yaml');

    writeFileSync(
      filePath,
      [
        'runId: run-1',
        'scenarioRef: scenario/hello-team',
        'runProfileRef: fake-smoke',
        'actors:',
        '  lead:',
        '    kind: role',
        '    role: lead',
        'declaredActors:',
        '  - lead',
        'fakeScript:',
        '  - actor:',
        '      kind: manager',
        '    intent: complete_run',
        '    payload:',
        '      status: succeeded',
        '      summary: done',
      ].join('\n'),
      'utf8',
    );

    expect(() => loadAuthoredSpec(filePath)).toThrow(/manager in declaredActors/);
  });
});
