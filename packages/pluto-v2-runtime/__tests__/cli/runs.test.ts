import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { RunEventSchema, replayAll, type RunEvent } from '@pluto/v2-core';

import type { EvidencePacket, RuntimeDiagnostics } from '../../src/evidence/evidence-packet.js';
import { __internal, runCli } from '../../src/cli/runs.js';

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

function createIoCapture() {
  let stdout = '';
  let stderr = '';
  return {
    io: {
      stdout: {
        write(chunk: string) {
          stdout += chunk;
          return true;
        },
      },
      stderr: {
        write(chunk: string) {
          stderr += chunk;
          return true;
        },
      },
    },
    read() {
      return { stdout, stderr };
    },
  };
}

function syntheticEvents(options?: {
  readonly runId?: string;
  readonly status?: 'succeeded' | 'failed' | 'cancelled';
  readonly summary?: string;
}): RunEvent[] {
  const runId = options?.runId ?? 'run-1';
  const status = options?.status ?? 'succeeded';
  const summary = options?.summary ?? 'Generator completed the draft and attached the final artifact.';

  return [
    {
      eventId: '11111111-1111-4111-8111-111111111111',
      runId,
      sequence: 0,
      timestamp: '2026-05-09T12:00:00.000Z',
      schemaVersion: '1.0',
      actor: { kind: 'system' },
      requestId: null,
      causationId: null,
      correlationId: null,
      entityRef: { kind: 'run', runId },
      outcome: 'accepted',
      kind: 'run_started',
      payload: {
        scenarioRef: 'scenario/test',
        runProfileRef: 'unit-test',
        startedAt: '2026-05-09T12:00:00.000Z',
      },
    },
    {
      eventId: '22222222-2222-4222-8222-222222222222',
      runId,
      sequence: 1,
      timestamp: '2026-05-09T12:00:05.000Z',
      schemaVersion: '1.0',
      actor: { kind: 'role', role: 'lead' },
      requestId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1',
      causationId: '11111111-1111-4111-8111-111111111111',
      correlationId: null,
      entityRef: { kind: 'task', taskId: 'task-1' },
      outcome: 'accepted',
      kind: 'task_created',
      payload: {
        taskId: 'task-1',
        title: 'Draft the report',
        ownerActor: { kind: 'role', role: 'generator' },
        dependsOn: [],
      },
    },
    {
      eventId: '33333333-3333-4333-8333-333333333333',
      runId,
      sequence: 2,
      timestamp: '2026-05-09T12:00:10.000Z',
      schemaVersion: '1.0',
      actor: { kind: 'role', role: 'generator' },
      requestId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2',
      causationId: '22222222-2222-4222-8222-222222222222',
      correlationId: null,
      entityRef: { kind: 'task', taskId: 'task-1' },
      outcome: 'accepted',
      kind: 'task_state_changed',
      payload: {
        taskId: 'task-1',
        from: 'queued',
        to: 'running',
      },
    },
    {
      eventId: '44444444-4444-4444-8444-444444444444',
      runId,
      sequence: 3,
      timestamp: '2026-05-09T12:00:15.000Z',
      schemaVersion: '1.0',
      actor: { kind: 'role', role: 'generator' },
      requestId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa3',
      causationId: '33333333-3333-4333-8333-333333333333',
      correlationId: null,
      entityRef: { kind: 'mailbox_message', messageId: 'message-1' },
      outcome: 'accepted',
      kind: 'mailbox_message_appended',
      payload: {
        messageId: 'message-1',
        fromActor: { kind: 'role', role: 'generator' },
        toActor: { kind: 'role', role: 'lead' },
        kind: 'completion',
        body: 'Draft is ready for lead review.',
      },
    },
    {
      eventId: '55555555-5555-4555-8555-555555555555',
      runId,
      sequence: 4,
      timestamp: '2026-05-09T12:00:20.000Z',
      schemaVersion: '1.0',
      actor: { kind: 'role', role: 'generator' },
      requestId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa4',
      causationId: '44444444-4444-4444-8444-444444444444',
      correlationId: null,
      entityRef: { kind: 'artifact', artifactId: 'artifact-1' },
      outcome: 'accepted',
      kind: 'artifact_published',
      payload: {
        artifactId: 'artifact-1',
        kind: 'final',
        mediaType: 'text/plain',
        byteSize: 28,
      },
    },
    {
      eventId: '66666666-6666-4666-8666-666666666666',
      runId,
      sequence: 5,
      timestamp: '2026-05-09T12:00:25.000Z',
      schemaVersion: '1.0',
      actor: { kind: 'role', role: 'generator' },
      requestId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa5',
      causationId: '55555555-5555-4555-8555-555555555555',
      correlationId: null,
      entityRef: { kind: 'task', taskId: 'task-1' },
      outcome: 'accepted',
      kind: 'task_state_changed',
      payload: {
        taskId: 'task-1',
        from: 'running',
        to: 'completed',
      },
    },
    {
      eventId: '77777777-7777-4777-8777-777777777777',
      runId,
      sequence: 6,
      timestamp: '2026-05-09T12:00:30.000Z',
      schemaVersion: '1.0',
      actor: { kind: 'manager' },
      requestId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa6',
      causationId: '66666666-6666-4666-8666-666666666666',
      correlationId: null,
      entityRef: { kind: 'run', runId },
      outcome: 'accepted',
      kind: 'run_completed',
      payload: {
        status,
        completedAt: '2026-05-09T12:00:30.000Z',
        summary,
      },
    },
  ].map((event) => RunEventSchema.parse(event));
}

type TaskProjectionMap = ReturnType<typeof replayAll>['task']['tasks'];

async function createSyntheticRun(options?: {
  readonly runId?: string;
  readonly eventRunId?: string;
  readonly status?: 'succeeded' | 'failed' | 'cancelled';
  readonly summary?: string;
  readonly workspaceDefaultRoot?: boolean;
  readonly taskProjectionMutator?: (tasks: TaskProjectionMap) => TaskProjectionMap;
  readonly citations?: EvidencePacket['citations'];
  readonly runtimeDiagnostics?: RuntimeDiagnostics;
  readonly finalReconciliation?: Record<string, unknown> | null;
  readonly authoredSpecBody?: string | null;
  readonly runStateRunId?: string | null;
  readonly includeEvidencePacket?: boolean;
}): Promise<{ rootDir: string; runDir: string }> {
  const runId = options?.runId ?? 'run-1';
  const rootDir = await mkdtemp(join(tmpdir(), 'pluto-runs-cli-'));
  tempDirs.push(rootDir);

  const runDir = options?.workspaceDefaultRoot
    ? join(rootDir, '.pluto', 'runs', runId)
    : join(rootDir, runId);
  const projectionsDir = join(runDir, 'projections');
  const evidenceDir = join(runDir, 'evidence');
  const artifactsDir = join(runDir, 'artifacts');
  await Promise.all([
    mkdir(projectionsDir, { recursive: true }),
    mkdir(evidenceDir, { recursive: true }),
    mkdir(artifactsDir, { recursive: true }),
  ]);

  const events = syntheticEvents({
    runId: options?.eventRunId ?? runId,
    status: options?.status,
    summary: options?.summary,
  });
  const views = replayAll(events);
  const mutatedTasks = options?.taskProjectionMutator == null
    ? views.task.tasks
    : options.taskProjectionMutator(JSON.parse(JSON.stringify(views.task.tasks)) as TaskProjectionMap);

  const writes = [
    writeFile(join(runDir, 'events.jsonl'), `${events.map((event) => JSON.stringify(event)).join('\n')}\n`, 'utf8'),
    writeFile(join(projectionsDir, 'tasks.json'), JSON.stringify(mutatedTasks, null, 2), 'utf8'),
    writeFile(join(projectionsDir, 'mailbox.jsonl'), `${views.mailbox.messages.map((message) => JSON.stringify(message)).join('\n')}\n`, 'utf8'),
    writeFile(join(projectionsDir, 'artifacts.json'), JSON.stringify([{ artifactId: 'artifact-1', kind: 'final', mediaType: 'text/plain', byteSize: 28 }], null, 2), 'utf8'),
    writeFile(join(artifactsDir, 'artifact-1.txt'), 'Draft artifact for explain smoke.', 'utf8'),
  ];

  if (options?.includeEvidencePacket !== false) {
    writes.push(
      writeFile(join(runDir, 'evidence-packet.json'), JSON.stringify({
        schemaVersion: '1.0',
        kind: 'evidence_packet',
        runId: options?.eventRunId ?? runId,
        status: options?.status ?? 'succeeded',
        summary: options?.summary ?? 'Generator completed the draft and attached the final artifact.',
        initiatingActor: { kind: 'role', role: 'lead' },
        startedAt: '2026-05-09T12:00:00.000Z',
        completedAt: '2026-05-09T12:00:30.000Z',
        generatedAt: '2026-05-09T12:00:30.000Z',
        citations: options?.citations ?? [],
        tasks: mutatedTasks,
        mailboxMessages: views.mailbox.messages.map(({ eventId: _eventId, ...message }) => message),
        artifacts: [{ artifactId: 'artifact-1', kind: 'final', mediaType: 'text/plain', byteSize: 28 }],
        runtimeDiagnostics: options?.runtimeDiagnostics,
      }, null, 2), 'utf8'),
    );
  }

  if (options?.finalReconciliation !== null) {
    writes.push(
      writeFile(
        join(evidenceDir, 'final-reconciliation.json'),
        JSON.stringify(
          options?.finalReconciliation ?? {
            summary: 'All cited work reconciled cleanly.',
            audit: { status: 'pass', failures: [] },
          },
          null,
          2,
        ),
        'utf8',
      ),
    );
  }

  if (options?.authoredSpecBody != null) {
    writes.push(writeFile(join(runDir, 'authored-spec.yaml'), options.authoredSpecBody, 'utf8'));
  }

  if (options?.runStateRunId != null) {
    const stateDir = join(runDir, 'state');
    writes.push(
      mkdir(stateDir, { recursive: true }).then(() =>
        writeFile(join(stateDir, 'run-state.json'), JSON.stringify({ runId: options.runStateRunId }, null, 2), 'utf8'),
      ),
    );
  }

  await Promise.all(writes);
  return { rootDir, runDir };
}

describe.sequential('pluto:runs', () => {
  it('passes when replay matches the task projection', async () => {
    const { runDir } = await createSyntheticRun();
    const capture = createIoCapture();

    const exitCode = await runCli(['replay', 'run-1', '--run-dir', runDir], capture.io);

    expect(exitCode).toBe(0);
    expect(capture.read().stdout).toContain('PASS - replay matches projection');
    expect(capture.read().stderr).toBe('');
  });

  it('defaults to .pluto/runs/<runId> when --run-dir is omitted', async () => {
    const { rootDir } = await createSyntheticRun({ workspaceDefaultRoot: true });
    const capture = createIoCapture();
    const previousCwd = process.cwd();

    process.chdir(rootDir);
    try {
      const exitCode = await runCli(['replay', 'run-1'], capture.io);
      expect(exitCode).toBe(0);
      expect(capture.read().stdout).toContain('PASS - replay matches projection');
    } finally {
      process.chdir(previousCwd);
    }
  });

  it('returns drift when the stored projection diverges', async () => {
    const { runDir } = await createSyntheticRun({
      taskProjectionMutator(tasks) {
        const task = tasks['task-1'];
        if (task == null) {
          throw new Error('missing synthetic task-1');
        }
        return {
          ...tasks,
          'task-1': {
            ...task,
            state: 'failed',
          },
        };
      },
    });
    const capture = createIoCapture();

    const exitCode = await runCli(['replay', 'run-1', '--run-dir', runDir], capture.io);

    expect(exitCode).toBe(1);
    expect(capture.read().stdout).toContain('DRIFT - replay diverged at field tasks.task-1.state');
    expect(capture.read().stdout).toContain('replayed: "completed"');
    expect(capture.read().stdout).toContain('projection: "failed"');
  });

  it('warns and continues replay when a colocated authored-spec is malformed', async () => {
    const { runDir } = await createSyntheticRun({
      authoredSpecBody: 'runId: bad\n---\nrunId: duplicate\n',
    });
    const capture = createIoCapture();

    const exitCode = await runCli(['replay', 'run-1', '--run-dir', runDir], capture.io);

    expect(exitCode).toBe(0);
    expect(capture.read().stdout).toContain('PASS - replay matches projection');
    expect(capture.read().stderr).toContain('WARNING: unable to parse authored-spec.yaml for replay context recovery');
  });

  it('fails replay on runId mismatch from state/run-state.json', async () => {
    const { runDir } = await createSyntheticRun({ runStateRunId: 'wrong-run' });
    const capture = createIoCapture();

    const exitCode = await runCli(['replay', 'run-1', '--run-dir', runDir], capture.io);

    expect(exitCode).toBe(2);
    expect(capture.read().stderr).toContain('RUN_ID_MISMATCH: expected run-1, found wrong-run');
  });

  it('fails explain on runId mismatch from state/run-state.json', async () => {
    const { runDir } = await createSyntheticRun({ runStateRunId: 'wrong-run' });
    const capture = createIoCapture();

    const exitCode = await runCli(['explain', 'run-1', '--run-dir', runDir], capture.io);

    expect(exitCode).toBe(2);
    expect(capture.read().stderr).toContain('RUN_ID_MISMATCH: expected run-1, found wrong-run');
  });

  it('renders on-disk tasks, evidence citations, drift, and task history in text mode', async () => {
    const { runDir } = await createSyntheticRun({
      citations: [
        {
          eventId: '66666666-6666-4666-8666-666666666666',
          kind: 'run_completed',
          text: 'Generator completed the draft and attached the final artifact.',
          observedAt: '2026-05-09T12:00:30.000Z',
        },
      ],
      taskProjectionMutator(tasks) {
        const task = tasks['task-1'];
        if (task == null) {
          throw new Error('missing synthetic task-1');
        }
        return {
          ...tasks,
          'task-1': {
            ...task,
            title: 'Projection title wins',
          },
        };
      },
    });
    const capture = createIoCapture();

    const exitCode = await runCli(['explain', 'run-1', '--run-dir', runDir], capture.io);

    expect(exitCode).toBe(0);
    const { stdout, stderr } = capture.read();
    expect(stderr).toBe('');
    expect(stdout).toContain('Run Metadata');
    expect(stdout).toContain('- DRIFT: tasks projection differs from replay-derived tasks');
    expect(stdout).toContain('Tasks');
    expect(stdout).toContain('summary=Projection title wins');
    expect(stdout).toContain('queued -> running (2026-05-09T12:00:10.000Z) -> completed (2026-05-09T12:00:25.000Z)');
    expect(stdout).toContain('Evidence');
    expect(stdout).toContain('Generator completed the draft and attached the final artifact.');
    expect(stdout).toContain('Final Reconciliation');
  });

  it('emits structured JSON with citations, task drift, diagnostics, and task history', async () => {
    const { runDir } = await createSyntheticRun({
      status: 'failed',
      summary: 'Fallback summary that should not win.',
      citations: [
        {
          eventId: '44444444-4444-4444-8444-444444444444',
          kind: 'mailbox_message_appended',
          text: 'Generator reported the draft to the lead.',
          observedAt: '2026-05-09T12:00:15.000Z',
        },
      ],
      runtimeDiagnostics: {
        waitTraces: [
          {
            kind: 'wait_timed_out',
            actor: 'role:lead',
            timeoutMs: 120000,
          },
        ],
      },
      finalReconciliation: {
        summary: 'Audit failed after replay review.',
        audit: {
          status: 'failed_audit',
          failures: [{ kind: 'missing_message', ref: 'message-99' }],
        },
      },
      taskProjectionMutator(tasks) {
        const task = tasks['task-1'];
        if (task == null) {
          throw new Error('missing synthetic task-1');
        }
        return {
          ...tasks,
          'task-1': {
            ...task,
            state: 'failed',
          },
        };
      },
    });
    const capture = createIoCapture();

    const exitCode = await runCli(['explain', 'run-1', '--run-dir', runDir, '--format=json'], capture.io);

    expect(exitCode).toBe(0);
    expect(capture.read().stderr).toBe('');
    const output = JSON.parse(capture.read().stdout) as Awaited<ReturnType<typeof __internal.explainRun>>;
    expect(output.runId).toBe('run-1');
    expect(output.tasksDriftDetected).toBe(true);
    expect(output.citations).toHaveLength(1);
    expect(output.runtimeDiagnostics?.waitTraces).toHaveLength(1);
    expect(output.failureClassification).toBe('audit failure');
    expect(output.failureClassificationSource).toBe('structured');
    expect(output.tasks[0]?.history).toHaveLength(2);
    expect(output.tasks[0]?.state).toBe('failed');
  });

  it('handles missing evidence packet and final-reconciliation evidence gracefully', async () => {
    const { runDir } = await createSyntheticRun({
      includeEvidencePacket: false,
      finalReconciliation: null,
    });
    await rm(join(runDir, 'evidence'), { recursive: true, force: true });

    const capture = createIoCapture();
    const exitCode = await runCli(['explain', 'run-1', '--run-dir', runDir, '--format=json'], capture.io);

    expect(exitCode).toBe(0);
    expect(capture.read().stderr).toBe('');
    const output = JSON.parse(capture.read().stdout) as Awaited<ReturnType<typeof __internal.explainRun>>;
    expect(output.finalReconciliation).toBeNull();
    expect(output.citations).toEqual([]);
    expect(output.runtimeDiagnostics).toBeNull();
    expect(output.tasks).toHaveLength(1);
  });

  it('audit returns PASS and exit 0 when final-reconciliation reports pass', async () => {
    const { runDir } = await createSyntheticRun();
    const capture = createIoCapture();
    const exitCode = await runCli(['audit', 'run-1', '--run-dir', runDir], capture.io);

    expect(exitCode).toBe(0);
    expect(capture.read().stderr).toBe('');
    expect(capture.read().stdout).toContain('PASS - final reconciliation audit succeeded');
  });

  it('audit returns FAILED_AUDIT and exit 1 when final-reconciliation reports failed_audit', async () => {
    const { runDir } = await createSyntheticRun({
      finalReconciliation: {
        summary: 'Lead cited a missing task.',
        completedTaskIds: ['task-missing'],
        citedMessageIds: [],
        citedArtifactRefs: [],
        unresolvedIssues: [],
        audit: {
          status: 'failed_audit',
          failures: [{ kind: 'missing_task', ref: 'task-missing' }],
        },
      },
    });

    const capture = createIoCapture();
    const exitCode = await runCli(['audit', 'run-1', '--run-dir', runDir], capture.io);

    expect(exitCode).toBe(1);
    const stdout = capture.read().stdout;
    expect(stdout).toContain('FAILED_AUDIT - final reconciliation audit reported failures');
    expect(stdout).toContain('missing_task: task-missing');
  });

  it('audit returns ABSENT and exit 2 when no final-reconciliation evidence exists', async () => {
    const { runDir } = await createSyntheticRun({ finalReconciliation: null });
    await rm(join(runDir, 'evidence'), { recursive: true, force: true });

    const capture = createIoCapture();
    const exitCode = await runCli(['audit', 'run-1', '--run-dir', runDir], capture.io);

    expect(exitCode).toBe(2);
    expect(capture.read().stdout).toContain('ABSENT - no final-reconciliation evidence');
  });

  it('audit emits structured JSON when --format=json', async () => {
    const { runDir } = await createSyntheticRun({
      finalReconciliation: {
        summary: 'All cited work reconciled cleanly.',
        completedTaskIds: ['task-1'],
        citedMessageIds: ['msg-1'],
        citedArtifactRefs: ['artifact-1'],
        unresolvedIssues: [],
        audit: { status: 'pass', failures: [] },
      },
    });

    const capture = createIoCapture();
    const exitCode = await runCli(['audit', 'run-1', '--run-dir', runDir, '--format=json'], capture.io);

    expect(exitCode).toBe(0);
    const output = JSON.parse(capture.read().stdout) as Awaited<ReturnType<typeof __internal.auditRun>>;
    expect(output.status).toBe('pass');
    expect(output.completedTaskIds).toEqual(['task-1']);
    expect(output.citedMessageIds).toEqual(['msg-1']);
    expect(output.citedArtifactRefs).toEqual(['artifact-1']);
    expect(output.failures).toEqual([]);
  });
});
