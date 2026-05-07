import {
  ArtifactPublishedPayloadSchema,
  MailboxMessageAppendedPayloadSchema,
  RunCompletedPayloadSchema,
  TaskCreatedPayloadSchema,
  TaskStateChangedPayloadSchema,
} from '@pluto/v2-core';
import { z } from 'zod';

export const PaseoDirectiveSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('append_mailbox_message'),
    payload: MailboxMessageAppendedPayloadSchema.omit({ messageId: true }),
  }),
  z.object({
    kind: z.literal('create_task'),
    payload: TaskCreatedPayloadSchema.omit({ taskId: true }),
  }),
  z.object({
    kind: z.literal('change_task_state'),
    payload: TaskStateChangedPayloadSchema.omit({ from: true }),
  }),
  z.object({
    kind: z.literal('publish_artifact'),
    payload: ArtifactPublishedPayloadSchema.omit({ artifactId: true }),
  }),
  z.object({
    kind: z.literal('complete_run'),
    payload: RunCompletedPayloadSchema.omit({ completedAt: true }),
  }),
]);

export type PaseoDirective = z.infer<typeof PaseoDirectiveSchema>;

type ExtractDirectiveResult = { ok: true; directive: PaseoDirective } | { ok: false; reason: string };

const FENCED_JSON_BLOCK_PATTERN = /```json\s*([\s\S]*?)```/i;

function parseDirectiveCandidate(candidate: string): ExtractDirectiveResult {
  let parsed: unknown;

  try {
    parsed = JSON.parse(candidate);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'unknown JSON parse error';
    return { ok: false, reason: `directive JSON parse failed: ${message}` };
  }

  const result = PaseoDirectiveSchema.safeParse(parsed);
  if (!result.success) {
    return {
      ok: false,
      reason: `directive validation failed: ${result.error.issues.map((issue) => issue.message).join('; ')}`,
    };
  }

  return { ok: true, directive: result.data };
}

function extractBalancedJsonObject(text: string): string | null {
  let startIndex = -1;
  let depth = 0;
  let inString = false;
  let escaping = false;

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    if (char == null) {
      continue;
    }

    if (startIndex === -1) {
      if (char === '{') {
        startIndex = index;
        depth = 1;
      }
      continue;
    }

    if (inString) {
      if (escaping) {
        escaping = false;
        continue;
      }
      if (char === '\\') {
        escaping = true;
        continue;
      }
      if (char === '"') {
        inString = false;
      }
      continue;
    }

    if (char === '"') {
      inString = true;
      continue;
    }

    if (char === '{') {
      depth += 1;
      continue;
    }

    if (char === '}') {
      depth -= 1;
      if (depth === 0) {
        return text.slice(startIndex, index + 1);
      }
    }
  }

  return null;
}

export function extractDirective(text: string): ExtractDirectiveResult {
  const fencedMatch = FENCED_JSON_BLOCK_PATTERN.exec(text);
  if (fencedMatch?.[1] != null) {
    return parseDirectiveCandidate(fencedMatch[1].trim());
  }

  const balancedObject = extractBalancedJsonObject(text);
  if (balancedObject == null) {
    return { ok: false, reason: 'no fenced json block or balanced JSON object found' };
  }

  return parseDirectiveCandidate(balancedObject);
}
