import type { AuthoredSpec } from '@pluto/v2-core';

import { loadAuthoredSpec } from './authored-spec-loader.js';

export const loadScenarioSpec = (filePath: string): AuthoredSpec => loadAuthoredSpec(filePath);
