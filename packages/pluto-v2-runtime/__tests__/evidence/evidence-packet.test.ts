import { describe, expect, it } from 'vitest';

import { replayAll, type RunEvent } from '@pluto/v2-core';

import { EvidencePacketShape, assembleEvidencePacket } from '../../src/evidence/evidence-packet.js';

const runStarted: RunEvent = {
  eventId: '00000000-0000-4000-8000-000000000001',
  runId: 'run-1',
  sequence: 0,
  timestamp: '2026-05-07T00:00:00.000Z',
  schemaVersion: '1.0',
  actor: { kind: 'system' },
  requestId: null,
  causationId: null,
  correlationId: null,
  entityRef: { kind: 'run', runId: 'run-1' },
  outcome: 'accepted',
  kind: 'run_started',
  payload: {
    scenarioRef: 'scenario/hello-team',
    runProfileRef: 'fake-smoke',
    startedAt: '2026-05-07T00:00:00.000Z',
  },
};

const taskCreated: RunEvent = {
  eventId: '00000000-0000-4000-8000-000000000002',
  runId: 'run-1',
  sequence: 1,
  timestamp: '2026-05-07T00:00:01.000Z',
  schemaVersion: '1.0',
  actor: { kind: 'manager' },
  requestId: '00000000-0000-4000-8000-000000000010',
  causationId: '00000000-0000-4000-8000-000000000001',
  correlationId: null,
  entityRef: { kind: 'task', taskId: 'task-1' },
  outcome: 'accepted',
  kind: 'task_created',
  payload: {
    taskId: 'task-1',
    title: 'Write artifact',
    ownerActor: { kind: 'role', role: 'generator' },
    dependsOn: [],
  },
};

const artifactPublished: RunEvent = {
  eventId: '00000000-0000-4000-8000-000000000003',
  runId: 'run-1',
  sequence: 2,
  timestamp: '2026-05-07T00:00:02.000Z',
  schemaVersion: '1.0',
  actor: { kind: 'role', role: 'generator' },
  requestId: '00000000-0000-4000-8000-000000000011',
  causationId: '00000000-0000-4000-8000-000000000002',
  correlationId: null,
  entityRef: { kind: 'artifact', artifactId: 'artifact-1' },
  outcome: 'accepted',
  kind: 'artifact_published',
  payload: {
    artifactId: 'artifact-1',
    kind: 'final',
    mediaType: 'text/markdown',
    byteSize: 42,
  },
};

const runCompleted: RunEvent = {
  eventId: '00000000-0000-4000-8000-000000000004',
  runId: 'run-1',
  sequence: 3,
  timestamp: '2026-05-07T00:00:03.000Z',
  schemaVersion: '1.0',
  actor: { kind: 'manager' },
  requestId: '00000000-0000-4000-8000-000000000012',
  causationId: '00000000-0000-4000-8000-000000000003',
  correlationId: null,
  entityRef: { kind: 'run', runId: 'run-1' },
  outcome: 'accepted',
  kind: 'run_completed',
  payload: {
    status: 'succeeded',
    completedAt: '2026-05-07T00:00:03.000Z',
    summary: 'Finished.',
  },
};

describe('assembleEvidencePacket', () => {
  it('assembles a packet that satisfies the v2 schema', () => {
    const events = [runStarted, taskCreated, artifactPublished, runCompleted];
    const packet = assembleEvidencePacket(replayAll(events), events, 'run-1');

    expect(EvidencePacketShape.parse(packet)).toEqual(packet);
    expect(packet.generatedAt).toBe('2026-05-07T00:00:03.000Z');
    expect(packet.artifacts).toEqual([
      {
        artifactId: 'artifact-1',
        kind: 'final',
        mediaType: 'text/markdown',
        byteSize: 42,
      },
    ]);
  });

  it('uses in-progress defaults when the run has not completed', () => {
    const events = [runStarted];
    const packet = assembleEvidencePacket(replayAll(events), events, 'run-1');

    expect(packet.status).toBe('in_progress');
    expect(packet.summary).toBeNull();
    expect(packet.startedAt).toBeNull();
    expect(packet.completedAt).toBeNull();
    expect(packet.generatedAt).toBe('2026-05-07T00:00:00.000Z');
  });

  it('threads runtime traces into runtime diagnostics', () => {
    const events = [runStarted, taskCreated, artifactPublished, runCompleted];
    const packet = assembleEvidencePacket(replayAll(events), events, 'run-1', {
      runtimeTraces: [
        {
          kind: 'bridge_unavailable',
          actor: 'role:lead',
          reason: 'wrapper_missing',
          latencyMs: 14,
        },
        {
          kind: 'task_closeout_rejected',
          actor: 'role:generator',
          taskId: 'task-1',
          reason: 'task already terminal',
        },
        {
          kind: 'wait_timed_out',
          actor: 'role:evaluator',
          timeoutMs: 600000,
        },
      ],
    });

    expect(packet.runtimeDiagnostics).toEqual({
      bridgeUnavailable: [{ actor: 'role:lead', reason: 'wrapper_missing', latencyMs: 14 }],
      taskCloseoutRejected: [{ actor: 'role:generator', taskId: 'task-1', reason: 'task already terminal' }],
      waitTraces: [{ kind: 'wait_timed_out', actor: 'role:evaluator', timeoutMs: 600000 }],
    });
  });

  it('throws when a citation references an event that is not present', () => {
    const packetViews = replayAll([runStarted, runCompleted]);
    packetViews.evidence.citations[0] = {
      ...packetViews.evidence.citations[0]!,
      eventId: '00000000-0000-4000-8000-000000000099',
    };

    expect(() => assembleEvidencePacket(packetViews, [runStarted, runCompleted], 'run-1')).toThrow(/Missing event/);
  });
});
