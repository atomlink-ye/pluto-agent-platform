import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import { translateLegacyEvents, V1_TRANSLATOR_UUID_NAMESPACE } from '../../src/legacy/v1-translator.js';

type LegacyEvent = Record<string, unknown>;

const LIVE_FIXTURE_EVENTS = readFileSync(
  new URL('../../../../tests/fixtures/live-smoke/86557df1-0b4a-4bd4-8a75-027a4dcd5d38/events.jsonl', import.meta.url),
  'utf8',
)
  .trim()
  .split('\n')
  .map((line) => JSON.parse(line) as LegacyEvent);

const baseEvent = (type: string, payload: Record<string, unknown> = {}, extras: Record<string, unknown> = {}): LegacyEvent => ({
  id: '11111111-1111-4111-8111-111111111111',
  runId: 'run-1',
  ts: '2026-05-07T00:00:00.000Z',
  type,
  payload,
  ...extras,
});

const translateSingle = (event: LegacyEvent) => translateLegacyEvents([event]);

describe('translateLegacyEvents table A', () => {
  it('maps run_started', () => {
    const [event] = translateSingle(baseEvent('run_started', { scenario: 'scenario/hello-team', runProfile: 'fake-smoke' }));
    expect(event).toMatchObject({ kind: 'run_started', actor: { kind: 'system' }, requestId: null });
  });

  it('drops lead_started', () => {
    expect(translateSingle(baseEvent('lead_started'))).toEqual([]);
  });

  it('maps run_completed with manager actor and envelope-derived completedAt', () => {
    const [event] = translateSingle(baseEvent('run_completed', { workerCount: 1, playbookId: 'research-review' }));
    expect(event).toMatchObject({
      kind: 'run_completed',
      actor: { kind: 'manager' },
      payload: { status: 'succeeded', summary: null, completedAt: '2026-05-07T00:00:00.000Z' },
    });
  });

  it('drops final_reconciliation_received', () => {
    expect(translateSingle(baseEvent('final_reconciliation_received'))).toEqual([]);
  });

  it('maps task_created and falls back from summary to title', () => {
    const [event] = translateSingle(
      baseEvent('task_created', { taskId: 'task-1', summary: 'planner: write artifact', dependsOn: [] }, { roleId: 'planner' }),
    );
    expect(event).toMatchObject({ kind: 'task_created', payload: { taskId: 'task-1', title: 'planner: write artifact' } });
  });

  it('infers task_claimed as queued to running', () => {
    const [event] = translateSingle(baseEvent('task_claimed', { taskId: 'task-1' }, { roleId: 'planner' }));
    expect(event).toMatchObject({ kind: 'task_state_changed', payload: { taskId: 'task-1', from: 'queued', to: 'running' } });
  });

  it('infers task_completed as running to completed', () => {
    const [event] = translateSingle(baseEvent('task_completed', { taskId: 'task-1' }, { roleId: 'planner' }));
    expect(event).toMatchObject({ kind: 'task_state_changed', payload: { taskId: 'task-1', from: 'running', to: 'completed' } });
  });

  it('maps mailbox_message when the kind is supported', () => {
    const [event] = translateSingle(
      baseEvent('mailbox_message', { messageId: 'msg-1', to: 'lead', from: 'planner', kind: 'worker_complete' }),
    );
    expect(event).toMatchObject({ kind: 'mailbox_message_appended', payload: { kind: 'completion', body: '' } });
  });

  it('drops mailbox_message_queued', () => {
    expect(translateSingle(baseEvent('mailbox_message_queued'))).toEqual([]);
  });

  it('drops mailbox_message_delivered', () => {
    expect(translateSingle(baseEvent('mailbox_message_delivered'))).toEqual([]);
  });

  it('drops lead_message while keeping it available for later summary inference', () => {
    expect(translateSingle(baseEvent('lead_message', { kind: 'summary', markdown: '## Final Summary' }))).toEqual([]);
  });

  it('drops plan_approval_requested', () => {
    expect(translateSingle(baseEvent('plan_approval_requested'))).toEqual([]);
  });

  it('drops plan_approval_responded', () => {
    expect(translateSingle(baseEvent('plan_approval_responded'))).toEqual([]);
  });

  it('maps artifact_created', () => {
    const [event] = translateSingle(baseEvent('artifact_created', { path: 'artifact.md', playbookId: 'research-review' }));
    expect(event).toMatchObject({ kind: 'artifact_published', payload: { kind: 'final', mediaType: 'text/markdown', byteSize: 0 } });
  });

  it('drops worker_started', () => {
    expect(translateSingle(baseEvent('worker_started'))).toEqual([]);
  });

  it('drops worker_completed', () => {
    expect(translateSingle(baseEvent('worker_completed'))).toEqual([]);
  });

  it('drops worker_complete_received', () => {
    expect(translateSingle(baseEvent('worker_complete_received'))).toEqual([]);
  });

  it('drops spawn_request_received', () => {
    expect(translateSingle(baseEvent('spawn_request_received'))).toEqual([]);
  });

  it('drops spawn_request_executed', () => {
    expect(translateSingle(baseEvent('spawn_request_executed'))).toEqual([]);
  });

  it('drops coordination_transcript_created', () => {
    expect(translateSingle(baseEvent('coordination_transcript_created'))).toEqual([]);
  });
});

describe('translateLegacyEvents table B', () => {
  it('drops text mailbox kinds', () => {
    expect(translateSingle(baseEvent('mailbox_message', { messageId: 'msg-1', to: 'lead', from: 'planner', kind: 'text' }))).toEqual([]);
  });

  it('maps plan_approval_request mailbox kinds', () => {
    const [event] = translateSingle(
      baseEvent('mailbox_message', { messageId: 'msg-1', to: 'lead', from: 'planner', kind: 'plan_approval_request' }),
    );
    expect(event).toMatchObject({ payload: { kind: 'plan_approval_request' } });
  });

  it('maps plan_approval_response mailbox kinds', () => {
    const [event] = translateSingle(
      baseEvent('mailbox_message', { messageId: 'msg-1', to: 'planner', from: 'lead', kind: 'plan_approval_response' }),
    );
    expect(event).toMatchObject({ payload: { kind: 'plan_approval_response' } });
  });

  it('maps worker_complete mailbox kinds to completion', () => {
    const [event] = translateSingle(
      baseEvent('mailbox_message', { messageId: 'msg-1', to: 'lead', from: 'planner', kind: 'worker_complete' }),
    );
    expect(event).toMatchObject({ payload: { kind: 'completion' } });
  });

  it('drops spawn_request mailbox kinds', () => {
    expect(
      translateSingle(baseEvent('mailbox_message', { messageId: 'msg-1', to: 'lead', from: 'lead', kind: 'spawn_request' })),
    ).toEqual([]);
  });

  it('drops unknown mailbox kinds', () => {
    expect(
      translateSingle(baseEvent('mailbox_message', { messageId: 'msg-1', to: 'lead', from: 'planner', kind: 'custom_kind' })),
    ).toEqual([]);
  });
});

describe('translateLegacyEvents fixtures and errors', () => {
  it('infers the final summary from the live-smoke fixture before run_completed', () => {
    const translated = translateLegacyEvents(LIVE_FIXTURE_EVENTS);
    const runCompleted = translated.find((event) => event.kind === 'run_completed');

    expect(runCompleted).toMatchObject({ payload: { summary: 'Final Summary' } });
  });

  it('preserves deterministic v5-style derived ids', () => {
    const first = translateSingle(baseEvent('run_started', { scenario: 'scenario/hello-team', runProfile: 'fake-smoke' }))[0];
    const second = translateSingle(baseEvent('run_started', { scenario: 'scenario/hello-team', runProfile: 'fake-smoke' }))[0];

    expect(V1_TRANSLATOR_UUID_NAMESPACE).toBe('6ba7b810-9dad-11d1-80b4-00c04fd430c8');
    expect(first).toBeDefined();
    expect(second).toBeDefined();
    if (first == null || second == null) {
      throw new Error('Expected translated run_started events');
    }
    expect(first.eventId).toBe(second.eventId);
    expect(first.requestId).toBe(second.requestId);
  });

  it('rejects unknown legacy event types', () => {
    expect(() => translateLegacyEvents([baseEvent('brand_new_type')])).toThrow(/Unknown legacy event type/);
  });
});
