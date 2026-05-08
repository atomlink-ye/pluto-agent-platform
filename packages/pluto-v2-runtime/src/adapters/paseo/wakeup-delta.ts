import type { ActorRef, RunEvent } from '@pluto/v2-core';

import type {
  ArtifactView,
  MailboxMessageView,
  PromptViewDelegation,
  PromptViewRejection,
  TaskView,
  WakeupPromptDelta,
} from './agentic-tool-prompt-builder.js';
import type { PromptView } from './prompt-view.js';

const MAX_DELTA_TASKS = 20;
const MAX_DELTA_MAILBOX = 20;
const MAX_DELTA_ARTIFACTS = 20;
const MAX_TASK_TITLE_CHARS = 160;
const MAX_MAILBOX_BODY_CHARS = 240;
const MAX_REJECTION_ERROR_CHARS = 240;

function truncate(value: string, maxChars: number): string {
  if (value.length <= maxChars) {
    return value;
  }

  return `${value.slice(0, Math.max(0, maxChars - 16))}...[truncated]`;
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

function taskView(task: TaskView): TaskView {
  return {
    ...task,
    title: truncate(task.title, MAX_TASK_TITLE_CHARS),
  };
}

function mailboxView(message: MailboxMessageView): MailboxMessageView {
  return {
    ...message,
    body: truncate(message.body, MAX_MAILBOX_BODY_CHARS),
  };
}

function artifactView(artifact: ArtifactView): ArtifactView {
  return artifact;
}

function rejectionView(rejection: PromptViewRejection): PromptViewRejection {
  if (rejection == null) {
    return null;
  }

  return {
    directive: rejection.directive,
    error: truncate(rejection.error, MAX_REJECTION_ERROR_CHARS),
  };
}

function isVisibleMailboxEvent(forActor: ActorRef, event: RunEvent): event is Extract<RunEvent, { kind: 'mailbox_message_appended'; outcome: 'accepted' }> {
  if (event.kind !== 'mailbox_message_appended' || event.outcome !== 'accepted') {
    return false;
  }

  if (event.payload.toActor.kind === 'broadcast') {
    return false;
  }

  if (isLeadActor(forActor)) {
    return true;
  }

  return sameActor(event.payload.fromActor, forActor) || sameActor(event.payload.toActor, forActor);
}

function isVisibleEvent(forActor: ActorRef, event: RunEvent): boolean {
  if (isLeadActor(forActor)) {
    return event.kind !== 'mailbox_message_appended' || event.outcome !== 'accepted' || event.payload.toActor.kind !== 'broadcast';
  }

  if (event.kind === 'mailbox_message_appended') {
    return isVisibleMailboxEvent(forActor, event);
  }

  return true;
}

function trimTaskMap(tasks: ReadonlyMap<string, TaskView>): readonly TaskView[] {
  return Array.from(tasks.values()).slice(-MAX_DELTA_TASKS).map(taskView);
}

function trimMailboxMap(messages: ReadonlyMap<number, MailboxMessageView>): readonly MailboxMessageView[] {
  return Array.from(messages.values()).slice(-MAX_DELTA_MAILBOX).map(mailboxView);
}

function trimArtifactMap(artifacts: ReadonlyMap<string, ArtifactView>): readonly ArtifactView[] {
  return Array.from(artifacts.values()).slice(-MAX_DELTA_ARTIFACTS).map(artifactView);
}

export function computeWakeupDelta(args: {
  readonly events: readonly RunEvent[];
  readonly fromSequence: number;
  readonly forActor: ActorRef;
  readonly currentPromptView: PromptView;
}): WakeupPromptDelta {
  const taskById = new Map(args.currentPromptView.tasks.map((task) => [task.id, task]));
  const artifactById = new Map(args.currentPromptView.artifacts.map((artifact) => [artifact.id, artifact]));
  const newTaskById = new Map<string, TaskView>();
  const updatedTaskById = new Map<string, TaskView>();
  const mailboxBySequence = new Map<number, MailboxMessageView>();
  const newArtifactById = new Map<string, ArtifactView>();

  for (const event of args.events) {
    if (event.sequence <= args.fromSequence || !isVisibleEvent(args.forActor, event)) {
      continue;
    }

    switch (event.kind) {
      case 'task_created': {
        if (event.outcome !== 'accepted') {
          break;
        }

        const task = taskById.get(event.payload.taskId);
        if (task != null) {
          newTaskById.set(task.id, task);
          updatedTaskById.delete(task.id);
        }
        break;
      }

      case 'task_state_changed': {
        if (event.outcome !== 'accepted' || newTaskById.has(event.payload.taskId)) {
          break;
        }

        const task = taskById.get(event.payload.taskId);
        if (task != null) {
          updatedTaskById.set(task.id, task);
        }
        break;
      }

      case 'mailbox_message_appended': {
        if (!isVisibleMailboxEvent(args.forActor, event)) {
          break;
        }

        if (event.payload.toActor.kind === 'broadcast') {
          break;
        }

        mailboxBySequence.set(event.sequence, {
          sequence: event.sequence,
          from: event.payload.fromActor,
          to: event.payload.toActor,
          kind: event.payload.kind,
          body: event.payload.body,
        });
        break;
      }

      case 'artifact_published': {
        if (event.outcome !== 'accepted') {
          break;
        }

        newArtifactById.set(
          event.payload.artifactId,
          artifactById.get(event.payload.artifactId) ?? {
            id: event.payload.artifactId,
            kind: event.payload.kind,
            mediaType: event.payload.mediaType,
            byteSize: event.payload.byteSize,
          },
        );
        break;
      }

      default:
        break;
    }
  }

  return {
    newTasks: trimTaskMap(newTaskById),
    updatedTasks: trimTaskMap(updatedTaskById),
    newMailbox: trimMailboxMap(mailboxBySequence),
    newArtifacts: trimArtifactMap(newArtifactById),
    delegation: args.currentPromptView.activeDelegation as PromptViewDelegation,
    budgets: args.currentPromptView.budgets,
    lastRejection: rejectionView(args.currentPromptView.lastRejection),
  };
}
