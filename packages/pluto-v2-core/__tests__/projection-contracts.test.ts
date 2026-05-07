import { describe, expect, it } from 'vitest';

import {
  ALL_RUN_EVENT_KINDS,
  EVIDENCE_PROJECTION_INPUT_KINDS,
  EVIDENCE_PROJECTION_OUT_OF_SCOPE_KINDS,
  MAILBOX_PROJECTION_INPUT_KINDS,
  MAILBOX_PROJECTION_OUT_OF_SCOPE_KINDS,
  ProjectionKindCoverageIsExact,
  TASK_PROJECTION_INPUT_KINDS,
  TASK_PROJECTION_OUT_OF_SCOPE_KINDS,
  type EvidenceProjectionView,
  type RunEventKind,
  type MailboxProjectionView,
  type TaskProjectionView,
} from '../src/index.js';

type Expect<T extends true> = T;

const taskCoverageIsExact: Expect<ProjectionKindCoverageIsExact<TaskProjectionView>> = true;
const mailboxCoverageIsExact: Expect<ProjectionKindCoverageIsExact<MailboxProjectionView>> = true;
const evidenceCoverageIsExact: Expect<ProjectionKindCoverageIsExact<EvidenceProjectionView>> = true;

const expectExactProjectionCoverage = (
  inputKinds: readonly RunEventKind[],
  outOfScopeKinds: readonly RunEventKind[],
) => {
  const input = new Set(inputKinds);
  const outOfScope = new Set(outOfScopeKinds);

  expect(inputKinds.filter((kind) => outOfScope.has(kind))).toEqual([]);
  expect([...input, ...outOfScope].sort()).toEqual([...ALL_RUN_EVENT_KINDS].sort());
};

describe('projection contracts', () => {
  it('declares exact task projection input/out-of-scope kind coverage', () => {
    expect(taskCoverageIsExact).toBe(true);
    expectExactProjectionCoverage(TASK_PROJECTION_INPUT_KINDS, TASK_PROJECTION_OUT_OF_SCOPE_KINDS);
  });

  it('declares exact mailbox projection input/out-of-scope kind coverage', () => {
    expect(mailboxCoverageIsExact).toBe(true);
    expectExactProjectionCoverage(
      MAILBOX_PROJECTION_INPUT_KINDS,
      MAILBOX_PROJECTION_OUT_OF_SCOPE_KINDS,
    );
  });

  it('declares exact evidence projection input/out-of-scope kind coverage', () => {
    expect(evidenceCoverageIsExact).toBe(true);
    expectExactProjectionCoverage(
      EVIDENCE_PROJECTION_INPUT_KINDS,
      EVIDENCE_PROJECTION_OUT_OF_SCOPE_KINDS,
    );
  });
});
