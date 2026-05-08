import { describe, expect, it } from 'vitest';

import { extractDirective } from '../../../src/adapters/paseo/paseo-directive.js';

describe('extractDirective', () => {
  it('parses a fenced json directive block', () => {
    const result = extractDirective([
      'Model output',
      '```json',
      JSON.stringify(
        {
          kind: 'create_task',
          payload: {
            title: 'Implement adapter',
            ownerActor: { kind: 'role', role: 'generator' },
            dependsOn: [],
          },
        },
        null,
        2,
      ),
      '```',
    ].join('\n'));

    expect(result).toEqual({
      ok: true,
      directive: {
        kind: 'create_task',
        payload: {
          title: 'Implement adapter',
          ownerActor: { kind: 'role', role: 'generator' },
          dependsOn: [],
        },
      },
    });
  });

  it('falls back to the first balanced JSON object', () => {
    const result = extractDirective(
      'Leading text {"kind":"complete_run","payload":{"status":"succeeded","summary":"done"}} trailing text',
    );

    expect(result).toEqual({
      ok: true,
      directive: {
        kind: 'complete_run',
        payload: {
          status: 'succeeded',
          summary: 'done',
        },
      },
    });
  });

  it('returns a failure when no JSON candidate exists', () => {
    expect(extractDirective('no directive here')).toEqual({
      ok: false,
      reason: 'no fenced json block or balanced JSON object found',
    });
  });

  it('rejects transcripts with multiple fenced json blocks', () => {
    expect(
      extractDirective([
        '```json',
        '{"kind":"complete_run","payload":{"status":"succeeded","summary":"first"}}',
        '```',
        'Some explanation',
        '```json',
        '{"kind":"complete_run","payload":{"status":"failed","summary":"second"}}',
        '```',
      ].join('\n')),
    ).toEqual({
      ok: false,
      reason: 'multiple fenced json blocks found',
    });
  });

  it('returns a validation failure for malformed directive payloads', () => {
    const result = extractDirective([
      '```json',
      '{"kind":"change_task_state","payload":{"to":"running"}}',
      '```',
    ].join('\n'));

    expect(result.ok).toBe(false);
    if (result.ok) {
      return;
    }

    expect(result.reason).toContain('directive validation failed');
  });
});
