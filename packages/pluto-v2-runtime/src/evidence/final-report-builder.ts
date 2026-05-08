import type { ActorRef, ReplayViews } from '@pluto/v2-core';

type ReportArtifact = {
  readonly artifactId: string;
  readonly kind: string;
  readonly mediaType: string;
  readonly byteSize: number;
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

  const exhaustiveActor: never = actor;
  return String(exhaustiveActor);
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
  for (const [taskId, task] of Object.entries(input.tasks.tasks)) {
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

  return `${lines.join('\n')}\n`;
}
