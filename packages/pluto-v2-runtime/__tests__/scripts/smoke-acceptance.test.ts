import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { SCHEMA_VERSION, replayAll, type ActorRef, type RunEvent } from '@pluto/v2-core';
import { afterEach, describe, expect, it } from 'vitest';

import { checkSmokeAcceptanceForRunDir } from '../../scripts/smoke-acceptance.js';
import { renderFinalReport } from '../../src/evidence/final-report-builder.js';

const REPO_ROOT = fileURLToPath(new URL('../../../../', import.meta.url));
const TSX_BIN = join(REPO_ROOT, 'node_modules', '.bin', 'tsx');
const POST_T5_FIXTURE_DIR = join(REPO_ROOT, 'tests', 'fixtures', 'live-smoke', 'post-t5-poet-critic-haiku');
const POST_T5_USAGE_SUMMARY_PATH = join(POST_T5_FIXTURE_DIR, 'usage-summary.json');

const SYSTEM: ActorRef = { kind: 'system' };
const MANAGER: ActorRef = { kind: 'manager' };
const LEAD: ActorRef = { kind: 'role', role: 'lead' };
const GENERATOR: ActorRef = { kind: 'role', role: 'generator' };

const tempDirs: string[] = [];

function baseEvent(sequence: number, actor: ActorRef) {
  return {
    eventId: `00000000-0000-4000-8000-${String(sequence + 1).padStart(12, '0')}`,
    requestId: `00000000-0000-4000-8000-${String(sequence + 101).padStart(12, '0')}`,
    runId: 'run-smoke-acceptance',
    actor,
    timestamp: `2026-05-09T00:00:${String(sequence).padStart(2, '0')}.000Z`,
    sequence,
    schemaVersion: SCHEMA_VERSION,
  };
}

function runStarted(sequence: number): RunEvent {
  return {
    ...baseEvent(sequence, SYSTEM),
    kind: 'run_started',
    outcome: 'accepted',
    payload: {
      scenarioRef: 'scenario/smoke-acceptance',
      runProfileRef: 'unit-test',
      startedAt: '2026-05-09T00:00:00.000Z',
    },
  } as unknown as RunEvent;
}

function taskCreated(sequence: number, ownerActor: ActorRef = GENERATOR, taskId = 'task-1'): RunEvent {
  return {
    ...baseEvent(sequence, LEAD),
    kind: 'task_created',
    outcome: 'accepted',
    payload: {
      taskId,
      title: 'Draft haiku',
      ownerActor,
      dependsOn: [],
    },
  } as unknown as RunEvent;
}

function mailboxAppended(
  sequence: number,
  fromActor: ActorRef = GENERATOR,
  toActor: ActorRef = LEAD,
  kind: 'completion' | 'final' | 'plan' | 'progress' = 'completion',
): RunEvent {
  return {
    ...baseEvent(sequence, fromActor),
    kind: 'mailbox_message_appended',
    outcome: 'accepted',
    payload: {
      messageId: `message-${sequence}`,
      fromActor,
      toActor,
      kind,
      body: 'Draft is ready.',
    },
  } as unknown as RunEvent;
}

function taskStateChanged(sequence: number, to: 'in_progress' | 'completed' | 'cancelled' | 'failed' = 'completed', taskId = 'task-1'): RunEvent {
  return {
    ...baseEvent(sequence, GENERATOR),
    kind: 'task_state_changed',
    outcome: 'accepted',
    payload: {
      taskId,
      to,
    },
  } as unknown as RunEvent;
}

function runCompleted(sequence: number, status: 'succeeded' | 'failed' = 'succeeded'): RunEvent {
  return {
    ...baseEvent(sequence, MANAGER),
    kind: 'run_completed',
    outcome: 'accepted',
    payload: {
      status,
      completedAt: '2026-05-09T00:00:59.000Z',
      summary: status === 'succeeded' ? 'done' : 'bridge_unavailable: wrapper_missing',
    },
  } as unknown as RunEvent;
}

async function createRunDir(options?: {
  events?: ReadonlyArray<RunEvent>;
  transcripts?: Record<string, string>;
  finalReport?: string;
}): Promise<string> {
  const runDir = await mkdtemp(join(tmpdir(), 'pluto-smoke-acceptance-'));
  tempDirs.push(runDir);
  const transcriptDir = join(runDir, 'paseo-transcripts');
  await mkdir(transcriptDir, { recursive: true });

  const events = options?.events ?? [
    runStarted(0),
    taskCreated(1),
    mailboxAppended(2),
    taskStateChanged(3, 'completed'),
    runCompleted(4, 'succeeded'),
  ];
  const transcripts = options?.transcripts ?? {
    'role:lead': 'lead transcript\n',
    'role:generator': 'generator transcript\n',
    manager: '',
  };

  await writeFile(join(runDir, 'events.jsonl'), `${events.map((event) => JSON.stringify(event)).join('\n')}\n`, 'utf8');
  await writeFile(join(runDir, 'final-report.md'), options?.finalReport ?? '# Pluto v2 Paseo Live Smoke\n', 'utf8');
  await Promise.all(
    Object.entries(transcripts).map(([actorKey, transcript]) =>
      writeFile(join(transcriptDir, `${actorKey}.txt`), transcript, 'utf8'),
    ),
  );

  return runDir;
}

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe('smoke acceptance', () => {
  it('passes when all five criteria are satisfied', async () => {
    const runDir = await createRunDir();

    expect(checkSmokeAcceptanceForRunDir({ runDir, expectFailure: false })).toEqual({
      ok: true,
      failures: [],
    });
  });

  it('fails when the run does not succeed in normal mode', async () => {
    const runDir = await createRunDir({
      events: [
        runStarted(0),
        taskCreated(1),
        mailboxAppended(2),
        taskStateChanged(3, 'completed'),
        runCompleted(4, 'failed'),
      ],
    });

    const result = checkSmokeAcceptanceForRunDir({ runDir, expectFailure: false });

    expect(result.ok).toBe(false);
    expect(result.failures).toContain('run did not succeed');
  });

  it('fails when fewer than two actors have non-empty transcripts', async () => {
    const runDir = await createRunDir({
      transcripts: {
        'role:lead': 'lead transcript\n',
        'role:generator': '',
        manager: '',
      },
    });

    const result = checkSmokeAcceptanceForRunDir({ runDir, expectFailure: false });

    expect(result.ok).toBe(false);
    expect(result.failures).toContain('fewer than 2 actors have non-empty transcripts');
  });

  it('fails when a delegated task never reaches a terminal state', async () => {
    const runDir = await createRunDir({
      events: [
        runStarted(0),
        taskCreated(1),
        mailboxAppended(2),
        runCompleted(3, 'succeeded'),
      ],
    });

    const result = checkSmokeAcceptanceForRunDir({ runDir, expectFailure: false });

    expect(result.ok).toBe(false);
    expect(result.failures.some((failure) => failure.startsWith('delegated task did not reach terminal state'))).toBe(true);
  });

  it('fails when there is no accepted task creation or accepted role mutation', async () => {
    const runDir = await createRunDir({
      events: [runStarted(0), runCompleted(1, 'succeeded')],
    });

    const result = checkSmokeAcceptanceForRunDir({ runDir, expectFailure: false });

    expect(result.ok).toBe(false);
    expect(result.failures).toContain('missing accepted task_created or accepted sub-actor (non-lead) mutation event');
  });

  it('fails when only lead authored mutations (no sub-actor mutation)', async () => {
    // Lead-authored complete_run alone is NOT evidence of team collaboration.
    const runDir = await createRunDir({
      events: [
        runStarted(0),
        // Lead sends a mailbox to itself? — synthetic case: lead authors a
        // mutation but no sub-actor ever acts. We use a non-task mutation
        // (mailbox to non-lead) authored by lead and assert the gate STILL
        // fails because no SUB-actor mutation exists.
        mailboxAppended(1, LEAD, GENERATOR, 'plan'),
        runCompleted(2, 'succeeded'),
      ],
      transcripts: {
        'role:lead': 'lead transcript\n',
        'role:generator': 'generator transcript\n',
      },
    });

    const result = checkSmokeAcceptanceForRunDir({ runDir, expectFailure: false });

    expect(result.ok).toBe(false);
    expect(result.failures).toContain('missing accepted task_created or accepted sub-actor (non-lead) mutation event');
  });

  it('fails when sub-actor mailbox is non-completion kind (e.g. plan/progress)', async () => {
    // A sub-actor sending a `plan` mailbox is not evidence delegated work
    // finished. Acceptance should require kind: completion or final.
    const runDir = await createRunDir({
      events: [
        runStarted(0),
        taskCreated(1),
        mailboxAppended(2, GENERATOR, LEAD, 'plan'),
        taskStateChanged(3, 'completed'),
        runCompleted(4, 'succeeded'),
      ],
    });

    const result = checkSmokeAcceptanceForRunDir({ runDir, expectFailure: false });

    expect(result.ok).toBe(false);
    expect(result.failures).toContain('missing accepted mailbox_message_appended (kind: completion|final) from a sub-actor back to lead');
  });

  it('fails when no sub-actor reports back to lead', async () => {
    const runDir = await createRunDir({
      events: [
        runStarted(0),
        taskCreated(1),
        taskStateChanged(2, 'completed'),
        runCompleted(3, 'succeeded'),
      ],
    });

    const result = checkSmokeAcceptanceForRunDir({ runDir, expectFailure: false });

    expect(result.ok).toBe(false);
    expect(result.failures).toContain('missing accepted mailbox_message_appended (kind: completion|final) from a sub-actor back to lead');
  });

  it('passes expected-failure mode when the run failed but the other criteria never happened', async () => {
    const runDir = await createRunDir({
      events: [runStarted(0), runCompleted(1, 'failed')],
      transcripts: {
        'role:lead': 'lead transcript\n',
        'role:generator': '',
        manager: '',
      },
      finalReport: '# Pluto v2 Paseo Live Smoke\n\n- Status: failed\n',
    });

    expect(checkSmokeAcceptanceForRunDir({ runDir, expectFailure: true })).toEqual({
      ok: true,
      failures: [],
    });
  });

  it('does not fail acceptance for a run whose report suppresses benign client idle disconnects', async () => {
    const views = replayAll([]);
    const finalReport = renderFinalReport({
      runId: 'run-smoke-acceptance',
      status: 'succeeded',
      summary: 'done',
      initiatingActor: LEAD,
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
    const runDir = await createRunDir({ finalReport });

    const result = checkSmokeAcceptanceForRunDir({ runDir, expectFailure: false });

    expect(result).toEqual({ ok: true, failures: [] });
    expect(finalReport).not.toContain('## Diagnostics');
  });

  it('treats the captured POST-T5 fixture as a diagnosed expected failure', () => {
    const result = spawnSync(
      TSX_BIN,
      [
        'packages/pluto-v2-runtime/scripts/smoke-live.ts',
        '--run-dir',
        POST_T5_FIXTURE_DIR,
        '--expect-failure',
      ],
      {
        cwd: REPO_ROOT,
        encoding: 'utf8',
      },
    );

    expect(result.status).toBe(0);
    expect(result.stderr).toBe('');
    expect(result.stdout.trim().endsWith('tests/fixtures/live-smoke/post-t5-poet-critic-haiku')).toBe(true);
  });

  it('keeps the captured POST-T5 unavailable usage fixture null-shaped at every aggregate level', () => {
    const usageSummary = JSON.parse(readFileSync(POST_T5_USAGE_SUMMARY_PATH, 'utf8')) as {
      usageStatus: string;
      totalInputTokens: number | null;
      totalOutputTokens: number | null;
      totalTokens: number | null;
      totalCostUsd: number | null;
      byActor: Record<string, {
        inputTokens: number | null;
        outputTokens: number | null;
        totalTokens: number | null;
        costUsd: number | null;
      }>;
      byModel: Record<string, {
        inputTokens: number | null;
        outputTokens: number | null;
        totalTokens: number | null;
        costUsd: number | null;
      }>;
      perTurn: Array<{
        inputTokens: number | null;
        outputTokens: number | null;
        totalTokens: number | null;
        costUsd: number | null;
      }>;
    };

    expect(usageSummary.usageStatus).toBe('unavailable');
    expect(usageSummary.totalInputTokens).toBeNull();
    expect(usageSummary.totalOutputTokens).toBeNull();
    expect(usageSummary.totalTokens).toBeNull();
    expect(usageSummary.totalCostUsd).toBeNull();
    expect(usageSummary.byActor['role:lead']).toMatchObject({
      inputTokens: null,
      outputTokens: null,
      totalTokens: null,
      costUsd: null,
    });
    expect(usageSummary.byModel['opencode:openai/gpt-5.4-mini']).toMatchObject({
      inputTokens: null,
      outputTokens: null,
      totalTokens: null,
      costUsd: null,
    });
    expect(usageSummary.perTurn.every((turn) =>
      turn.inputTokens === null
      && turn.outputTokens === null
      && turn.totalTokens === null
      && turn.costUsd === null,
    )).toBe(true);
  });
});
