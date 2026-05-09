import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { RunEventSchema, replayAll, type RunEvent } from '@pluto/v2-core';

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

function syntheticEvents(): RunEvent[] {
  return [
    {
      eventId: '11111111-1111-4111-8111-111111111111',
      runId: 'run-1',
      sequence: 0,
      timestamp: '2026-05-09T12:00:00.000Z',
      schemaVersion: '1.0',
      actor: { kind: 'system' },
      requestId: null,
      causationId: null,
      correlationId: null,
      entityRef: { kind: 'run', runId: 'run-1' },
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
      runId: 'run-1',
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
      runId: 'run-1',
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
      runId: 'run-1',
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
      runId: 'run-1',
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
      runId: 'run-1',
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
      runId: 'run-1',
      sequence: 6,
      timestamp: '2026-05-09T12:00:30.000Z',
      schemaVersion: '1.0',
      actor: { kind: 'manager' },
      requestId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa6',
      causationId: '66666666-6666-4666-8666-666666666666',
      correlationId: null,
      entityRef: { kind: 'run', runId: 'run-1' },
      outcome: 'accepted',
      kind: 'run_completed',
      payload: {
        status: 'succeeded',
        completedAt: '2026-05-09T12:00:30.000Z',
        summary: 'Generator completed the draft and attached the final artifact.',
      },
    },
  ].map((event) => RunEventSchema.parse(event));
}

async function createSyntheticRun(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'pluto-runs-cli-'));
  tempDirs.push(root);

  const runDir = join(root, 'run-1');
  const projectionsDir = join(runDir, 'projections');
  const evidenceDir = join(runDir, 'evidence');
  const artifactsDir = join(runDir, 'artifacts');
  await Promise.all([
    mkdir(projectionsDir, { recursive: true }),
    mkdir(evidenceDir, { recursive: true }),
    mkdir(artifactsDir, { recursive: true }),
  ]);

  const events = syntheticEvents();
  const views = replayAll(events);

  await Promise.all([
    writeFile(join(runDir, 'events.jsonl'), `${events.map((event) => JSON.stringify(event)).join('\n')}\n`, 'utf8'),
    writeFile(join(projectionsDir, 'tasks.json'), JSON.stringify(views.task.tasks, null, 2), 'utf8'),
    writeFile(join(projectionsDir, 'mailbox.jsonl'), `${views.mailbox.messages.map((message) => JSON.stringify(message)).join('\n')}\n`, 'utf8'),
    writeFile(join(projectionsDir, 'artifacts.json'), JSON.stringify([{ artifactId: 'artifact-1', kind: 'final', mediaType: 'text/plain', byteSize: 28 }], null, 2), 'utf8'),
    writeFile(join(runDir, 'evidence-packet.json'), JSON.stringify({
      schemaVersion: '1.0',
      kind: 'evidence_packet',
      runId: 'run-1',
      status: 'succeeded',
      summary: 'Generator completed the draft and attached the final artifact.',
      initiatingActor: { kind: 'role', role: 'lead' },
      startedAt: '2026-05-09T12:00:00.000Z',
      completedAt: '2026-05-09T12:00:30.000Z',
      generatedAt: '2026-05-09T12:00:30.000Z',
      citations: [],
      tasks: views.task.tasks,
      mailboxMessages: views.mailbox.messages.map(({ eventId: _eventId, ...message }) => message),
      artifacts: [{ artifactId: 'artifact-1', kind: 'final', mediaType: 'text/plain', byteSize: 28 }],
    }, null, 2), 'utf8'),
    writeFile(join(evidenceDir, 'final-reconciliation.json'), JSON.stringify({ summary: 'All cited work reconciled cleanly.', auditResult: 'pass' }, null, 2), 'utf8'),
    writeFile(join(artifactsDir, 'artifact-1.txt'), 'Draft artifact for explain smoke.', 'utf8'),
  ]);

  return runDir;
}

describe('pluto:runs replay', () => {
  it('passes when replay matches the task projection', async () => {
    const runDir = await createSyntheticRun();
    const capture = createIoCapture();

    const exitCode = await runCli(['replay', 'run-1', '--run-dir', runDir], capture.io);

    expect(exitCode).toBe(0);
    expect(capture.read().stdout).toContain('PASS — replay matches projection');
    expect(capture.read().stderr).toBe('');
  });

  it('returns drift when the stored projection diverges', async () => {
    const runDir = await createSyntheticRun();
    const tasksPath = join(runDir, 'projections', 'tasks.json');
    const original = JSON.parse(await readFile(tasksPath, 'utf8')) as Record<string, { state: string }>;
    original['task-1'] = {
      ...original['task-1'],
      state: 'failed',
    };
    await writeFile(tasksPath, JSON.stringify(original, null, 2), 'utf8');

    const capture = createIoCapture();
    const exitCode = await runCli(['replay', 'run-1', '--run-dir', runDir], capture.io);

    expect(exitCode).toBe(1);
    expect(capture.read().stdout).toContain('DRIFT — replay diverged at field tasks.task-1.state');
    expect(capture.read().stdout).toContain('replayed: "completed"');
    expect(capture.read().stdout).toContain('projection: "failed"');
  });
});

describe('pluto:runs explain', () => {
  it('renders the key sections in text mode', async () => {
    const runDir = await createSyntheticRun();
    const capture = createIoCapture();

    const exitCode = await runCli(['explain', 'run-1', '--run-dir', runDir], capture.io);

    expect(exitCode).toBe(0);
    const { stdout, stderr } = capture.read();
    expect(stderr).toBe('');
    expect(stdout).toContain('Run Metadata');
    expect(stdout).toContain('Actors');
    expect(stdout).toContain('Tasks');
    expect(stdout).toContain('Mailbox');
    expect(stdout).toContain('Artifacts');
    expect(stdout).toContain('Final Reconciliation');
  });

  it('supports structured JSON output and missing evidence gracefully', async () => {
    const runDir = await createSyntheticRun();
    await rm(join(runDir, 'evidence'), { recursive: true, force: true });

    const capture = createIoCapture();
    const exitCode = await runCli(['explain', 'run-1', '--run-dir', runDir, '--format=json'], capture.io);

    expect(exitCode).toBe(0);
    expect(capture.read().stderr).toBe('');
    const output = JSON.parse(capture.read().stdout) as Awaited<ReturnType<typeof __internal.explainRun>>;
    expect(output.runId).toBe('run-1');
    expect(output.finalReconciliation).toBeNull();
    expect(output.tasks).toHaveLength(1);
    expect(output.mailboxByActor[0]?.actor).toBe('role:generator');
    expect(output.artifacts[0]?.ref).toBe('artifacts/artifact-1.txt');
  });
});
