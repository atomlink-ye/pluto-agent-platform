import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { beforeAll, describe, expect, it } from 'vitest';

const TOOL_SCHEMA_SOURCE_PATH = fileURLToPath(new URL('../../src/tools/pluto-tool-schemas.ts', import.meta.url));
const TOOL_SCHEMA_SOURCE = readFileSync(TOOL_SCHEMA_SOURCE_PATH, 'utf8');
const HAS_V2_CORE_REFERENCE = /@pluto\/v2-core(?:\/[\w./-]+)?/.test(TOOL_SCHEMA_SOURCE);

async function loadToolSchemasModule() {
  return import('../../src/tools/pluto-tool-schemas.js');
}

function descriptorFor(
  descriptors: readonly {
    readonly name: string;
    readonly inputSchema: { readonly properties?: Record<string, unknown>; readonly required?: readonly string[] };
  }[],
  name: string,
) {
  const descriptor = descriptors.find((candidate) => candidate.name === name);
  expect(descriptor).toBeDefined();
  if (!descriptor) {
    throw new Error(`Missing descriptor for ${name}`);
  }

  return descriptor;
}

describe('pluto tool schemas', () => {
  it('contains no @pluto/v2-core references or request payload schema composition', () => {
    expect(TOOL_SCHEMA_SOURCE).not.toMatch(/@pluto\/v2-core(?:\/[\w./-]+)?/);
    expect(TOOL_SCHEMA_SOURCE).not.toMatch(/\b\w+RequestPayloadSchema\.(?:pick|omit|extend)\(/);
  });

  it('loads zod through createRequire without parent-directory walking or static imports', () => {
    expect(TOOL_SCHEMA_SOURCE).toMatch(/createRequire\(import\.meta\.url\)/);
    expect(TOOL_SCHEMA_SOURCE).toMatch(/require\(['"]zod['"]\)/);
    expect(TOOL_SCHEMA_SOURCE).not.toMatch(/existsSync|for \(let depth = 0;|\.resolve\(['"]zod['"]\)/);
  });

  // Keep behavior coverage behind the no-core check so a future regression fails with the guard
  // instead of re-triggering unrelated module-load breakage through a restored core dependency.
  if (!HAS_V2_CORE_REFERENCE) {
    describe('runtime behavior without core runtime imports', () => {
      let toolSchemasModule: Awaited<ReturnType<typeof loadToolSchemasModule>>;

      beforeAll(async () => {
        toolSchemasModule = await loadToolSchemasModule();
      });

      it('includes all 8 tool names', () => {
        expect(toolSchemasModule.PLUTO_TOOL_NAMES).toEqual([
          'pluto_create_task',
          'pluto_change_task_state',
          'pluto_append_mailbox_message',
          'pluto_publish_artifact',
          'pluto_complete_run',
          'pluto_read_state',
          'pluto_read_artifact',
          'pluto_read_transcript',
        ]);
      });

      it('has exactly one descriptor per tool name', () => {
        expect(toolSchemasModule.PLUTO_TOOL_DESCRIPTORS).toHaveLength(toolSchemasModule.PLUTO_TOOL_NAMES.length);
        expect(new Set(toolSchemasModule.PLUTO_TOOL_DESCRIPTORS.map((descriptor) => descriptor.name))).toEqual(
          new Set(toolSchemasModule.PLUTO_TOOL_NAMES),
        );
      });

      it('advertises closed enums for applicable tool fields', () => {
        const changeTaskState = descriptorFor(toolSchemasModule.PLUTO_TOOL_DESCRIPTORS, 'pluto_change_task_state');
        const appendMailboxMessage = descriptorFor(
          toolSchemasModule.PLUTO_TOOL_DESCRIPTORS,
          'pluto_append_mailbox_message',
        );
        const completeRun = descriptorFor(toolSchemasModule.PLUTO_TOOL_DESCRIPTORS, 'pluto_complete_run');
        const publishArtifact = descriptorFor(toolSchemasModule.PLUTO_TOOL_DESCRIPTORS, 'pluto_publish_artifact');

        expect(changeTaskState.inputSchema.properties?.to).toMatchObject({ enum: expect.any(Array) });
        expect(appendMailboxMessage.inputSchema.properties?.kind).toMatchObject({ enum: expect.any(Array) });
        expect(completeRun.inputSchema.properties?.status).toMatchObject({ enum: expect.any(Array) });
        expect(publishArtifact.inputSchema.properties?.kind).toMatchObject({ enum: expect.any(Array) });
      });

      it('aligns JSON schema constraints for role length and transcript actor key length', () => {
        const createTask = descriptorFor(toolSchemasModule.PLUTO_TOOL_DESCRIPTORS, 'pluto_create_task');
        const transcript = descriptorFor(toolSchemasModule.PLUTO_TOOL_DESCRIPTORS, 'pluto_read_transcript');
        const roleSchema = (
          createTask.inputSchema.properties?.ownerActor as {
            anyOf?: Array<{
              anyOf?: Array<{
                properties?: {
                  role?: unknown;
                };
              }>;
            }>;
          }
        ).anyOf?.[0]?.anyOf?.[1]?.properties?.role;

        expect(roleSchema).toMatchObject({
          maxLength: 64,
          pattern: '^[a-z][a-z0-9_-]*$',
        });
        expect(transcript.inputSchema.properties?.actorKey).toMatchObject({ minLength: 1 });
      });

      it('does not advertise fromActor on pluto_append_mailbox_message', () => {
        expect(
          descriptorFor(toolSchemasModule.PLUTO_TOOL_DESCRIPTORS, 'pluto_append_mailbox_message').inputSchema.properties,
        ).not.toHaveProperty('fromActor');
      });

      it('includes pluto_complete_run and optional publish body', () => {
        const completeRun = descriptorFor(toolSchemasModule.PLUTO_TOOL_DESCRIPTORS, 'pluto_complete_run');
        const publishArtifact = descriptorFor(toolSchemasModule.PLUTO_TOOL_DESCRIPTORS, 'pluto_publish_artifact');

        expect(completeRun.name).toBe('pluto_complete_run');
        expect(publishArtifact.inputSchema.properties).toHaveProperty('body');
        expect(publishArtifact.inputSchema.required).not.toContain('body');
      });

      it('accepts create-task args with a custom role actor ref', () => {
        expect(
          toolSchemasModule.PlutoCreateTaskArgsSchema.parse({
            title: 'Ship runtime fix',
            ownerActor: {
              kind: 'role',
              role: 'custom-author',
            },
            dependsOn: ['task-1'],
          }),
        ).toEqual({
          title: 'Ship runtime fix',
          ownerActor: {
            kind: 'role',
            role: 'custom-author',
          },
          dependsOn: ['task-1'],
        });
      });

      it('rejects invalid task states', () => {
        expect(() =>
          toolSchemasModule.PlutoChangeTaskStateArgsSchema.parse({
            taskId: 'task-1',
            to: 'waiting',
          }),
        ).toThrow();
      });

      it('accepts mailbox args for both broadcast and role recipients', () => {
        expect(
          toolSchemasModule.PlutoAppendMailboxMessageArgsSchema.parse({
            toActor: { kind: 'broadcast' },
            kind: 'plan',
            body: 'share with everyone',
          }),
        ).toEqual({
          toActor: { kind: 'broadcast' },
          kind: 'plan',
          body: 'share with everyone',
        });

        expect(
          toolSchemasModule.PlutoAppendMailboxMessageArgsSchema.parse({
            toActor: { kind: 'role', role: 'generator' },
            kind: 'task',
            body: 'share with one actor',
          }),
        ).toEqual({
          toActor: { kind: 'role', role: 'generator' },
          kind: 'task',
          body: 'share with one actor',
        });
      });

      it('rejects invalid mailbox kinds', () => {
        expect(() =>
          toolSchemasModule.PlutoAppendMailboxMessageArgsSchema.parse({
            toActor: { kind: 'broadcast' },
            kind: 'note',
            body: 'bad kind',
          }),
        ).toThrow();
      });

      it('rejects invalid role patterns and overlength role names', () => {
        expect(() =>
          toolSchemasModule.PlutoCreateTaskArgsSchema.parse({
            title: 'Bad role pattern',
            ownerActor: { kind: 'role', role: 'InvalidRole' },
            dependsOn: [],
          }),
        ).toThrow();

        expect(() =>
          toolSchemasModule.PlutoCreateTaskArgsSchema.parse({
            title: 'Bad role length',
            ownerActor: { kind: 'role', role: 'a'.repeat(65) },
            dependsOn: [],
          }),
        ).toThrow();
      });

      it('accepts publish-artifact args without body and rejects negative byte sizes', () => {
        expect(
          toolSchemasModule.PlutoPublishArtifactArgsSchema.parse({
            kind: 'final',
            mediaType: 'text/plain',
            byteSize: 0,
          }),
        ).toEqual({
          kind: 'final',
          mediaType: 'text/plain',
          byteSize: 0,
        });

        expect(() =>
          toolSchemasModule.PlutoPublishArtifactArgsSchema.parse({
            kind: 'intermediate',
            mediaType: 'application/json',
            byteSize: -1,
          }),
        ).toThrow();
      });

      it('accepts complete-run args with a nullable summary', () => {
        expect(
          toolSchemasModule.PlutoCompleteRunArgsSchema.parse({
            status: 'succeeded',
            summary: null,
          }),
        ).toEqual({
          status: 'succeeded',
          summary: null,
        });
      });

      it('rejects invalid artifact ids', () => {
        expect(() =>
          toolSchemasModule.PlutoReadArtifactArgsSchema.parse({
            artifactId: 'not-a-uuid',
          }),
        ).toThrow();
      });
    });
  }
});
