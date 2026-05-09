import { describe, expect, it } from 'vitest';

import type { AuthoredSpec } from '@pluto/v2-core';

import type { EvidencePacket } from '../../src/evidence/evidence-packet.js';
import { buildUsageSummary } from '../../src/evidence/usage-summary-builder.js';

const authored = {
  runId: 'run-1',
  scenarioRef: 'scenario/demo',
  runProfileRef: 'paseo-v2',
} as AuthoredSpec;

const evidencePacket: EvidencePacket = {
  schemaVersion: '1.0',
  kind: 'evidence_packet',
  runId: 'run-1',
  status: 'failed',
  summary: 'Failed.',
  initiatingActor: { kind: 'role', role: 'lead' },
  startedAt: null,
  completedAt: null,
  generatedAt: '2026-05-09T00:00:00.000Z',
  citations: [],
  tasks: {},
  mailboxMessages: [],
  artifacts: [],
};

describe('buildUsageSummary', () => {
  it('marks unavailable usage with null totals instead of zero placeholders', () => {
    const summary = buildUsageSummary({
      authored,
      evidencePacket,
      usage: {
        totalInputTokens: 0,
        totalOutputTokens: 0,
        totalCostUsd: 0,
        byActor: new Map(),
        perTurn: [
          {
            turnIndex: 0,
            actor: { kind: 'role', role: 'lead' },
            inputTokens: null,
            outputTokens: null,
            costUsd: null,
            waitExitCode: 0,
          },
        ],
      },
      actorSpecByKey: new Map([
        ['role:lead', { provider: 'opencode', model: 'openai/gpt-5.4-mini', mode: 'build' }],
      ]),
      evidencePacketPath: 'runs/run-1/evidence-packet.json',
    });

    expect(summary.usageStatus).toBe('unavailable');
    expect(summary.totalInputTokens).toBeNull();
    expect(summary.totalOutputTokens).toBeNull();
    expect(summary.totalTokens).toBeNull();
    expect(summary.totalCostUsd).toBeNull();
    expect(summary.byActor['role:lead']).toMatchObject({
      turns: 1,
      inputTokens: null,
      outputTokens: null,
      totalTokens: null,
      costUsd: null,
    });
    expect(summary.perTurn[0]).toMatchObject({
      inputTokens: null,
      outputTokens: null,
      totalTokens: null,
      costUsd: null,
    });
  });

  it('marks mixed per-turn availability as partial and preserves reported subgroups', () => {
    const summary = buildUsageSummary({
      authored,
      evidencePacket,
      usage: {
        totalInputTokens: 12,
        totalOutputTokens: 8,
        totalCostUsd: 0.1,
        byActor: new Map(),
        perTurn: [
          {
            turnIndex: 0,
            actor: { kind: 'role', role: 'generator' },
            inputTokens: 12,
            outputTokens: 8,
            costUsd: 0.1,
            waitExitCode: 0,
          },
          {
            turnIndex: 1,
            actor: { kind: 'role', role: 'evaluator' },
            inputTokens: null,
            outputTokens: null,
            costUsd: null,
            waitExitCode: 0,
          },
        ],
      },
      actorSpecByKey: new Map([
        ['role:generator', { provider: 'opencode', model: 'openai/gpt-5.4-mini', mode: 'build' }],
        ['role:evaluator', { provider: 'opencode', model: 'openai/gpt-5.4-mini', mode: 'build' }],
      ]),
      evidencePacketPath: 'runs/run-1/evidence-packet.json',
    });

    expect(summary.usageStatus).toBe('partial');
    expect(summary.totalInputTokens).toBeNull();
    expect(summary.totalOutputTokens).toBeNull();
    expect(summary.totalTokens).toBeNull();
    expect(summary.totalCostUsd).toBeNull();
    expect(summary.byActor['role:generator']).toMatchObject({
      turns: 1,
      inputTokens: 12,
      outputTokens: 8,
      totalTokens: 20,
      costUsd: 0.1,
    });
    expect(summary.byActor['role:evaluator']).toMatchObject({
      turns: 1,
      inputTokens: null,
      outputTokens: null,
      totalTokens: null,
      costUsd: null,
    });
    expect(summary.perTurn.map((turn) => turn.totalTokens)).toEqual([20, null]);
  });
});
