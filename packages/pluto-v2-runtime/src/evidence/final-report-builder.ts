import type { ActorRef, ReplayViews } from '@pluto/v2-core';

import type { RuntimeDiagnostics, RuntimeWaitTrace } from './evidence-packet.js';

type ReportArtifact = {
  readonly artifactId: string;
  readonly kind: string;
  readonly mediaType: string;
  readonly byteSize: number;
};

type ReportTask = {
  readonly title: string;
  readonly state: string;
};

function actorKey(
  actor:
    | { readonly kind: 'manager' | 'system' | 'broadcast' }
    | { readonly kind: 'role'; readonly role: string },
): string {
  switch (actor.kind) {
    case 'manager':
      return 'manager';
    case 'system':
      return 'system';
    case 'broadcast':
      return 'broadcast';
    case 'role':
      return `role:${actor.role}`;
  }

  return 'unknown';
}

function initiatingActorLabel(actor: ActorRef | null): string {
  if (actor == null) {
    return 'unknown';
  }

  switch (actor.kind) {
    case 'manager':
      return 'manager';
    case 'system':
      return 'system';
    case 'role':
      return `${actor.role} (role)`;
  }

  return 'unknown';
}

function failureWaitTracesOf(runtimeDiagnostics: RuntimeDiagnostics | undefined): RuntimeWaitTrace[] {
  return (runtimeDiagnostics?.waitTraces ?? []).filter((trace: RuntimeWaitTrace) =>
    trace.kind === 'wait_cancelled' || trace.kind === 'wait_timed_out',
  );
}

function appendDiagnostics(lines: string[], runtimeDiagnostics: RuntimeDiagnostics | undefined): void {
  const bridgeUnavailable = runtimeDiagnostics?.bridgeUnavailable ?? [];
  const taskCloseoutRejected = runtimeDiagnostics?.taskCloseoutRejected ?? [];
  const waitTraces = failureWaitTracesOf(runtimeDiagnostics);

  if (bridgeUnavailable.length === 0 && taskCloseoutRejected.length === 0 && waitTraces.length === 0) {
    return;
  }

  lines.push('', '## Diagnostics');

  for (const trace of bridgeUnavailable) {
    lines.push(`- bridge_unavailable (${trace.actor}): ${trace.reason} (${trace.latencyMs} ms)`);
  }

  for (const trace of taskCloseoutRejected) {
    lines.push(`- task_closeout_rejected (${trace.actor}, ${trace.taskId}): ${trace.reason}`);
  }

  for (const trace of waitTraces) {
    if (trace.kind === 'wait_cancelled') {
      lines.push(`- wait_cancelled (${trace.actor}): ${trace.reason}`);
      continue;
    }

    if (trace.kind === 'wait_timed_out') {
      lines.push(`- wait_timed_out (${trace.actor}): timeout ${trace.timeoutMs} ms`);
    }
  }
}

export function renderFinalReport(input: {
  readonly runId: string;
  readonly status: string;
  readonly summary: string | null;
  readonly initiatingActor: ActorRef | null;
  readonly evidence: ReplayViews['evidence'];
  readonly tasks: ReplayViews['task'];
  readonly mailbox: ReplayViews['mailbox'];
  readonly artifacts: ReadonlyArray<ReportArtifact>;
  readonly runtimeDiagnostics?: RuntimeDiagnostics;
}): string {
  const lines = [
    '# Pluto v2 Paseo Live Smoke',
    '',
    `- Run ID: ${input.runId}`,
    `- Status: ${input.status}`,
    `- Summary: ${input.summary ?? 'none'}`,
    `- Initiated by: ${initiatingActorLabel(input.initiatingActor)}`,
    '',
    '## Evidence Citations',
  ];

  for (const citation of input.evidence.citations) {
    lines.push(`- [${citation.sequence}] ${citation.kind}: ${citation.summary}`);
  }

  lines.push('', '## Tasks');
  for (const [taskId, task] of Object.entries(input.tasks.tasks as Record<string, ReportTask>)) {
    lines.push(`- ${taskId}: ${task.title} (${task.state})`);
  }

  lines.push('', '## Mailbox');
  for (const message of input.mailbox.messages) {
    lines.push(`- [${message.sequence}] ${actorKey(message.fromActor)} -> ${actorKey(message.toActor)} (${message.kind})`);
    lines.push(`  ${message.body}`);
  }

  lines.push('', '## Artifacts');
  for (const artifact of input.artifacts) {
    lines.push(`- ${artifact.artifactId}: ${artifact.kind} ${artifact.mediaType} (${artifact.byteSize} bytes)`);
  }

  appendDiagnostics(lines, input.runtimeDiagnostics);

  return `${lines.join('\n')}\n`;
}
