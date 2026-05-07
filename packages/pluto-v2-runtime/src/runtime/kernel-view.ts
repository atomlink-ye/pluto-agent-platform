import type { RunEvent, RunState } from '@pluto/v2-core';

export interface KernelView {
  readonly state: RunState;
  readonly events: ReadonlyArray<RunEvent>;
}
