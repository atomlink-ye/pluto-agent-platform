import { z } from 'zod';

import { ActorRefSchema, type ActorRef } from '../actor-ref.js';
import { TaskStateSchema, type TaskState } from '../run-event.js';
import { actorKey, type TeamContext } from './team-context.js';

const StringSetSchema = z.custom<Set<string>>(
  (value): value is Set<string> =>
    value instanceof Set && [...value].every((entry) => typeof entry === 'string'),
  'Expected Set<string>',
);

export const RunStatusSchema = z.enum([
  'initialized',
  'running',
  'completed',
  'failed',
  'cancelled',
]);

export const RunStateTaskSchema = z
  .object({
    state: TaskStateSchema,
    ownerActor: ActorRefSchema.nullable(),
  })
  .strict();

export const RunStateSchema = z
  .object({
    runId: z.string(),
    sequence: z.number().int().min(-1).default(-1),
    status: RunStatusSchema,
    tasks: z.record(RunStateTaskSchema),
    acceptedRequestKeys: StringSetSchema,
    declaredActors: StringSetSchema,
  })
  .strict();

export function initialState(teamContext: TeamContext): RunState {
  const tasks = Object.fromEntries(
    (teamContext.initialTasks ?? []).map((task) => [
      task.taskId,
      {
        state: 'queued' as TaskState,
        ownerActor: task.ownerActor,
      },
    ]),
  );

  return RunStateSchema.parse({
    runId: teamContext.runId,
    status: 'initialized',
    tasks,
    acceptedRequestKeys: new Set<string>(),
    declaredActors: new Set(teamContext.declaredActors.map((actor) => actorKey(actor))),
  });
}

export type RunStatus = z.infer<typeof RunStatusSchema>;
export type RunStateTask = z.infer<typeof RunStateTaskSchema>;
export type RunState = z.infer<typeof RunStateSchema>;
export type RunStateTaskOwner = ActorRef | null;
