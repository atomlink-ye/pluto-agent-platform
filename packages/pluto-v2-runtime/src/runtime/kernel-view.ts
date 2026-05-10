import type { RunState } from '@pluto/v2-core/core/run-state';
import type { RunEvent } from '@pluto/v2-core/run-event';

export interface KernelView {
  readonly state: RunState;
  readonly events: ReadonlyArray<RunEvent>;
}
