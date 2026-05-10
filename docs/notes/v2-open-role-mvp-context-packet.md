# T14 Open-Role MVP — Context Packet

> READ ME FIRST. Every T14 slice agent loads this before any other repo file. It exists to amortize repo map, forbidden zones, gate policy, and dispatch conventions across all four slices. Updated 2026-05-10.

## 1. Iteration plan

`docs/plans/active/v2-open-role-mvp.md` is the iteration source-of-truth. Re-read it for slice scope, acceptance bars, and the deferred-to-T15+ list. Anything not in that plan is out of scope unless added by an explicit T14-S5 dispatched after S1..S4 land.

## 2. Repo map (relevant subset)

```
packages/
  pluto-v2-core/                  # closed-schema kernel (load-bearing)
    src/
      actor-ref.ts                # ActorRoleSchema lives here  ← T14-S2 epicenter
      protocol-request.ts         # closed envelope of admissible kinds
      run-event.ts                # closed envelope of run-event kinds
      core/
        team-context.ts           # actor declarations + compiled policy
        authority.ts              # AUTHORITY_MATRIX (T14-S1)
        spec-compiler.ts          # role/policy compile path (T14-S1+S2)
        protocol-validator.ts     # request validation against policy
        run-state.ts              # state reducer + actorKey() (T14-S2+S3)
        run-kernel.ts             # event submission
    __tests__/core/               # heavy test surface — keep all green

  pluto-v2-runtime/               # adapters, runtime, CLI, API
    src/
      api/
        pluto-local-api.ts        # actor token binding + route enforcement
        composite-tools.ts        # worker-complete / evaluator-verdict / final-reconciliation
        wait-registry.ts          # turn lifecycle / actor wait state
      adapters/
        paseo/
          run-paseo.ts            # main agentic-tool driver
          agentic-tool-prompt-builder.ts  # prompt assembly per actor (T14-S3)
          prompt-view.ts          # prompt slicing (T14-S3)
        fake/                     # deterministic adapter — needed for T14-S4 contract
      cli/
        pluto-tool.ts             # primitive + composite CLI commands
        runs.ts                   # pluto:runs replay/audit/explain (T12-S4a/S4b)
        actor-bridge.ts           # run-level binary materialization
      loader/
        authored-spec-loader.ts   # agentic_tool spec compile (T14-S3 collision guard)
      runtime/
        runtime-adapter.ts        # adapter interface (T14-S4 contract)
    __tests__/                    # full vitest tree

src/
  cli/
    v2-cli-bridge.ts              # bridge to pluto-tool

docs/
  plans/active/v2-open-role-mvp.md       # this iteration
  plans/completed/                       # T9–T13 archived plans
  notes/v2-open-role-mvp-context-packet.md   # this file
  harness.md                             # public harness doc — sync in T14-S4
  mvp-alpha.md                           # MVP doc — sync in T14-S4

tasks/
  remote/v2-open-role-mvp-s<N>/   # slice bundle root
    HANDOFF.md
    prompt.md
    commands.sh
    acceptance.md
    artifacts/                    # gate outputs, REPORT.md
```

## 3. Forbidden zones (do not edit unless your slice plan explicitly calls them)

- `packages/pluto-v2-core/src/run-event.ts` envelope kinds — closed schema. Adding new kinds is a kernel-thaw item; T14 is not authorized to add kinds.
- `packages/pluto-v2-core/src/protocol-request.ts` admissible kinds — same constraint.
- `docs/plans/completed/` — historical record; do not edit.
- Anything under `legacy-v1.6-harness-prototype` branch territory in this branch.
- `.local/` — local manager scratch; remote agents must not write here.

## 4. Gate policy (R7 + R8 + R9 — BINDING)

### R7 — 20-min cap per test invocation
Wrap every test command with `timeout 1200`. Targeted-only during fix passes. One full `pnpm test` per slice, at the end.

### R8 — `smoke:live` once per slice at the very end
Treat `smoke:live` as the final regression gate, not a debug loop. Failures captured as fixtures under `tests/fixtures/live-smoke/<run-id>/`; iterate via fixture replay; one final smoke:live to confirm.

### R9 — Three-layer gate ownership
| Layer | Responsibility |
|---|---|
| Implementer | runs full required gates + captures timed artifacts; fixes implementation |
| Reviewer | reads diff + artifacts; targeted re-runs only if suspicious |
| Manager | integration judgment + merge + POST-N synthesis; does NOT run full gates |

Per-gate artifacts must include `# started: <iso-ts>`, `# duration: <seconds>`, `# exit: <code>` headers.

## 5. Live-smoke conventions

- Default model: `openai/gpt-5.4-mini` (per `feedback_smoke_live_model.md`).
- `smoke:live` rejects passing both `--spec` and `--run-dir`. Pass `--spec` only; locate the run dir after.
- The capture step may move `events.jsonl` and transcripts into a fixture; `evidence/` may stay in the original run dir. Audit commands need either the original run dir or copied evidence.

## 6. Slice bundle contract

Every slice bundle at `tasks/remote/v2-open-role-mvp-s<N>/` includes:

| File | Purpose |
|---|---|
| `HANDOFF.md` | slice goal, scope, what changed in the plan |
| `prompt.md` | remote manager prompt with absolute paths and stop conditions |
| `commands.sh` | reproducible command catalog and gates |
| `acceptance.md` | pass/fail criteria and required evidence |
| `artifacts/` | gate outputs, REPORT.md, manifests, logs |

`prompt.md` MUST start with explicit absolute paths:
```
Worktree: /workspace/.worktrees/v2-open-role-mvp-s<N>/integration
Branch: pluto/v2/open-role-mvp-s<N>-<short-name>
Bundle: /workspace/tasks/remote/v2-open-role-mvp-s<N>
Report: /workspace/tasks/remote/v2-open-role-mvp-s<N>/artifacts/REPORT.md
First command: cd <worktree> && git status --short && git log --oneline -5
```

`prompt.md` MUST require a `REPORT.md` with: Summary, Files changed, Decisions made, Approaches considered and rejected, Gates / evidence, Stop conditions hit, Verdict with implementation+report commit SHAs.

`prompt.md` MUST mandate the commit step explicitly (per `feedback_slice_prompt_must_mandate_commit.md`): exact `git add` + commit + push sequence, commit SHAs in the verdict block.

## 7. Dispatch conventions

- One warm Daytona sandbox for the whole iteration.
- Manager-tier remote agents launched via `paseo agent run --host <preview> --provider opencode --model openai/gpt-5.4 --mode orchestrator --thinking high --cwd /workspace/.worktrees/v2-open-role-mvp-s<N>/integration --detach`.
- Never `daytona exec ... paseo run`.
- Wait notification-first: `paseo wait --host <preview> --timeout 1800 <agent-id>` as a host-background bash.
- R1 fallback: one CronCreate one-shot at +25min while waiting.

## 8. Review pattern

After each slice patch lands:
1. Independent local OpenCode review (`session new --agent orchestrator`) against `main..<slice-branch>` and acceptance bar.
2. Reviewer verdict: `NO_OBJECTIONS` / `OBJECTIONS_MECHANICAL` / `OBJECTIONS_SUBSTANTIVE` with file:line evidence.
3. Bare verdict tag → continue same review session and ask for specifics. Do not dispatch a fixup from a bare tag.
4. Before sending fixups, read the implementing agent's REPORT.md + paseo logs. They may already have tested/rejected the reviewer's path.
5. Substantive fixups go to the same remote sandbox agent (continue session, not new).
6. Re-review uses the same reviewer session.

## 9. Branch / merge hygiene

- One branch per slice: `pluto/v2/open-role-mvp-s<N>-<short-name>`.
- Fast-forward merge into `main` only.
- Rebase the slice branch if `main` moved during review.
- Never merge before review is clean.
- After merge: archive the slice branch.

## 10. Memory + plan touchpoints

After each slice closes:
1. Update `docs/plans/active/v2-open-role-mvp.md` slice status.
2. Add the slice's commit SHA to the plan's slice table.

After all four slices land + POST-T14 PASS:
1. Move the plan from `docs/plans/active/` to `docs/plans/completed/`.
2. Write a memory entry `project_t14_closed.md` summarizing the arc, including what worked and what surprised.
3. Update `MEMORY.md` index.

## 11. Cross-cutting binding rules

| Rule | Where |
|---|---|
| R1 | One CronCreate fallback wakeup whenever waiting on a bg notification. |
| R7 | 20-min cap per test invocation; targeted-only during fixes. |
| R8 | `smoke:live` once per slice at the very end. |
| R9 | Three-layer gate ownership; manager doesn't run full gates. |
| R10 | Prefer route/handler/schema-layer enforcement over prompt nudges. |
| R11 | Bare reviewer verdicts → ask for specifics before fixup. |

## 12. Anti-patterns to avoid

- Hex-escaping a string to slip past a grep gate. Fix the gate scope, not the string.
- Pre-filling LLM-expected JSON in prompts. That's v1.6 residue.
- Restoring the canonical `lead` close-out via prompt-only nudges instead of route-layer enforcement.
- Adding a new composite verb in T14. Reuse existing `worker-complete`, `evaluator-verdict`, `final-reconciliation`.
- Adding new run-event kinds in T14. Closed envelope.
- Letting the iteration grow past 4 slices. New work → T14-S5 (new dispatch) or T15.

## 13. Open-role identity model (the single most important T14 invariant)

T14 ships:
- Role string is open: `lead` and `manager` are still required, but `researcher`, `designer`, `poet`, `critic`, etc. compile.
- `actorKey(actor)` is still `role:<role>` for role-kind actors. Two actors that resolve to the same key fail fast at load.
- Authority lives in the compiled `TeamContext.policy` and is consulted by the validator.
- Custom non-lead roles inherit the worker-complete close-out path by default and can be authorized for `evaluator-verdict` via policy.

T14 does NOT ship:
- `actor:<id>` identity, multi-same-role workers, lead-profile abstraction, actor-id slicing, user-authored DSL, new composite verbs.

When in doubt: smaller and structural beats clever and prompt-only.
