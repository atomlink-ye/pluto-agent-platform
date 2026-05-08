import { describe, expect, it } from 'vitest';

import {
  PLUTO_TOOL_DESCRIPTORS,
  PLUTO_TOOL_NAMES,
} from '../../src/tools/pluto-tool-schemas.js';

function descriptorFor(name: (typeof PLUTO_TOOL_NAMES)[number]) {
  const descriptor = PLUTO_TOOL_DESCRIPTORS.find((candidate) => candidate.name === name);
  expect(descriptor).toBeDefined();
  if (!descriptor) {
    throw new Error(`Missing descriptor for ${name}`);
  }

  return descriptor;
}

describe('pluto tool schemas', () => {
  it('includes all 8 tool names', () => {
    expect(PLUTO_TOOL_NAMES).toEqual([
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
    expect(PLUTO_TOOL_DESCRIPTORS).toHaveLength(PLUTO_TOOL_NAMES.length);
    expect(new Set(PLUTO_TOOL_DESCRIPTORS.map((descriptor) => descriptor.name))).toEqual(
      new Set(PLUTO_TOOL_NAMES),
    );
  });

  it('advertises closed enums for applicable tool fields', () => {
    expect(descriptorFor('pluto_change_task_state').inputSchema.properties?.to?.enum).toBeDefined();
    expect(descriptorFor('pluto_append_mailbox_message').inputSchema.properties?.kind?.enum).toBeDefined();
    expect(descriptorFor('pluto_complete_run').inputSchema.properties?.status?.enum).toBeDefined();
    expect(descriptorFor('pluto_publish_artifact').inputSchema.properties?.kind?.enum).toBeDefined();
  });

  it('does not advertise fromActor on pluto_append_mailbox_message', () => {
    expect(descriptorFor('pluto_append_mailbox_message').inputSchema.properties).not.toHaveProperty('fromActor');
  });

  it('includes pluto_complete_run and optional publish body', () => {
    const completeRun = descriptorFor('pluto_complete_run');
    const publishArtifact = descriptorFor('pluto_publish_artifact');

    expect(completeRun.name).toBe('pluto_complete_run');
    expect(publishArtifact.inputSchema.properties).toHaveProperty('body');
    expect(publishArtifact.inputSchema.required).not.toContain('body');
  });
});
