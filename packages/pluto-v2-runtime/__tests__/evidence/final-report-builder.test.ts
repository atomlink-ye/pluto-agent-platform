import { describe, expect, it } from 'vitest';

import { replayAll } from '@pluto/v2-core';

import { renderFinalReport } from '../../src/evidence/final-report-builder.js';

describe('renderFinalReport', () => {
  it('adds a diagnostics section when failure traces exist', () => {
    const views = replayAll([]);
    const report = renderFinalReport({
      runId: 'run-1',
      status: 'failed',
      summary: 'Failed.',
      initiatingActor: { kind: 'role', role: 'lead' },
      evidence: views.evidence,
      tasks: views.task,
      mailbox: views.mailbox,
      artifacts: [],
      runtimeDiagnostics: {
        bridgeUnavailable: [{ actor: 'role:lead', reason: 'wrapper_missing', latencyMs: 14 }],
        taskCloseoutRejected: [{ actor: 'role:lead', taskId: 'task-1', reason: 'already completed' }],
        waitTraces: [{ kind: 'wait_cancelled', actor: 'role:generator', reason: 'run_shutdown' }],
      },
    });

    expect(report).toContain('## Diagnostics');
    expect(report).toContain('bridge_unavailable (role:lead): wrapper_missing (14 ms)');
    expect(report).toContain('task_closeout_rejected (role:lead, task-1): already completed');
    expect(report).toContain('wait_cancelled (role:generator): run_shutdown');
  });

  it('omits diagnostics when no failure traces exist', () => {
    const views = replayAll([]);
    const report = renderFinalReport({
      runId: 'run-1',
      status: 'succeeded',
      summary: 'Done.',
      initiatingActor: { kind: 'role', role: 'lead' },
      evidence: views.evidence,
      tasks: views.task,
      mailbox: views.mailbox,
      artifacts: [],
      runtimeDiagnostics: {
        bridgeUnavailable: [],
        taskCloseoutRejected: [],
        waitTraces: [{ kind: 'wait_armed', actor: 'role:lead', fromSequence: 4, armedAt: '2026-05-09T00:00:00.000Z' }],
      },
    });

    expect(report).not.toContain('## Diagnostics');
  });

  it('omits benign client idle wait cancellations from diagnostics', () => {
    const views = replayAll([]);
    const report = renderFinalReport({
      runId: 'run-1',
      status: 'succeeded',
      summary: 'Done.',
      initiatingActor: { kind: 'role', role: 'lead' },
      evidence: views.evidence,
      tasks: views.task,
      mailbox: views.mailbox,
      artifacts: [],
      runtimeDiagnostics: {
        bridgeUnavailable: [],
        taskCloseoutRejected: [],
        waitTraces: [{ kind: 'wait_cancelled', actor: 'role:lead', reason: 'client_idle_disconnect' }],
      },
    });

    expect(report).not.toContain('## Diagnostics');
    expect(report).not.toContain('client_idle_disconnect');
  });

  it('renders unavailable usage totals as unavailable instead of zero', () => {
    const views = replayAll([]);
    const report = renderFinalReport({
      runId: 'run-1',
      status: 'failed',
      summary: 'No usage telemetry.',
      initiatingActor: { kind: 'role', role: 'lead' },
      evidence: views.evidence,
      tasks: views.task,
      mailbox: views.mailbox,
      artifacts: [],
      usageSummary: {
        usageStatus: 'unavailable',
        totalInputTokens: null,
        totalOutputTokens: null,
        totalTokens: null,
        totalCostUsd: null,
      },
    });

    expect(report).toContain('## Usage Summary');
    expect(report).toContain('- Usage status: unavailable');
    expect(report).toContain('- Input tokens: (unavailable)');
    expect(report).toContain('- Output tokens: (unavailable)');
    expect(report).toContain('- Total tokens: (unavailable)');
    expect(report).toContain('- Cost (USD): (unavailable)');
    expect(report).not.toContain('- Input tokens: 0');
    expect(report).not.toContain('- Output tokens: 0');
    expect(report).not.toContain('- Total tokens: 0');
    expect(report).not.toContain('- Cost (USD): 0');
  });
});
