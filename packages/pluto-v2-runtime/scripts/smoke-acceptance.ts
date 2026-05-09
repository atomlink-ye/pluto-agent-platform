import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import type { RunEvent } from '../../pluto-v2-core/src/index.ts';

const ACCEPTED_MUTATION_EVENT_KINDS = new Set([
  'task_created',
  'task_state_changed',
  'mailbox_message_appended',
  'artifact_published',
  'run_completed',
]);
const TERMINAL_TASK_STATES = new Set(['completed', 'cancelled', 'failed']);
const MUTATION_COMMAND_PATTERN = /\b(create-task|change-task-state|send-mailbox|publish-artifact|complete-run)\b/;
const READ_STATE_COMMAND_PATTERN = /\bread-state\b/;

export type SmokeAcceptanceArtifacts = {
  events: ReadonlyArray<RunEvent>;
  transcripts: Readonly<Record<string, string>>;
  finalReport: string;
};

export type SmokeAcceptanceResult = {
  ok: boolean;
  failures: string[];
};

function parseJsonLines<T>(text: string): T[] {
  return text
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .map((line) => JSON.parse(line) as T);
}

function isRoleActor(actor: unknown): actor is { kind: 'role'; role: string } {
  return typeof actor === 'object' && actor != null && 'kind' in actor && actor.kind === 'role' && 'role' in actor;
}

function actorKeyOf(actor: unknown): string | null {
  if (typeof actor !== 'object' || actor == null || !('kind' in actor)) {
    return null;
  }

  if (actor.kind === 'manager') {
    return 'manager';
  }

  if (actor.kind === 'system') {
    return 'system';
  }

  if (actor.kind === 'role' && 'role' in actor && typeof actor.role === 'string') {
    return `role:${actor.role}`;
  }

  return null;
}

function acceptedTerminalRunEvent(events: ReadonlyArray<RunEvent>): Extract<RunEvent, { kind: 'run_completed' }> | null {
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const event = events[index];
    if (event?.kind === 'run_completed' && event.outcome === 'accepted') {
      return event;
    }
  }

  return null;
}

function delegatedTaskStates(events: ReadonlyArray<RunEvent>): Map<string, string> {
  const states = new Map<string, string>();

  for (const event of events) {
    if (event.outcome !== 'accepted') {
      continue;
    }
    if (event.kind === 'task_created') {
      const ownerActor = event.payload.ownerActor;
      if (isRoleActor(ownerActor) && ownerActor.role !== 'lead') {
        states.set(event.payload.taskId, 'queued');
      }
      continue;
    }
    if (event.kind === 'task_state_changed' && states.has(event.payload.taskId)) {
      states.set(event.payload.taskId, event.payload.to);
    }
  }

  return states;
}

function acceptedMutationEventsByActor(events: ReadonlyArray<RunEvent>): Map<string, RunEvent[]> {
  const byActor = new Map<string, RunEvent[]>();

  for (const event of events) {
    if (event.outcome !== 'accepted' || !ACCEPTED_MUTATION_EVENT_KINDS.has(event.kind)) {
      continue;
    }

    const key = actorKeyOf(event.actor);
    if (key == null) {
      continue;
    }

    const bucket = byActor.get(key) ?? [];
    bucket.push(event);
    byActor.set(key, bucket);
  }

  return byActor;
}

function pollingFailuresByActor(input: {
  events: ReadonlyArray<RunEvent>;
  transcripts: Readonly<Record<string, string>>;
}): string[] {
  const failures: string[] = [];
  const mutationsByActor = acceptedMutationEventsByActor(input.events);

  for (const [actor, transcript] of Object.entries(input.transcripts)) {
    const mutationEvents = mutationsByActor.get(actor) ?? [];
    let mutationIndex = -1;
    let readStateCallsSinceMutation = 0;

    for (const rawLine of transcript.split('\n')) {
      const line = rawLine.trim();
      if (line.length === 0) {
        continue;
      }

      if (READ_STATE_COMMAND_PATTERN.test(line)) {
        if (mutationIndex >= 0) {
          readStateCallsSinceMutation += 1;
        }
        continue;
      }

      if (!MUTATION_COMMAND_PATTERN.test(line)) {
        continue;
      }

      if (mutationIndex >= 0 && readStateCallsSinceMutation > 0) {
        failures.push(
          `polling_detected: actor=${actor} after_mutation=${mutationEvents[mutationIndex]?.eventId ?? `mutation-${mutationIndex + 1}`} read_state_calls=${readStateCallsSinceMutation}`,
        );
      }

      mutationIndex += 1;
      readStateCallsSinceMutation = 0;
    }
  }

  return failures;
}

export function checkSmokeAcceptance(input: SmokeAcceptanceArtifacts & { expectFailure: boolean }): SmokeAcceptanceResult {
  const failures: string[] = [];
  const terminalRunEvent = acceptedTerminalRunEvent(input.events);
  const expectedStatus = input.expectFailure ? 'failed' : 'succeeded';

  if (terminalRunEvent == null || terminalRunEvent.payload.status !== expectedStatus) {
    failures.push(input.expectFailure ? 'run did not fail as expected' : 'run did not succeed');
  }

  // Expected-failure mode exists for early bridge regressions where the run aborts
  // before any delegation or sub-actor activity can happen. In that mode we only
  // invert the terminal status check and intentionally relax the other criteria.
  if (input.expectFailure) {
    return { ok: failures.length === 0, failures };
  }

  const hasAcceptedTaskCreated = input.events.some((event) => event.kind === 'task_created' && event.outcome === 'accepted');
  // Fallback (for workflows without tasks) requires the mutation to come from a
  // SUB-ACTOR — i.e. a non-lead role actor — not lead itself, since lead's own
  // mutation is part of the orchestration shell, not evidence that the team
  // collaborated.
  const hasAcceptedSubActorMutation = input.events.some((event) =>
    event.outcome === 'accepted'
    && ACCEPTED_MUTATION_EVENT_KINDS.has(event.kind)
    && isRoleActor(event.actor)
    && event.actor.role !== 'lead',
  );
  if (!hasAcceptedTaskCreated && !hasAcceptedSubActorMutation) {
    failures.push('missing accepted task_created or accepted sub-actor (non-lead) mutation event');
  }

  // Criterion 2: the sub-actor must explicitly REPORT BACK with a completion
  // (or final) mailbox kind to lead. A `plan` or `progress` mailbox message is
  // not evidence that delegated work finished.
  const hasAcceptedSubActorMailbox = input.events.some((event) =>
    event.kind === 'mailbox_message_appended'
    && event.outcome === 'accepted'
    && isRoleActor(event.actor)
    && event.actor.role !== 'lead'
    && event.payload.toActor.kind === 'role'
    && event.payload.toActor.role === 'lead'
    && (event.payload.kind === 'completion' || event.payload.kind === 'final'),
  );
  if (!hasAcceptedSubActorMailbox) {
    failures.push('missing accepted mailbox_message_appended (kind: completion|final) from a sub-actor back to lead');
  }

  const nonEmptyTranscriptActors = Object.entries(input.transcripts)
    .filter(([, transcript]) => transcript.trim().length > 0)
    .map(([actorKey]) => actorKey);
  const hasLeadTranscript = nonEmptyTranscriptActors.includes('role:lead');
  const hasSubActorTranscript = nonEmptyTranscriptActors.some((actorKey) => actorKey.startsWith('role:') && actorKey !== 'role:lead');
  if (!hasLeadTranscript || !hasSubActorTranscript || nonEmptyTranscriptActors.length < 2) {
    failures.push('fewer than 2 actors have non-empty transcripts');
  }

  const nonTerminalDelegatedTasks = [...delegatedTaskStates(input.events).entries()]
    .filter(([, state]) => !TERMINAL_TASK_STATES.has(state))
    .map(([taskId, state]) => `${taskId}=${state}`);
  if (nonTerminalDelegatedTasks.length > 0) {
    failures.push(`delegated task did not reach terminal state: ${nonTerminalDelegatedTasks.join(', ')}`);
  }

  failures.push(...pollingFailuresByActor(input));

  return { ok: failures.length === 0, failures };
}

export function loadSmokeAcceptanceArtifacts(runDir: string): SmokeAcceptanceArtifacts {
  const events = parseJsonLines<RunEvent>(readFileSync(join(runDir, 'events.jsonl'), 'utf8'));
  const finalReport = readFileSync(join(runDir, 'final-report.md'), 'utf8');
  const transcriptDir = join(runDir, 'paseo-transcripts');
  const transcripts = Object.fromEntries(
    readdirSync(transcriptDir)
      .filter((fileName) => fileName.endsWith('.txt'))
      .map((fileName) => [fileName.slice(0, -'.txt'.length), readFileSync(join(transcriptDir, fileName), 'utf8')]),
  );

  return {
    events,
    transcripts,
    finalReport,
  };
}

export function checkSmokeAcceptanceForRunDir(input: { runDir: string; expectFailure: boolean }): SmokeAcceptanceResult {
  try {
    return checkSmokeAcceptance({
      ...loadSmokeAcceptanceArtifacts(input.runDir),
      expectFailure: input.expectFailure,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      ok: false,
      failures: [`unable to read smoke artifacts: ${message}`],
    };
  }
}
