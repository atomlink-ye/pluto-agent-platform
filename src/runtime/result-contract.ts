import type { AgentEvent, AgentRoleId, BlockerReasonV0 } from "../contracts/types.js";
import { normalizeBlockerReason } from "../orchestrator/blocker-classifier.js";
import { redactWorkspacePath } from "../orchestrator/redactor.js";
import { getCallbackIdentity, type AdapterCallbackIdentity } from "./callback-normalizer.js";

export type PortableRuntimeResultRefKindV0 = "artifact" | "blocker" | "result";

export type PortableRuntimeResultValueKeyV0 = "output" | "markdown";

export interface PortableRuntimeResultRefV0 {
  schemaVersion: 0;
  kind: PortableRuntimeResultRefKindV0;
  runId: string;
  eventId: string;
  occurredAt: string;
  roleId: AgentRoleId | null;
  sessionId: string | null;
  callback: AdapterCallbackIdentity;
  artifactPath?: string | null;
  blockerReason?: BlockerReasonV0 | null;
  resultStatus?: "completed" | "failed" | null;
}

export interface PortableRuntimeResultValueRefV0 {
  schemaVersion: 0;
  kind: "value";
  runId: string;
  eventId: string;
  occurredAt: string;
  roleId: AgentRoleId | null;
  sessionId: string | null;
  callback: AdapterCallbackIdentity;
  valueKey: PortableRuntimeResultValueKeyV0;
  valueType: "text/plain" | "text/markdown";
}

export type PortableRuntimeResultAnyRefV0 =
  | PortableRuntimeResultRefV0
  | PortableRuntimeResultValueRefV0;

export function buildPortableRuntimeResultRefV0(
  event: AgentEvent,
): PortableRuntimeResultRefV0 | null {
  if (event.type !== "artifact_created" && event.type !== "blocker" && event.type !== "run_completed" && event.type !== "run_failed") {
    return null;
  }

  const callback = getCallbackIdentity(event);
  const ref: PortableRuntimeResultRefV0 = {
    schemaVersion: 0,
    kind: classifyRefKind(event),
    runId: event.runId,
    eventId: event.id,
    occurredAt: event.ts,
    roleId: event.roleId ?? null,
    sessionId: event.sessionId ?? null,
    callback,
  };

  if (event.type === "artifact_created") {
    ref.artifactPath = typeof event.payload?.["path"] === "string"
      ? redactWorkspacePath(event.payload["path"])
      : null;
  }

  if (event.type === "blocker") {
    const message = typeof event.payload?.["message"] === "string"
      ? event.payload["message"]
      : "";
    ref.blockerReason = normalizeBlockerReason(event.payload?.["reason"], message) ?? "unknown";
  }

  if (event.type === "run_completed" || event.type === "run_failed") {
    ref.resultStatus = event.type === "run_completed" ? "completed" : "failed";
  }

  return ref;
}

export function collectPortableRuntimeResultRefs(
  events: readonly AgentEvent[],
): PortableRuntimeResultAnyRefV0[] {
  const refs: PortableRuntimeResultAnyRefV0[] = [];
  const seen = new Set<string>();

  for (const event of events) {
    const ref = buildPortableRuntimeResultRefV0(event);
    if (ref) {
      const key = `${ref.kind}:${ref.callback.eventId}`;
      if (!seen.has(key)) {
        seen.add(key);
        refs.push(ref);
      }
    }

    for (const valueRef of readPortableRuntimeResultValueRefs(event)) {
      const key = `${valueRef.kind}:${valueRef.eventId}:${valueRef.valueKey}`;
      if (seen.has(key)) continue;
      seen.add(key);
      refs.push(valueRef);
    }
  }

  return refs;
}

export function buildPortableRuntimeResultValueRefV0(
  event: AgentEvent,
  valueKey: PortableRuntimeResultValueKeyV0,
): PortableRuntimeResultValueRefV0 {
  return {
    schemaVersion: 0,
    kind: "value",
    runId: event.runId,
    eventId: event.id,
    occurredAt: event.ts,
    roleId: event.roleId ?? null,
    sessionId: event.sessionId ?? null,
    callback: getCallbackIdentity(event),
    valueKey,
    valueType: valueKey === "markdown" ? "text/markdown" : "text/plain",
  };
}

export function readPortableRuntimeResultValueRef(
  event: AgentEvent,
  valueKey: PortableRuntimeResultValueKeyV0,
): PortableRuntimeResultValueRefV0 | null {
  const refKey = valueKey === "markdown" ? "markdownRef" : "outputRef";
  return asPortableRuntimeResultValueRef(event.payload?.[refKey], valueKey);
}

export function readPortableRuntimeResultValueRefs(
  event: AgentEvent,
): PortableRuntimeResultValueRefV0[] {
  const refs: PortableRuntimeResultValueRefV0[] = [];
  const outputRef = readPortableRuntimeResultValueRef(event, "output");
  const markdownRef = readPortableRuntimeResultValueRef(event, "markdown");
  if (outputRef) refs.push(outputRef);
  if (markdownRef) refs.push(markdownRef);
  return refs;
}

function asPortableRuntimeResultValueRef(
  value: unknown,
  valueKey: PortableRuntimeResultValueKeyV0,
): PortableRuntimeResultValueRefV0 | null {
  if (typeof value !== "object" || value === null) {
    return null;
  }

  const ref = value as Partial<PortableRuntimeResultValueRefV0>;
  if (
    ref.schemaVersion !== 0 ||
    ref.kind !== "value" ||
    typeof ref.runId !== "string" ||
    typeof ref.eventId !== "string" ||
    typeof ref.occurredAt !== "string" ||
    ref.valueKey !== valueKey ||
    (ref.valueType !== "text/plain" && ref.valueType !== "text/markdown") ||
    typeof ref.callback !== "object" ||
    ref.callback === null
  ) {
    return null;
  }

  return ref as PortableRuntimeResultValueRefV0;
}

function classifyRefKind(event: AgentEvent): PortableRuntimeResultRefKindV0 {
  if (event.type === "artifact_created") return "artifact";
  if (event.type === "blocker") return "blocker";
  return "result";
}
