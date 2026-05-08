# Acceptance bar — pluto-v2-t1-spec-prompt-view-runtdir-20260508

This file restates the binding acceptance items from canonical
plan section "T1 — Spec + prompt-view foundation + CLI
run-directory parity + usage status" of
`docs/plans/active/v2-agentic-orchestration.md` (HEAD on `main`
`d222bb2`). On conflict, the plan wins.

## Binding tables / specs (verbatim from plan)

### A. AuthoredSpec additive fields (deliverable 1)

Closed-strict schema in
`packages/pluto-v2-core/src/core/team-context.ts` extends with:

```ts
orchestration?: {
  mode?: 'deterministic' | 'agentic';
  maxTurns?: number;
  maxParseFailuresPerTurn?: number;
  maxKernelRejections?: number;
  maxNoProgressTurns?: number;
};
userTask?: string;
playbookRef?: string;
```

Validation rules (loader-side, in
`authored-spec-loader.ts`):

- Agentic mode (`orchestration?.mode === 'agentic'`) REQUIRES:
  - `declaredActors` includes `'lead'` AND `'manager'`
  - `actors.lead.kind === 'role'` AND `actors.lead.role === 'lead'`
  - `actors.manager.kind === 'manager'`
  - `userTask.trim().length > 0`
  - `playbookRef` is a non-empty string AND resolves to an
    existing markdown file relative to the spec file's directory
- Deterministic mode (default; `orchestration?.mode === 'deterministic'`
  or unset): the new fields are tolerated but ignored. Existing
  fixtures parse unchanged.

Each rule violation in agentic mode emits a DOCUMENTED error
string containing the field name AND the literal `agentic`. Test
harness asserts each path exits 1.

### B. Prompt-view helper (deliverable 2)

NEW file `packages/pluto-v2-runtime/src/adapters/paseo/prompt-view.ts`.

```ts
export interface PromptViewBudgets {
  readonly turnIndex: number;
  readonly maxTurns: number;
  readonly parseFailuresThisTurn: number;
  readonly maxParseFailuresPerTurn: number;
  readonly kernelRejections: number;
  readonly maxKernelRejections: number;
  readonly noProgressTurns: number;
  readonly maxNoProgressTurns: number;
}

export interface PromptViewInput {
  readonly spec: AuthoredSpec;
  readonly events: ReadonlyArray<RunEvent>;
  readonly forActor: ActorRef;
  readonly budgets: PromptViewBudgets;
  readonly activeDelegation: ActorRef | null;
  readonly lastRejection: { directive: PaseoDirective; error: string } | null;
}

export interface PromptView {
  readonly run: { runId: string; scenarioRef: string; runProfileRef: string };
  readonly userTask: string | null;
  readonly forActor: ActorRef;
  readonly playbook: { ref: string; sha256: string } | null;
  readonly budgets: PromptViewBudgets;
  readonly tasks: ReadonlyArray<{
    readonly id: string;
    readonly title: string;
    readonly ownerActor: ActorRef;
    readonly state: string;
  }>;
  readonly mailbox: ReadonlyArray<{
    readonly sequence: number;
    readonly from: ActorRef;
    readonly to: ActorRef;
    readonly kind: string;
    readonly body: string;
  }>;
  readonly artifacts: ReadonlyArray<{
    readonly id: string;
    readonly kind: string;
    readonly mediaType: string;
    readonly byteSize: number;
  }>;
  readonly activeDelegation: ActorRef | null;
  readonly lastRejection: { directive: PaseoDirective; error: string } | null;
}

export function buildPromptView(input: PromptViewInput): PromptView;
```

Implementation MUST:
- Use `replayAll(events)` from `@pluto/v2-core` to derive task /
  mailbox / artifact projection state. Do NOT re-implement
  reducers.
- Cap mailbox tail at 50 most recent messages, sorted by
  `sequence` ASC.
- For sub-actors, filter mailbox to messages where `to ==
  forActor` OR `from == forActor`. For lead, return the cap'd
  full mailbox.
- Sort tasks by `taskId` ASC for byte determinism.
- Be a pure function (same input → same JSON output byte-for-byte).

### C. Playbook resolver (deliverable 3)

NEW file
`packages/pluto-v2-runtime/src/loader/playbook-resolver.ts`.

```ts
export interface ResolvedPlaybook {
  readonly ref: string;
  readonly absolutePath: string;
  readonly body: string;
  readonly sha256: string;
}

export function resolvePlaybook(args: {
  readonly specPath: string;
  readonly playbookRef: string;
}): Promise<ResolvedPlaybook>;
```

- `playbookRef` is resolved relative to the spec file's directory
  (NOT cwd).
- Reads the file as UTF-8.
- Computes sha256 of the body.
- Throws a documented error
  (`PlaybookResolutionError`) if the file is missing or not
  readable; agentic-mode load failure surfaces this error
  message to the operator.

### D. CLI run-directory parity (deliverable 4)

`src/cli/v2-cli-bridge.ts` writes the following under
`.pluto/runs/<runId>/` for every successful (or failed) run:

- `events.jsonl` — one JSON object per line, in `sequence`
  order, sourced from the kernel event log.
- `projections/tasks.json` — `replayAll(events).tasks` snapshot.
- `projections/mailbox.jsonl` — one mailbox message per line,
  in `sequence` order.
- `projections/artifacts.json` — `replayAll(events).artifacts`
  snapshot.
- `evidence-packet.json` — existing evidence packet output.
- `final-report.md` — same shape as smoke-live's final-report
  (status + summary + citations + tasks + mailbox + artifacts).
- `usage-summary.json` — same shape as smoke-live's usage-summary
  (per-actor, per-turn, per-model totals + new `usageStatus`
  field).
- `paseo-transcripts/<actorKey>.txt` — last-seen transcript per
  actor.

`V2BridgeResult` extends with `runDir: string` (absolute path).
Other fields preserved.

Default location:
- If `input.runRootDir` is set, use that.
- Else if `input.evidenceOutputDir` ends in `evidence`, derive
  `<parent>/runs/<runId>` (back-compat).
- Else `<workspaceCwd>/.pluto/runs/<runId>`.

`tests/cli/run-runtime-v2-default.test.ts` updated additively to
assert the 6+ files exist post-run.

### E. Usage-status flag (deliverable 5)

`usage-summary.json` adds a `usageStatus` field:

- `'reported'` if any `perTurn` entry has `inputTokens > 0` OR
  `outputTokens > 0` OR `costUsd > 0`.
- `'unavailable'` otherwise.

Plus a `reportedBy: 'paseo.usageEstimate'` field for provenance.

Used by both `smoke-live.ts` (T3 wires it) AND the v2-cli-bridge
production CLI (T1 wires it for the run-directory output).

## Gates

### Gate 1 — Typecheck (root + both packages)

```bash
pnpm --filter @pluto/v2-core typecheck
pnpm --filter @pluto/v2-runtime typecheck
pnpm exec tsc -p tsconfig.json --noEmit
```

All clean.

### Gate 2 — Tests

```bash
pnpm --filter @pluto/v2-core test    # ≥ 186 + new agentic-spec tests
pnpm --filter @pluto/v2-runtime test # ≥ 65 + new prompt-view +
                                     # playbook-resolver + agentic
                                     # loader tests
pnpm test                              # root regression unchanged
```

All green. Approximate test additions:

- `team-context.agentic.test.ts` — ≥ 5 cases (4 rejection paths +
  1 valid agentic spec round-trip).
- `playbook-resolver.test.ts` — ≥ 4 cases (resolves relative;
  reads body; sha256 stable; missing throws).
- `authored-spec-loader.agentic.test.ts` — ≥ 4 cases (agentic
  mode requires lead/manager/userTask/playbookRef; deterministic
  mode tolerates).
- `prompt-view.test.ts` — ≥ 6 cases (lead sees all; sub-actor
  filtered; mailbox cap; task ordering; budget surface; rejection
  surface; same input → same JSON).
- `run-runtime-v2-default.test.ts` — additive assertions for the
  run-directory files.

### Gate 3 — Build

```bash
pnpm --filter @pluto/v2-core build
pnpm --filter @pluto/v2-runtime build
```

Both clean.

### Gate 4 — No paseo-adapter / kernel / projection / smoke-live mutation

```bash
git diff --name-only main..HEAD -- \
  packages/pluto-v2-core/src/protocol-request.ts \
  packages/pluto-v2-core/src/run-event.ts \
  packages/pluto-v2-core/src/core/authority.ts \
  packages/pluto-v2-core/src/core/run-kernel.ts \
  packages/pluto-v2-core/src/projections/ \
  packages/pluto-v2-runtime/src/adapters/paseo/paseo-adapter.ts \
  packages/pluto-v2-runtime/src/adapters/paseo/paseo-directive.ts \
  packages/pluto-v2-runtime/scripts/smoke-live.ts \
  tests/fixtures/live-smoke/86557df1-
```

Expected: empty.

### Gate 5 — Determinism gate (prompt-view byte stability)

`prompt-view.test.ts` MUST include a test that calls
`buildPromptView` twice with identical input and asserts JSON
output is byte-for-byte equal (string equality after
`JSON.stringify(view, null, 2)`).

### Gate 6 — Run-directory file listing

`tests/cli/run-runtime-v2-default.test.ts` asserts the 6 file
kinds exist post-run with non-empty content (`stat().size > 0`).

### Gate 7 — Diff hygiene

`git diff --name-only main..HEAD` MUST be a subset of:

Adds (new files):
- `packages/pluto-v2-runtime/src/loader/playbook-resolver.ts`
- `packages/pluto-v2-runtime/src/adapters/paseo/prompt-view.ts`
- `packages/pluto-v2-runtime/src/evidence/final-report-builder.ts` (NEW)
- `packages/pluto-v2-runtime/src/evidence/usage-summary-builder.ts` (NEW)
- `packages/pluto-v2-core/__tests__/core/team-context.agentic.test.ts`
- `packages/pluto-v2-runtime/__tests__/loader/playbook-resolver.test.ts`
- `packages/pluto-v2-runtime/__tests__/loader/authored-spec-loader.agentic.test.ts`
- `packages/pluto-v2-runtime/__tests__/adapters/paseo/prompt-view.test.ts`

Modifies (additive only):
- `packages/pluto-v2-core/__tests__/core/spec-compiler.test.ts`
- `packages/pluto-v2-core/__tests__/core/team-context.test.ts`
- `packages/pluto-v2-core/src/core/team-context.ts`
- `packages/pluto-v2-core/src/core/spec-compiler.ts` (only if
  needed for surfacing fields)
- `packages/pluto-v2-runtime/__tests__/adapters/paseo/run-paseo.test.ts`
- `packages/pluto-v2-runtime/__tests__/loader/authored-spec-loader.test.ts`
- `packages/pluto-v2-runtime/src/loader/authored-spec-loader.ts`
- `packages/pluto-v2-runtime/src/index.ts` (export new helpers)
- `packages/pluto-v2-runtime/src/adapters/paseo/run-paseo.ts`
- `src/cli/v2-cli-bridge.ts`
- `src/cli/run.ts` (only if `--run-root` plumbing needed)
- `tests/cli/run-runtime-precedence.test.ts`
- `tests/cli/run-runtime-v2-default.test.ts`
- `tasks/remote/pluto-v2-t1-spec-prompt-view-runtdir-20260508/**`

Out-of-scope (post-merge by local manager):
- `docs/plans/active/v2-agentic-orchestration.md` — T1 status
  row only AFTER merge.

## Last updated

2026-05-08 — initial bundle; ready to dispatch.
