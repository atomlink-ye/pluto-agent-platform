# HANDOFF — Pluto v2 T1 (Spec + prompt-view + CLI run-directory parity + usage status)

Task ID: `pluto-v2-t1-spec-prompt-view-runtdir-20260508`
Iteration: Pluto v2 agentic orchestration, slice T1 of T1–T3.
Authority plan: `docs/plans/active/v2-agentic-orchestration.md` —
section "T1 — Spec + prompt-view foundation + CLI
run-directory parity + usage status" (canonical at HEAD on `main`
`d222bb2`).
Prior baseline: post-S7 main `a98fd8d`.

## Goal

Land the data + plumbing prerequisites that the T2 agentic
adapter will consume:

1. AuthoredSpec additive fields (`orchestration?`, `userTask?`,
   `playbookRef?`) with strict validation in agentic mode.
2. Pure `buildPromptView` helper: deterministic compact JSON shape
   the T2 prompt builder will serialize for lead + sub-actors.
3. Markdown playbook resolver (loader-side; relative path + sha256
   for evidence).
4. CLI run-directory parity: `pluto:run --spec=<path>` writes the
   same surface smoke-live writes — events.jsonl + projections +
   evidence + final-report + usage-summary + transcripts under
   `.pluto/runs/<runId>/`.
5. Usage-status flag: `usage-summary.json` marks
   `usageStatus: 'unavailable'` when per-turn tokens are 0
   (paseo CLI's `usageEstimate` not yet wired). Don't pretend
   `$0`.

T1 does NOT touch `paseo-adapter.ts`, `extractDirective`,
authority, kernel, or the projection reducers. It is a pure
extension that T2 will activate.

## Authority hierarchy

1. `docs/plans/active/v2-agentic-orchestration.md` — T1 section.
2. `acceptance.md` — restated bar (this bundle).
3. `prompt.md` — working prompt.
4. `commands.sh` — gates + `commit_and_push`.

## Non-goals (hard FAIL if shipped)

- ANY change to `packages/pluto-v2-core/src/protocol-request.ts`,
  `run-event.ts`, `core/authority.ts`, `core/run-kernel.ts`,
  `projections/**`. Closed kernel schema is byte-immutable.
- ANY change to
  `packages/pluto-v2-runtime/src/adapters/paseo/paseo-adapter.ts`.
  T2's job. Touching it here breaks the slice plan.
- ANY change to `packages/pluto-v2-runtime/scripts/smoke-live.ts`.
  T3's job.
- ANY change to `tests/fixtures/live-smoke/86557df1-*` (S4 parity
  oracle).
- New v2 features beyond the T1 deliverables.

## Boundaries (allowed edits)

### v2-core (spec + compiler ONLY)

- `packages/pluto-v2-core/src/core/team-context.ts` — additive
  schema fields:
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
  Schema stays `.strict()`. Existing fields untouched.
- `packages/pluto-v2-core/src/core/spec-compiler.ts` — surface the
  new fields on the compiled `TeamContext` if the compiler reads
  them (audit per file). Do NOT touch authority / reducers.

### v2-runtime (loader + helpers + driver usage-summary)

- `packages/pluto-v2-runtime/src/loader/playbook-resolver.ts`
  (NEW) — pure loader. Resolves `spec.playbookRef` relative to
  the spec file path; reads markdown body; returns `{ ref, body,
  sha256 }`. Throws a documented error when missing.
- `packages/pluto-v2-runtime/src/loader/authored-spec-loader.ts`
  — extend to validate the new fields' agentic-mode requirements
  (lead + manager declared, userTask non-empty, playbookRef
  resolves). Keep deterministic mode tolerating missing fields.
- `packages/pluto-v2-runtime/src/adapters/paseo/prompt-view.ts`
  (NEW) — pure function:
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
    readonly tasks: ReadonlyArray<{ id: string; title: string; ownerActor: ActorRef; state: string }>;
    readonly mailbox: ReadonlyArray<{ sequence: number; from: ActorRef; to: ActorRef; kind: string; body: string }>;
    readonly artifacts: ReadonlyArray<{ id: string; kind: string; mediaType: string; byteSize: number }>;
    readonly activeDelegation: ActorRef | null;
    readonly lastRejection: { directive: PaseoDirective; error: string } | null;
  }

  export function buildPromptView(input: PromptViewInput): PromptView;
  ```
  Implementation MUST:
  - Use `replayAll(events)` to derive task / mailbox / artifact
    projection state.
  - Cap mailbox tail at 50 most recent messages (keep the earliest
    message and the most-recent 49, OR most-recent 50 — pick one
    and document).
  - Cap event tail or expose only projection-derived state (no raw
    event injection).
  - Be a pure function (same input → same output byte-for-byte).
  - Sort tasks by `taskId` ASC for determinism.
  - Filter mailbox to messages where `to == forActor` OR
    `from == forActor` for sub-actor view; lead sees everything
    capped to 50.

- `packages/pluto-v2-runtime/src/adapters/paseo/run-paseo.ts` —
  ADDITIVE only: extend the `usageSummary` builder to flag
  `usageStatus`. Do NOT touch the directive parse, the
  pendingPaseoTurn delegation, or any agent lifecycle.

### CLI (run-directory parity)

- `src/cli/v2-cli-bridge.ts` — additive. Extend `V2BridgeResult`
  with `runDir: string`. Write the run directory to
  `.pluto/runs/<runId>/` (relative to `input.evidenceOutputDir`
  parent; or a new explicit `input.runRootDir`). Files:
  - `events.jsonl` (from kernel event log)
  - `projections/tasks.json`
  - `projections/mailbox.jsonl`
  - `projections/artifacts.json`
  - `evidence-packet.json`
  - `final-report.md`
  - `usage-summary.json`
  - `paseo-transcripts/<actorKey>.txt`
- `src/cli/run.ts` — additive only if the CLI flag plumbing
  needs a `--run-root` flag. Default `<workspaceCwd>/.pluto/runs/`.
- Tests under `tests/cli/run-runtime-v2-default.test.ts` —
  additive: assert all 6 file kinds exist after a successful
  default-v2 invocation.

### NEW tests

- `packages/pluto-v2-runtime/__tests__/loader/playbook-resolver.test.ts`
- `packages/pluto-v2-runtime/__tests__/loader/authored-spec-loader.agentic.test.ts`
- `packages/pluto-v2-runtime/__tests__/adapters/paseo/prompt-view.test.ts`
  (deterministic; uses canned events; asserts byte-stable output
  across calls and across actor scoping).
- `packages/pluto-v2-core/__tests__/core/team-context.agentic.test.ts`
  (or extend existing team-context tests) — validates strict
  agentic-mode rejections.

### Read-only (DO NOT touch)

- `packages/pluto-v2-core/src/protocol-request.ts`,
  `run-event.ts`, `core/authority.ts`, `core/run-kernel.ts`,
  `projections/**`.
- `packages/pluto-v2-runtime/src/adapters/paseo/paseo-adapter.ts`,
  `paseo-directive.ts` (T2's territory).
- `packages/pluto-v2-runtime/scripts/smoke-live.ts` (T3).
- `tests/fixtures/live-smoke/86557df1-*` (S4 parity oracle).

## Sandbox constraint

Same warm sandbox as S1–S7:

- Sandbox ID: `c8ef5890-f1d2-4f53-a76d-b6ec6ae38549`
- Snapshot: `personal-dev-env-vps-5c10g150g`
- Workspace: `/workspace`

`commit_and_push` BINDING from S2 carries forward.

## Expected diff size

~600–900 LOC delta (additive). Roughly:
- v2-core schema additions: ~80 LOC
- playbook-resolver.ts: ~80 LOC
- authored-spec-loader.ts agentic validation: ~60 LOC
- prompt-view.ts: ~250 LOC
- v2-cli-bridge.ts run-directory writing: ~150 LOC
- usage-status flag: ~40 LOC
- New tests: ~250 LOC

## Final response schema

Write
`tasks/remote/pluto-v2-t1-spec-prompt-view-runtdir-20260508/artifacts/REPORT.md`
matching the structure of the S7 report (sandbox / commit+push
state / scope per deliverable / closure proofs / grep results /
files changed / validation gate output paths / remote review
loop / known issues).

## Last updated

2026-05-08 — initial bundle; ready to dispatch.
