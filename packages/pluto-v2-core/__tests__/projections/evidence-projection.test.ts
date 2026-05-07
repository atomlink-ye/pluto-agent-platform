import { describe, expect, it } from 'vitest';

import {
  ArtifactPublishedEventSchema,
  EvidenceProjectionViewStateSchema,
  MailboxMessageAppendedEventSchema,
  RequestRejectedEventSchema,
  RunCompletedEventSchema,
  RunStartedEventSchema,
  TaskCreatedEventSchema,
  TaskStateChangedEventSchema,
  evidenceReducer,
  initialEvidenceState,
  replayEvidence,
} from '../../src/index.js';

const parseEvidenceView = (view: unknown) => EvidenceProjectionViewStateSchema.parse(view);

const createRunStartedEvent = (overrides: Partial<Record<string, unknown>> = {}) =>
  RunStartedEventSchema.parse({
    eventId: '00000000-0000-4000-8000-000000000401',
    runId: 'run-evidence',
    sequence: 0,
    timestamp: '2026-05-07T12:00:00.000Z',
    schemaVersion: '1.0',
    actor: { kind: 'system' },
    requestId: null,
    causationId: null,
    correlationId: null,
    entityRef: { kind: 'run', runId: 'run-evidence' },
    outcome: 'accepted',
    kind: 'run_started',
    payload: {
      scenarioRef: 'scenario/evidence',
      runProfileRef: 'fake-smoke',
      startedAt: '2026-05-07T12:00:00.000Z',
    },
    ...overrides,
  });

const createRunCompletedEvent = (overrides: Partial<Record<string, unknown>> = {}) =>
  RunCompletedEventSchema.parse({
    eventId: '00000000-0000-4000-8000-000000000402',
    runId: 'run-evidence',
    sequence: 1,
    timestamp: '2026-05-07T12:01:00.000Z',
    schemaVersion: '1.0',
    actor: { kind: 'manager' },
    requestId: '00000000-0000-4000-8000-000000000412',
    causationId: null,
    correlationId: 'corr-evidence',
    entityRef: { kind: 'run', runId: 'run-evidence' },
    outcome: 'accepted',
    kind: 'run_completed',
    payload: {
      status: 'failed',
      completedAt: '2026-05-07T12:01:00.000Z',
      summary: 'Failed.',
    },
    ...overrides,
  });

const createMailboxMessageEvent = () =>
  MailboxMessageAppendedEventSchema.parse({
    eventId: '00000000-0000-4000-8000-000000000403',
    runId: 'run-evidence',
    sequence: 2,
    timestamp: '2026-05-07T12:02:00.000Z',
    schemaVersion: '1.0',
    actor: { kind: 'manager' },
    requestId: '00000000-0000-4000-8000-000000000413',
    causationId: null,
    correlationId: 'corr-evidence',
    entityRef: { kind: 'mailbox_message', messageId: 'msg-1' },
    outcome: 'accepted',
    kind: 'mailbox_message_appended',
    payload: {
      messageId: 'msg-1',
      fromActor: { kind: 'manager' },
      toActor: { kind: 'broadcast' },
      kind: 'plan',
      body: 'Plan it.',
    },
  });

const createTaskCreatedEvent = () =>
  TaskCreatedEventSchema.parse({
    eventId: '00000000-0000-4000-8000-000000000404',
    runId: 'run-evidence',
    sequence: 3,
    timestamp: '2026-05-07T12:03:00.000Z',
    schemaVersion: '1.0',
    actor: { kind: 'manager' },
    requestId: '00000000-0000-4000-8000-000000000414',
    causationId: null,
    correlationId: 'corr-evidence',
    entityRef: { kind: 'task', taskId: 'task-1' },
    outcome: 'accepted',
    kind: 'task_created',
    payload: {
      taskId: 'task-1',
      title: 'Task',
      ownerActor: null,
      dependsOn: [],
    },
  });

const createTaskStateChangedEvent = () =>
  TaskStateChangedEventSchema.parse({
    eventId: '00000000-0000-4000-8000-000000000405',
    runId: 'run-evidence',
    sequence: 4,
    timestamp: '2026-05-07T12:04:00.000Z',
    schemaVersion: '1.0',
    actor: { kind: 'role', role: 'generator' },
    requestId: '00000000-0000-4000-8000-000000000415',
    causationId: null,
    correlationId: 'corr-evidence',
    entityRef: { kind: 'task', taskId: 'task-1' },
    outcome: 'accepted',
    kind: 'task_state_changed',
    payload: {
      taskId: 'task-1',
      from: 'queued',
      to: 'running',
    },
  });

const createArtifactPublishedEvent = () =>
  ArtifactPublishedEventSchema.parse({
    eventId: '00000000-0000-4000-8000-000000000406',
    runId: 'run-evidence',
    sequence: 5,
    timestamp: '2026-05-07T12:05:00.000Z',
    schemaVersion: '1.0',
    actor: { kind: 'manager' },
    requestId: '00000000-0000-4000-8000-000000000416',
    causationId: null,
    correlationId: 'corr-evidence',
    entityRef: { kind: 'artifact', artifactId: 'artifact-1' },
    outcome: 'accepted',
    kind: 'artifact_published',
    payload: {
      artifactId: 'artifact-1',
      kind: 'final',
      mediaType: 'text/plain',
      byteSize: 16,
    },
  });

const createRequestRejectedEvent = () =>
  RequestRejectedEventSchema.parse({
    eventId: '00000000-0000-4000-8000-000000000407',
    runId: 'run-evidence',
    sequence: 6,
    timestamp: '2026-05-07T12:06:00.000Z',
    schemaVersion: '1.0',
    actor: { kind: 'manager' },
    requestId: '00000000-0000-4000-8000-000000000417',
    causationId: null,
    correlationId: 'corr-evidence',
    entityRef: { kind: 'run', runId: 'run-evidence' },
    outcome: 'rejected',
    kind: 'request_rejected',
    payload: {
      rejectionReason: 'actor_not_authorized',
      rejectedRequestId: '00000000-0000-4000-8000-000000000517',
      detail: 'Rejected.',
    },
  });

describe('evidence projection', () => {
  it('returns the initial parseable view for empty input', () => {
    const view = replayEvidence([]);

    expect(parseEvidenceView(view)).toEqual(view);
    expect(view).toEqual({ run: null, citations: [] });
  });

  it('records an exact run_started citation and keeps view.run null until completion', () => {
    const state = evidenceReducer(initialEvidenceState, createRunStartedEvent());

    expect(parseEvidenceView(state.view)).toEqual(state.view);
    expect(state.pendingStartedAt).toBe('2026-05-07T12:00:00.000Z');
    expect(state.view.run).toBeNull();
    expect(state.view.citations).toEqual([
      {
        eventId: '00000000-0000-4000-8000-000000000401',
        sequence: 0,
        kind: 'run_started',
        summary: 'Run started.',
      },
    ]);
  });

  it('records an exact run_completed citation, populates view.run from the envelope runId, and clears pendingStartedAt', () => {
    const started = evidenceReducer(initialEvidenceState, createRunStartedEvent());
    const completed = evidenceReducer(started, createRunCompletedEvent());

    expect(parseEvidenceView(completed.view)).toEqual(completed.view);
    expect(completed.pendingStartedAt).toBeNull();
    expect(completed.view.run).toEqual({
      runId: 'run-evidence',
      status: 'failed',
      startedAt: '2026-05-07T12:00:00.000Z',
      completedAt: '2026-05-07T12:01:00.000Z',
      summary: 'Failed.',
    });
    expect(completed.view.citations.at(-1)).toEqual({
      eventId: '00000000-0000-4000-8000-000000000402',
      sequence: 1,
      kind: 'run_completed',
      summary: 'Run completed.',
    });
  });

  it('dedups duplicate run_started citations by eventId', () => {
    const started = createRunStartedEvent();

    const once = replayEvidence([started]);
    const twice = replayEvidence([started, started]);

    expect(parseEvidenceView(once)).toEqual(once);
    expect(twice).toEqual(once);
  });

  it('dedups duplicate run_completed citations by eventId', () => {
    const started = createRunStartedEvent();
    const completed = createRunCompletedEvent();

    const once = replayEvidence([started, completed]);
    const twice = replayEvidence([started, completed, completed]);

    expect(parseEvidenceView(once)).toEqual(once);
    expect(twice).toEqual(once);
  });

  it('has no view delta for mailbox_message_appended', () => {
    const state = evidenceReducer(initialEvidenceState, createMailboxMessageEvent());

    expect(parseEvidenceView(state.view)).toEqual(state.view);
    expect(state).toEqual(initialEvidenceState);
  });

  it('has no view delta for task_created and task_state_changed', () => {
    const afterCreate = evidenceReducer(initialEvidenceState, createTaskCreatedEvent());
    const afterChange = evidenceReducer(afterCreate, createTaskStateChangedEvent());

    expect(parseEvidenceView(afterChange.view)).toEqual(afterChange.view);
    expect(afterCreate).toEqual(initialEvidenceState);
    expect(afterChange).toEqual(initialEvidenceState);
  });

  it('has no view delta for artifact_published and request_rejected', () => {
    const afterArtifact = evidenceReducer(initialEvidenceState, createArtifactPublishedEvent());
    const afterRejected = evidenceReducer(afterArtifact, createRequestRejectedEvent());

    expect(parseEvidenceView(afterRejected.view)).toEqual(afterRejected.view);
    expect(afterArtifact).toEqual(initialEvidenceState);
    expect(afterRejected).toEqual(initialEvidenceState);
  });

  it('matches reducer folding for the happy-path run_started then run_completed sequence', () => {
    const events = [createRunStartedEvent(), createRunCompletedEvent()];
    const reduced = events.reduce(evidenceReducer, initialEvidenceState).view;
    const replayed = replayEvidence(events);

    expect(parseEvidenceView(replayed)).toEqual(replayed);
    expect(replayed).toEqual(reduced);
  });
});
