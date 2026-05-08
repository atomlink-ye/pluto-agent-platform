import { replayAll, type ActorRef, type RunEvent } from '@pluto/v2-core';

import { assembleEvidencePacket } from '../../evidence/evidence-packet.js';
import type { LoadedAuthoredSpec } from '../../loader/authored-spec-loader.js';
import type { AgenticMutation } from './agentic-mutation.js';

const MAILBOX_LIMIT = 50;

export interface PromptViewBudgets {
  readonly turnIndex: number;
  readonly maxTurns: number;
  readonly parseFailuresThisTurn: number;
  readonly maxParseFailuresPerTurn: number;
  readonly kernelRejections: number;
  readonly maxKernelRejections: number;
  readonly noProgressTurns: number;
  readonly maxNoProgressTurns: number;
}

export interface PromptViewInput {
  readonly spec: LoadedAuthoredSpec;
  readonly events: ReadonlyArray<RunEvent>;
  readonly forActor: ActorRef;
  readonly budgets: PromptViewBudgets;
  readonly activeDelegation: ActorRef | null;
  readonly lastRejection: { directive: AgenticMutation; error: string } | null;
}

export interface PromptView {
  readonly run: {
    readonly runId: string;
    readonly scenarioRef: string;
    readonly runProfileRef: string;
  };
  readonly userTask: string | null;
  readonly forActor: ActorRef;
  readonly playbook: {
    readonly ref: string;
    readonly sha256: string;
  } | null;
  readonly budgets: PromptViewBudgets;
  readonly tasks: ReadonlyArray<{
    readonly id: string;
    readonly title: string;
    readonly ownerActor: ActorRef | null;
    readonly state: string;
  }>;
  readonly mailbox: ReadonlyArray<{
    readonly sequence: number;
    readonly from: ActorRef;
    readonly to: ActorRef;
    readonly kind: string;
    readonly body: string;
  }>;
  readonly artifacts: ReadonlyArray<{
    readonly id: string;
    readonly kind: string;
    readonly mediaType: string;
    readonly byteSize: number;
  }>; 
  readonly activeDelegation: ActorRef | null;
  readonly lastRejection: { directive: AgenticMutation; error: string } | null;
}

function sameActor(left: ActorRef, right: ActorRef): boolean {
  if (left.kind !== right.kind) {
    return false;
  }

  if (left.kind === 'role' && right.kind === 'role') {
    return left.role === right.role;
  }

  return true;
}

function isLeadActor(actor: ActorRef): boolean {
  return actor.kind === 'role' && actor.role === 'lead';
}

function resolvePlaybook(spec: LoadedAuthoredSpec): PromptView['playbook'] {
  if (spec.playbook == null) {
    return null;
  }

  return {
    ref: spec.playbook.ref,
    sha256: spec.playbook.sha256,
  };
}

function summarizeArtifacts(spec: LoadedAuthoredSpec, events: ReadonlyArray<RunEvent>): PromptView['artifacts'] {
  if (events.length === 0) {
    return [];
  }

  return assembleEvidencePacket(replayAll(events), events, spec.runId).artifacts
    .map((artifact) => ({
      id: artifact.artifactId,
      kind: artifact.kind,
      mediaType: artifact.mediaType,
      byteSize: artifact.byteSize,
    }))
    .sort((left, right) => left.id.localeCompare(right.id));
}

export function buildPromptView(input: PromptViewInput): PromptView {
  const views = replayAll(input.events);
  const visibleMessages = views.mailbox.messages
    .filter((message) => {
      if (isLeadActor(input.forActor)) {
        return true;
      }

      return sameActor(message.fromActor, input.forActor)
        || (message.toActor.kind !== 'broadcast' && sameActor(message.toActor, input.forActor));
    })
    .sort((left, right) => left.sequence - right.sequence)
    .slice(-MAILBOX_LIMIT)
    .map((message) => {
      if (message.toActor.kind === 'broadcast') {
        return null;
      }

      return {
        sequence: message.sequence,
        from: message.fromActor,
        to: message.toActor,
        kind: message.kind,
        body: message.body,
      };
    })
    .filter((message): message is NonNullable<typeof message> => message !== null);

  const tasks = Object.entries(views.task.tasks)
    .sort(([leftId], [rightId]) => leftId.localeCompare(rightId))
    .map(([id, task]) => ({
      id,
      title: task.title,
      ownerActor: task.ownerActor,
      state: task.state,
    }));

  return {
    run: {
      runId: input.spec.runId,
      scenarioRef: input.spec.scenarioRef,
      runProfileRef: input.spec.runProfileRef,
    },
    userTask: input.spec.userTask?.trim() ? input.spec.userTask : null,
    forActor: input.forActor,
    playbook: resolvePlaybook(input.spec),
    budgets: input.budgets,
    tasks,
    mailbox: visibleMessages,
    artifacts: summarizeArtifacts(input.spec, input.events),
    activeDelegation: input.activeDelegation,
    lastRejection: input.lastRejection,
  };
}
