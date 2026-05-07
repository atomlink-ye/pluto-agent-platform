import {
  ActorRefSchema,
  CompleteRunRequestPayloadSchema,
  FakeScriptStepSchema,
  ProtocolRequestSchema,
  SCHEMA_VERSION,
  type ClockProvider,
  type FakeScriptStep,
  type IdProvider,
  type ProtocolRequest,
} from '@pluto/v2-core';

import type { KernelView } from '../../runtime/kernel-view.js';

const FAKE_SCRIPT_REF_PATTERN = /^events\[(0|[1-9]\d*)\]\.payload\.([A-Za-z0-9_.]+)$/;

type ResolvedFakeStep = {
  actor: FakeScriptStep['actor'];
  intent: FakeScriptStep['intent'];
  payload: unknown;
  idempotencyKey: string | null;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isRefToken(value: unknown): value is { $ref: string } {
  return isRecord(value) && Object.keys(value).length === 1 && typeof value.$ref === 'string';
}

function requestBackedAcceptedEvents(view: KernelView) {
  return view.events.filter((event) => event.outcome === 'accepted' && event.kind !== 'run_started');
}

function resolveRefToken(token: { $ref: string }, view: KernelView): unknown {
  const match = FAKE_SCRIPT_REF_PATTERN.exec(token.$ref);
  if (!match) {
    throw new Error(`Malformed fakeScript ref token ${token.$ref}`);
  }

  const eventIndexMatch = match[1];
  const pathMatch = match[2];
  if (eventIndexMatch == null || pathMatch == null) {
    throw new Error(`Malformed fakeScript ref token ${token.$ref}`);
  }

  const eventIndex = Number.parseInt(eventIndexMatch, 10);
  const path = pathMatch.split('.');
  const event = requestBackedAcceptedEvents(view)[eventIndex];
  if (!event) {
    throw new Error(`fakeScript ref ${token.$ref} points to a missing event at accepted index ${eventIndex}`);
  }

  let current: unknown = event.payload;
  for (const [segmentIndex, segment] of path.entries()) {
    if (!isRecord(current) || !(segment in current)) {
      throw new Error(
        `fakeScript ref ${token.$ref} points to a missing payload path ${path.slice(0, segmentIndex + 1).join('.')}`,
      );
    }

    current = current[segment];
  }

  return current;
}

export function resolveFakeScriptValue(value: unknown, view: KernelView): unknown {
  if (isRefToken(value)) {
    return resolveRefToken(value, view);
  }

  if (Array.isArray(value)) {
    return value.map((entry) => resolveFakeScriptValue(entry, view));
  }

  if (isRecord(value)) {
    return Object.fromEntries(
      Object.entries(value).map(([key, entry]) => [key, resolveFakeScriptValue(entry, view)]),
    );
  }

  return value;
}

export function resolveFakeScriptStep(step: FakeScriptStep, view: KernelView): ResolvedFakeStep {
  const parsedStep = FakeScriptStepSchema.parse(step);
  const payload = resolveFakeScriptValue(parsedStep.payload, view);

  if (parsedStep.intent === 'complete_run' && parsedStep.actor.kind !== 'manager') {
    throw new Error('fakeScript complete_run steps must use the manager actor');
  }

  return {
    actor: parsedStep.actor,
    intent: parsedStep.intent,
    payload,
    idempotencyKey: parsedStep.idempotencyKey ?? null,
  };
}

export function materializeFakeProtocolRequest(
  step: FakeScriptStep,
  view: KernelView,
  providers: { idProvider: IdProvider; clockProvider: ClockProvider },
): ProtocolRequest {
  const resolved = resolveFakeScriptStep(step, view);

  if (resolved.intent === 'complete_run') {
    throw new Error('complete_run fakeScript steps must be emitted via RuntimeAdapter done');
  }

  return ProtocolRequestSchema.parse({
    requestId: providers.idProvider.next(),
    runId: view.state.runId,
    actor: ActorRefSchema.parse(resolved.actor),
    intent: resolved.intent,
    payload: resolved.payload,
    idempotencyKey: resolved.idempotencyKey,
    clientTimestamp: providers.clockProvider.nowIso(),
    schemaVersion: SCHEMA_VERSION,
  });
}

export function materializeFakeCompletion(step: FakeScriptStep, view: KernelView) {
  const resolved = resolveFakeScriptStep(step, view);
  if (resolved.intent !== 'complete_run') {
    throw new Error(`Expected complete_run step, received ${resolved.intent}`);
  }

  return CompleteRunRequestPayloadSchema.parse(resolved.payload);
}

export { FakeScriptStepSchema };
