import type { AuthoredSpec } from '@pluto/v2-core';

import { loadAuthoredSpec } from './authored-spec-loader.js';

export const loadScenarioSpec = (filePath: string): AuthoredSpec => {
  const authored = loadAuthoredSpec(filePath);
  const { playbook: _playbook, ...rest } = authored;
  const mode = authored.orchestration?.mode;

  return {
    ...(rest as Omit<AuthoredSpec, 'orchestration'>),
    ...(authored.orchestration == null
      ? {}
      : {
          orchestration: {
            ...authored.orchestration,
            ...(mode === 'agentic_text' || mode === 'agentic_tool' ? { mode: 'agentic' as const } : {}),
          },
        }),
  } as AuthoredSpec;
};
