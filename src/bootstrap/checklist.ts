import type { PrincipalRefV0 } from "../contracts/identity.js";
import {
  normalizeBootstrapStatusV0,
  type BootstrapChecklistItemV0,
  type BootstrapChecklistV0,
  type BootstrapObjectRefV0,
  type BootstrapSessionV0,
  type BootstrapStatusLikeV0,
  type BootstrapStepV0,
} from "./contracts.js";

function uniqueActorRefs(actorRefs: readonly PrincipalRefV0[]): PrincipalRefV0[] {
  const seen = new Set<string>();
  const result: PrincipalRefV0[] = [];

  for (const actorRef of actorRefs) {
    const key = `${actorRef.workspaceId}:${actorRef.kind}:${actorRef.principalId}`;
    if (seen.has(key)) {
      continue;
    }

    seen.add(key);
    result.push(actorRef);
  }

  return result;
}

function uniqueObjectRefs(objectRefs: readonly BootstrapObjectRefV0[]): BootstrapObjectRefV0[] {
  const seen = new Set<string>();
  const result: BootstrapObjectRefV0[] = [];

  for (const objectRef of objectRefs) {
    if (seen.has(objectRef.id)) {
      continue;
    }

    seen.add(objectRef.id);
    result.push(objectRef);
  }

  return result;
}

function toChecklistItem(step: BootstrapStepV0): BootstrapChecklistItemV0 {
  return {
    stepId: step.id,
    stableKey: step.stableKey,
    title: step.title,
    status: normalizeBootstrapStatusV0(step.status) ?? "failed",
    blockingReason: step.blockingReason,
    resolutionHint: step.resolutionHint,
    dependsOnStepIds: [...step.dependsOnStepIds],
    createdObjectRefs: uniqueObjectRefs(step.createdObjectRefs),
  };
}

function compareTimestamps(left: string, right: string): number {
  return left.localeCompare(right);
}

function orderSteps(session: BootstrapSessionV0, steps: readonly BootstrapStepV0[]): BootstrapStepV0[] {
  const stepsById = new Map(steps.map((step) => [step.id, step]));
  const ordered: BootstrapStepV0[] = [];

  for (const stepId of session.stepIds) {
    const step = stepsById.get(stepId);
    if (step) {
      ordered.push(step);
      stepsById.delete(stepId);
    }
  }

  const remaining = [...stepsById.values()].sort((left, right) => {
    const createdAtOrder = compareTimestamps(left.createdAt, right.createdAt);
    if (createdAtOrder !== 0) {
      return createdAtOrder;
    }

    return left.id.localeCompare(right.id);
  });

  return [...ordered, ...remaining];
}

function deriveChecklistStatus(
  sessionStatus: BootstrapStatusLikeV0,
  itemStatuses: readonly BootstrapStatusLikeV0[],
): BootstrapStatusLikeV0 {
  if (sessionStatus === "blocked" || itemStatuses.includes("blocked")) {
    return "blocked";
  }
  if (sessionStatus === "failed" || itemStatuses.includes("failed")) {
    return "failed";
  }
  if (sessionStatus === "succeeded") {
    return "succeeded";
  }
  if (itemStatuses.length > 0 && itemStatuses.every((status) => status === "succeeded")) {
    return "succeeded";
  }
  if (sessionStatus === "running" || itemStatuses.some((status) => status === "running" || status === "succeeded")) {
    return "running";
  }
  if (sessionStatus === "queued") {
    return "queued";
  }
  if (sessionStatus === "pending") {
    return "pending";
  }

  return sessionStatus;
}

function deriveBlockingMetadata(
  session: BootstrapSessionV0,
  items: readonly BootstrapChecklistItemV0[],
): Pick<BootstrapChecklistV0, "blockingReason" | "resolutionHint"> {
  const normalizedSessionStatus = normalizeBootstrapStatusV0(session.status);
  if (
    (normalizedSessionStatus === "blocked" || normalizedSessionStatus === "failed")
    && session.blockingReason
  ) {
    return {
      blockingReason: session.blockingReason,
      resolutionHint: session.resolutionHint,
    };
  }

  const blockedItem = items.find((item) =>
    (item.status === "blocked" || item.status === "failed") && item.blockingReason,
  );

  return {
    blockingReason: blockedItem?.blockingReason ?? null,
    resolutionHint: blockedItem?.resolutionHint ?? null,
  };
}

export function projectBootstrapChecklistV0(input: {
  session: BootstrapSessionV0;
  steps: readonly BootstrapStepV0[];
}): BootstrapChecklistV0 {
  const orderedSteps = orderSteps(input.session, input.steps);
  const items = orderedSteps.map(toChecklistItem);
  const sessionStatus = normalizeBootstrapStatusV0(input.session.status) ?? "failed";
  const createdObjectRefs = uniqueObjectRefs([
    ...input.session.createdObjectRefs,
    ...orderedSteps.flatMap((step) => step.createdObjectRefs),
  ]);
  const actorRefs = uniqueActorRefs([
    ...input.session.actorRefs,
    ...orderedSteps.flatMap((step) => step.actorRefs),
  ]);
  const updatedAt = orderedSteps.reduce(
    (latest, step) => (compareTimestamps(step.updatedAt, latest) > 0 ? step.updatedAt : latest),
    input.session.updatedAt,
  );
  const completedStepCount = items.filter((item) => item.status === "succeeded").length;

  return {
    schema: "pluto.bootstrap.checklist",
    schemaVersion: 0,
    id: `${input.session.id}:checklist`,
    sessionId: input.session.id,
    workspaceRef: input.session.workspaceRef,
    actorRefs,
    status: deriveChecklistStatus(
      sessionStatus,
      items.map((item) => item.status),
    ),
    createdAt: input.session.createdAt,
    updatedAt,
    ...deriveBlockingMetadata(input.session, items),
    totalStepCount: items.length,
    completedStepCount,
    createdObjectRefs,
    items,
  };
}
