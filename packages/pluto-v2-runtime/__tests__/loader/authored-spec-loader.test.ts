import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { describe, expect, it } from 'vitest';

import { loadAuthoredSpec } from '../../src/index.js';
import { PlaybookResolutionError } from '../../src/loader/playbook-resolver.js';

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

  it('requires declaredActors to include lead in agentic mode', () => {
    const filePath = writeAgenticSpec([
      'declaredActors:',
      '  - manager',
      'actors:',
      '  manager:',
      '    kind: manager',
      '  lead:',
      '    kind: role',
      '    role: lead',
    ]);

    expect(() => loadAuthoredSpec(filePath)).toThrow(/agentic.*declaredActors.*lead/i);
  });

  it('requires declaredActors to include manager in agentic mode', () => {
    const filePath = writeAgenticSpec([
      'declaredActors:',
      '  - lead',
      'actors:',
      '  lead:',
      '    kind: role',
      '    role: lead',
      '  manager:',
      '    kind: manager',
    ]);

    expect(() => loadAuthoredSpec(filePath)).toThrow(/agentic.*declaredActors.*manager/i);
  });

  it('requires actors.lead to have kind role with role lead in agentic mode', () => {
    const filePath = writeAgenticSpec([
      'declaredActors:',
      '  - lead',
      '  - manager',
      'actors:',
      '  lead:',
      '    kind: role',
      '    role: generator',
      '  manager:',
      '    kind: manager',
    ]);

    expect(() => loadAuthoredSpec(filePath)).toThrow(/agentic.*actors\.lead/i);
  });

  it('requires actors.manager to have kind manager in agentic mode', () => {
    const filePath = writeAgenticSpec([
      'declaredActors:',
      '  - lead',
      '  - manager',
      'actors:',
      '  lead:',
      '    kind: role',
      '    role: lead',
      '  manager:',
      '    kind: role',
      '    role: evaluator',
    ]);

    expect(() => loadAuthoredSpec(filePath)).toThrow(/agentic.*actors\.manager/i);
  });

  it('requires a non-empty userTask in agentic mode', () => {
    const filePath = writeAgenticSpec([
      'declaredActors:',
      '  - lead',
      '  - manager',
      'actors:',
      '  lead:',
      '    kind: role',
      '    role: lead',
      '  manager:',
      '    kind: manager',
      'userTask: "   "',
    ]);

    expect(() => loadAuthoredSpec(filePath)).toThrow(/agentic.*userTask/i);
  });

  it('requires playbookRef to resolve relative to the spec directory in agentic mode', () => {
    const filePath = writeAgenticSpec([
      'declaredActors:',
      '  - lead',
      '  - manager',
      'actors:',
      '  lead:',
      '    kind: role',
      '    role: lead',
      '  manager:',
      '    kind: manager',
      'playbookRef: playbooks/missing.md',
    ]);

    expect(() => loadAuthoredSpec(filePath)).toThrow(PlaybookResolutionError);
    expect(() => loadAuthoredSpec(filePath)).toThrow(/agentic.*playbookRef/i);
  });

  it('tolerates agentic-only fields in deterministic mode', () => {
    const tempDir = mkdtempSync(join(tmpdir(), 'pluto-v2-runtime-loader-'));
    const filePath = join(tempDir, 'deterministic.yaml');

    writeFileSync(
      filePath,
      [
        'runId: run-1',
        'scenarioRef: scenario/hello-team',
        'runProfileRef: paseo-deterministic',
        'orchestration:',
        '  mode: deterministic',
        'actors:',
        '  builder:',
        '    kind: role',
        '    role: builder',
        'declaredActors:',
        '  - builder',
        'userTask: "   "',
        'playbookRef: playbooks/not-markdown.txt',
      ].join('\n'),
      'utf8',
    );

    expect(() => loadAuthoredSpec(filePath)).not.toThrow();
  });

  it('parses numeric orchestration fields from YAML as numbers', () => {
    const filePath = writeAgenticSpec([
      'declaredActors:',
      '  - lead',
      '  - manager',
      'actors:',
      '  lead:',
      '    kind: role',
      '    role: lead',
      '  manager:',
      '    kind: manager',
      'orchestration:',
      '  mode: agentic_tool',
      '  maxTurns: 30',
      '  maxParseFailuresPerTurn: 4',
      '  maxKernelRejections: 5',
      '  maxNoProgressTurns: 6',
    ]);

    const authored = loadAuthoredSpec(filePath);

    expect(authored.orchestration).toEqual({
      mode: 'agentic_tool',
      maxTurns: 30,
      maxParseFailuresPerTurn: 4,
      maxKernelRejections: 5,
      maxNoProgressTurns: 6,
    });
    expect(authored.playbook).toMatchObject({
      ref: 'playbooks/team-lead.md',
    });
  });

  it('loads agentic_tool as a runtime-local mode while preserving playbook resolution', () => {
    const filePath = writeAgenticSpec([
      'declaredActors:',
      '  - lead',
      '  - manager',
      'actors:',
      '  lead:',
      '    kind: role',
      '    role: lead',
      '  manager:',
      '    kind: manager',
      'orchestration:',
      '  mode: agentic_tool',
    ]);

    const authored = loadAuthoredSpec(filePath);

    expect(authored.orchestration?.mode).toBe('agentic_tool');
    expect(authored.playbook).toMatchObject({ ref: 'playbooks/team-lead.md' });
  });

  it('fails fast when two declared actors resolve to the same actorKey', () => {
    const filePath = writeAgenticSpec([
      'declaredActors:',
      '  - lead',
      '  - manager',
      '  - researcher_alpha',
      '  - researcher_beta',
      'actors:',
      '  lead:',
      '    kind: role',
      '    role: lead',
      '  manager:',
      '    kind: manager',
      '  researcher_alpha:',
      '    kind: role',
      '    role: researcher',
      '  researcher_beta:',
      '    kind: role',
      '    role: researcher',
    ]);

    expect(() => loadAuthoredSpec(filePath)).toThrow(/duplicate_actor_key/i);
    expect(() => loadAuthoredSpec(filePath)).toThrow(/researcher_alpha/);
    expect(() => loadAuthoredSpec(filePath)).toThrow(/researcher_beta/);
    expect(() => loadAuthoredSpec(filePath)).toThrow(/role:researcher/);
  });

  it('rejects the legacy agentic mode literal (T4-S4 strict bar: only deterministic | agentic_tool)', () => {
    const filePath = writeAgenticSpec([
      'declaredActors:',
      '  - lead',
      '  - manager',
      'actors:',
      '  lead:',
      '    kind: role',
      '    role: lead',
      '  manager:',
      '    kind: manager',
      'orchestration:',
      '  mode: agentic',
    ]);

    expect(() => loadAuthoredSpec(filePath)).toThrow();
  });
});

function writeAgenticSpec(lines: string[]): string {
  const tempDir = mkdtempSync(join(tmpdir(), 'pluto-v2-runtime-loader-'));
  const playbookDir = join(tempDir, 'playbooks');
  const filePath = join(tempDir, 'agentic.yaml');
  const hasUserTask = lines.some((line) => line.startsWith('userTask:'));
  const hasPlaybookRef = lines.some((line) => line.startsWith('playbookRef:'));
  const hasOrchestration = lines.some((line) => line.startsWith('orchestration:'));

  mkdirSync(playbookDir, { recursive: true });
  writeFileSync(join(playbookDir, 'team-lead.md'), '# Team Lead\n\nFollow the task.\n', 'utf8');
  writeFileSync(
    filePath,
    [
      'runId: run-1',
      'scenarioRef: scenario/hello-team',
      'runProfileRef: paseo-agentic',
      ...(hasOrchestration
        ? []
        : [
            'orchestration:',
            '  mode: agentic_tool',
          ]),
      ...(hasUserTask ? [] : ['userTask: Ship the loader lane.']),
      ...(hasPlaybookRef ? [] : ['playbookRef: playbooks/team-lead.md']),
      ...lines,
    ].join('\n'),
    'utf8',
  );

  return filePath;
}
