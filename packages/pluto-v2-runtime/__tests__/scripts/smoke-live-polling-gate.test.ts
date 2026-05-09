import { SCHEMA_VERSION, type ActorRef, type RunEvent } from '@pluto/v2-core';
import { describe, expect, it } from 'vitest';

import { detectPollingBetweenMutations } from '../../scripts/smoke-acceptance.js';

const MANAGER: ActorRef = { kind: 'manager' };
const LEAD: ActorRef = { kind: 'role', role: 'lead' };

function baseEvent(sequence: number, actor: ActorRef) {
  return {
    eventId: `00000000-0000-4000-8000-${String(sequence + 1).padStart(12, '0')}`,
    requestId: `00000000-0000-4000-8000-${String(sequence + 101).padStart(12, '0')}`,
    runId: 'run-smoke-live-polling-gate',
    actor,
    timestamp: `2026-05-09T00:00:${String(sequence).padStart(2, '0')}.000Z`,
    sequence,
    schemaVersion: SCHEMA_VERSION,
  };
}

function leadMailboxMutation(sequence: number, messageId: string): RunEvent {
  return {
    ...baseEvent(sequence, LEAD),
    kind: 'mailbox_message_appended',
    outcome: 'accepted',
    payload: {
      messageId,
      fromActor: LEAD,
      toActor: MANAGER,
      kind: 'progress',
      body: 'update',
    },
  } as unknown as RunEvent;
}

describe('smoke-live polling gate helper', () => {
  it('flags read-state polling between same-actor mutations', () => {
    const detections = detectPollingBetweenMutations({
      events: [leadMailboxMutation(0, 'message-1'), leadMailboxMutation(1, 'message-2')],
      transcripts: {
        'role:lead': [
          'pluto-tool send-mailbox --to=manager --kind=progress --body="first"',
          'pluto-tool read-state',
          'pluto-tool read-state',
          'pluto-tool send-mailbox --to=manager --kind=progress --body="second"',
        ].join('\n'),
      },
    });

    expect(detections).toEqual([
      {
        actor: 'role:lead',
        afterMutationEventId: '00000000-0000-4000-8000-000000000001',
        readStateCalls: 2,
      },
    ]);
  });

  it('stays clean when read-state never appears between same-actor mutations', () => {
    const detections = detectPollingBetweenMutations({
      events: [leadMailboxMutation(0, 'message-1'), leadMailboxMutation(1, 'message-2')],
      transcripts: {
        'role:lead': [
          'pluto-tool send-mailbox --to=manager --kind=progress --body="first"',
          'Notes mention read-state, but there was no tool call.',
          'pluto-tool send-mailbox --to=manager --kind=progress --body="second"',
        ].join('\n'),
      },
    });

    expect(detections).toEqual([]);
  });
});
