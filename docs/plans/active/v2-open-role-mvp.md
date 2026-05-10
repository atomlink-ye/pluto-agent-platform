# T14 — Pluto v2 Open-Role MVP

> Status: ACTIVE. Drafted 2026-05-10 from synthesis of two independent Discovery proposals (@oracle, @council) at `/tmp/t14-discovery/`. Predecessor: T12/T13 closed at `feea5128` with POST-T12 PASS 10/10.

## 1. Goal

Open `ActorRole` from a closed enum (`lead | planner | generator | evaluator`) to a validated string while making authority policy structurally real end-to-end. After T14, an authored Playbook can declare custom non-lead roles such as `researcher`, `designer`, `poet`, or `critic`, and Pluto v2 will compile, authorize, and run them. Multi-same-role identity (`actor:<id>` form) and a user-authored policy DSL are explicitly deferred to T15+.

The iteration is bounded as an MVP: it ships open custom roles with structural authority backing, fails closed on known identity hazards, and preserves every existing canonical behavior. It does not solve all per-actor identity problems, and it does not add product polish beyond what is required to prove the MVP.

## 2. Why now

- `feedback_prefer_structural_over_prompt_enforcement.md` (rule R10): T13 took three rounds to learn that prompt-only enforcement is unreliable. T14's design must lean on route/handler/schema-layer enforcement, not prompt nudges.
- The dominant blocker after T12/T13 is the closed role enum. With the audit gate (T12-S3), audit/replay/explain CLI (T12-S4a/S4b), compiled bridge (T12-S2), and route-layer close-out enforcement (T13-S2) all in place, the platform is ready to absorb a kernel thaw without losing audit fidelity.
- Adapter contract tests (P5 in the original GPT Pro roadmap) remain the only unaddressed roadmap item besides the role schema. T14 lands them additively in S4.

## 3. Slice breakdown

### T14-S1 — Authority policy single source-of-truth

- **Goal**: Remove the drift between `CANONICAL_AUTHORITY_POLICY`, the `TeamContext.policy` compiled field, and the hardcoded `AUTHORITY_MATRIX` enforcement path. Validation evaluates one compiled policy.
- **Files in scope** (expected; implementer confirms during the slice):
  - `packages/pluto-v2-core/src/core/authority.ts`
  - `packages/pluto-v2-core/src/core/team-context.ts`
  - `packages/pluto-v2-core/src/core/spec-compiler.ts`
  - `packages/pluto-v2-core/src/core/protocol-validator.ts`
  - `packages/pluto-v2-core/src/core/run-state.ts`
  - `packages/pluto-v2-core/src/core/index.ts`
  - `packages/pluto-v2-core/__tests__/core/authority.test.ts`
  - `packages/pluto-v2-core/__tests__/core/spec-compiler.test.ts`
  - `packages/pluto-v2-core/__tests__/core/run-kernel.test.ts`
- **Risk**: Medium — kernel authorization touched.
- **Acceptance bar**:
  - Canonical four-role specs behave identically.
  - Runtime authorization evaluates the compiled `TeamContext.policy`, not a separate matrix copy.
  - No path silently authorizes or silently de-authorizes.
  - Targeted gate suite green; full suite + smoke:live (R8 final-only).
- **Cost**: M.

### T14-S2 — Open role string in core (kernel thaw)

- **Goal**: Change `ActorRole` from a closed Zod enum to a validated, branded string. `lead` and `manager` remain required system roles for `agentic_tool` orchestration. Existing fixtures pass unchanged.
- **Files in scope** (expected):
  - `packages/pluto-v2-core/src/actor-ref.ts`
  - `packages/pluto-v2-core/src/core/team-context.ts`
  - `packages/pluto-v2-core/src/core/spec-compiler.ts`
  - `packages/pluto-v2-core/src/protocol-request.ts`
  - `packages/pluto-v2-core/src/run-event.ts`
  - `packages/pluto-v2-core/src/index.ts`
  - `packages/pluto-v2-core/__tests__/core/team-context.test.ts`
  - `packages/pluto-v2-core/__tests__/core/spec-compiler.test.ts`
  - `packages/pluto-v2-core/__tests__/core/run-state-reducer.test.ts`
  - `packages/pluto-v2-core/__tests__/core/protocol-validator.test.ts`
- **Risk**: High — `ActorRole` fans into core schemas, matcher types, exported types, runtime token binding, prompt slicing, and many tests.
- **Acceptance bar**:
  - Authored specs with roles such as `researcher`, `designer`, `poet`, `critic` compile when the policy authorizes them.
  - Empty / whitespace / invalid role strings still fail compile.
  - All existing `lead | planner | generator | evaluator` fixtures pass unchanged in event/state shape.
  - Agentic orchestration still requires declared `lead` and `manager`.
- **Cost**: L.

### T14-S3 — Runtime open-role wiring + duplicate-actorKey fail-fast

- **Goal**: Make `agentic_tool` usable end-to-end with custom non-lead roles. Add a fail-fast guard so two declared actors collapsing to the same `actorKey` error loudly at load instead of silently sharing identity. Replace the empty close-out branch for custom non-lead roles with structural guidance routed through the existing primitive/composite path.
- **Files in scope** (expected):
  - `packages/pluto-v2-runtime/src/loader/authored-spec-loader.ts`
  - `packages/pluto-v2-runtime/src/api/pluto-local-api.ts`
  - `packages/pluto-v2-runtime/src/cli/pluto-tool.ts`
  - `packages/pluto-v2-runtime/src/cli/runs.ts`
  - `packages/pluto-v2-runtime/src/adapters/paseo/run-paseo.ts`
  - `packages/pluto-v2-runtime/src/adapters/paseo/agentic-tool-prompt-builder.ts`
  - `packages/pluto-v2-runtime/src/adapters/paseo/prompt-view.ts`
  - `packages/pluto-v2-runtime/src/api/wait-registry.ts`
  - `src/cli/v2-cli-bridge.ts`
  - `packages/pluto-v2-runtime/__tests__/loader/authored-spec-loader.test.ts`
  - `packages/pluto-v2-runtime/__tests__/adapters/paseo/agentic-tool-prompt-builder.test.ts`
  - `packages/pluto-v2-runtime/__tests__/adapters/paseo/run-paseo.test.ts`
  - `packages/pluto-v2-runtime/__tests__/api/pluto-local-api.actor.test.ts`
- **Risk**: Medium — many runtime call sites consume `actorKey`; prompt behavior still keys off canonical roles in places.
- **Acceptance bar**:
  - A spec declaring two actors that resolve to the same `actorKey` fails fast with a specific load/compile error, before any runtime side effect.
  - Custom non-lead roles no longer receive an empty close-out branch; they receive explicit structural guidance using the allowed primitive (`worker-complete`) or canonical (`evaluator-verdict`) path.
  - Lead close-out remains structurally forced through `final-reconciliation`. No prompt-only workaround is introduced.
  - Targeted gate suite green; full suite + smoke:live (R8 final-only).
- **Cost**: M.

### T14-S4 — Adapter contract suite (Fake + Paseo)

- **Goal**: Add a shared `describeRuntimeAdapterContract` helper covering Fake and Paseo adapters against the same lifecycle/transport invariants: init, request/done sequencing, state progression, max-turn / error behavior, termination. This slice is independent of the role-schema chain (S1/S2/S3) — it touches the adapter interface and adapter-test surface only, not `pluto-v2-core` and not the role schema. **It runs in parallel with S1, S2, and S3.**
- **Files in scope** (expected):
  - `packages/pluto-v2-runtime/src/runtime/runtime-adapter.ts` (read; extend only if a contract gap is real)
  - `packages/pluto-v2-runtime/__tests__/adapters/contract/` (new shared `describeRuntimeAdapterContract` helper)
  - `packages/pluto-v2-runtime/__tests__/adapters/fake/fake-adapter.contract.test.ts`
  - `packages/pluto-v2-runtime/__tests__/adapters/paseo/paseo-adapter.contract.test.ts`
- **Risk**: Low — additive. Helper must not overfit to one adapter; both must satisfy the same invariants.
- **Acceptance bar**:
  - A shared `describeRuntimeAdapterContract(adapterName, factory)` helper exercises Fake and Paseo against the same suite.
  - Both adapters pass the contract for: init, request/done sequencing, state progression, max-turn / error classification, termination.
  - No imports from `pluto-v2-core/src/*` (use public surface only); no construction of full kernel `RunState`; no dependency on `ActorRole` shape.
  - Targeted gate suite green; full suite at slice end. **No `smoke:live` in this slice.**
- **Cost**: M.

### T14-S5 — Open-role scenario fixture + README/docs sync

- **Goal**: Prove the full chain end-to-end with one custom-role scenario fixture (custom roles, e.g. `poet`/`critic`) and sync `README.md`, `docs/harness.md`, and `docs/mvp-alpha.md` to the shipped MVP shape with explicit T14 limits and the deferred T15+ list.
- **Depends on**: S1, S2, S3 merged. Optionally on S4 (the open-role fixture should also pass any applicable adapter-contract assertions).
- **Files in scope** (expected):
  - `packages/pluto-v2-runtime/test-fixtures/scenarios/` (new open-role fixture)
  - `tests/fixtures/live-smoke/` (live-smoke fixture if needed for POST-T14)
  - `README.md`
  - `docs/harness.md`
  - `docs/mvp-alpha.md`
- **Risk**: Medium — this slice runs the iteration's final `smoke:live` (R8 trigger).
- **Acceptance bar**:
  - Custom-role fixture compiles, runs through the supported path, produces a valid evidence packet, audit returns `pass`.
  - Symphony fixture remains 10/10 unchanged.
  - Docs describe the shipped MVP honestly: open custom non-lead roles, fixed `lead`/`manager`, one-actor-per-role limit, deferred T15+ items.
  - One final `pnpm smoke:live` per R8.
- **Cost**: M.

## 4. Out of scope (deferred to T15+)

- Full `actor:<id>` identity rewrite (multi-same-role workers in one run, transcripts/tokens/waits/prompts keyed on actor id).
- User-authored policy / capability DSL (`policy.roles.<role>.can: [...]`).
- Lead-profile generalization (removing literal `lead` from agentic orchestration).
- Actor-id-based playbook section slicing (still `## <role>`).
- New composite verbs beyond `worker-complete`, `evaluator-verdict`, `final-reconciliation`.

## 5. Risk register

| # | Risk | Severity | Mitigation |
|---|---|---|---|
| 1 | Kernel thaw widens `ActorRole` blast radius | High | S2 lands as one slice with full test sweep; preserve fixed-role event/state shape. |
| 2 | Authority logic drifts further | High | S1 lands first; one default policy and one matcher path. Tested with both canonical and non-canonical specs. |
| 3 | Open role compiles but runtime denies silently | High | S1 must precede or accompany S2; runtime authorization tests cover custom-role spec end-to-end. |
| 4 | Same-role actors collapse on `role:<role>` and corrupt auth/transcript state | High | S3 adds explicit duplicate-`actorKey` fail-fast guard; full `actor:<id>` migration deferred. |
| 5 | Prompt builder leaves custom roles with empty close-out branch | Medium | S3 routes custom non-lead roles to structural guidance via the existing primitive/composite path. |
| 6 | Adapter contract helper overfits to one adapter | Medium | Keep contract narrow: init, request/done, state progression, termination. |
| 7 | Iteration grows beyond 5 slices | Medium | If a new slice is needed, finish T14-S1..S5 first and dispatch as T14-S6; do not bundle. |
| 8 | Parallel S1 ‖ S4 produces merge conflict on main | Low | S4 touches no file overlapping S1; rebase S4 onto the new main after S1 lands. Verify with `git rebase main` before final push. |

## 6. POST-T14 acceptance bar

Additive on top of POST-T12's 10/10 (which T14 must keep at 10/10):

1. Symphony custom-workflow scenario remains PASS 10/10 (no regression on canonical four-role behavior).
2. A custom-role authored spec (e.g. `poet`/`critic`) compiles and runs end-to-end through `agentic_tool`, produces a valid evidence packet, and audit returns `pass`.
3. A spec declaring two actors that resolve to the same `actorKey` fails fast at load with a specific error.
4. Runtime authorization is driven by compiled policy, not by a separate hardcoded matrix.
5. Fake and Paseo both satisfy the shared `describeRuntimeAdapterContract` suite.
6. Lead close-out remains structurally forced through `final-reconciliation` (T13-S2 still binds).
7. README and `docs/harness.md` describe the shipped MVP honestly, with explicit T14 limits and the deferred T15+ list.
8. Each slice bundle includes `HANDOFF.md`, `prompt.md`, `commands.sh`, `acceptance.md`, timing-instrumented gates, and a REPORT with decisions / approaches considered and rejected / stop conditions hit / commit SHAs.
9. R8 honored: smoke:live runs once per slice at the very end.

## 7. Execution conventions

- Per-iteration context packet at `docs/notes/v2-open-role-mvp-context-packet.md` — every slice prompt reads this FIRST.
- Slice bundles under `tasks/remote/v2-open-role-mvp-s<N>/`.
- One warm Daytona sandbox for the whole iteration.
- Three-layer gate ownership (R9): implementer runs full gates and writes artifacts; reviewer reads diff/artifacts; manager does not run full gates.
- Independent OC review per slice; reuse the same review session for re-review of the same branch.
- Merge fast-forward into `main` only after review is clean.
- POST-T14 validation runs the Symphony fixture **and** the new open-role fixture before declaring close.

## 8. Parallelism

S4 (adapter contract suite) runs in parallel with the role-schema chain (S1 → S2 → S3). The chain stays serial because:

- S1 (single-source policy) lands the policy reroute that S2 relies on.
- S2 (open role schema) lands the branded-string `ActorRole` that S3 wires.
- S3 (runtime wiring + collision guard) lands the end-to-end chain that S5 proves.

Concretely:
- T = 0: dispatch S1 + S4 concurrently on the same warm sandbox, different worktrees.
- After S1 merges: dispatch S2.
- After S2 merges: dispatch S3.
- After S3 + S4 both merged: dispatch S5.

S4's branch rebases on the new main after each upstream slice merges; the conflict surface is empirically empty (S4 touches `__tests__/adapters/contract/` and the adapter interface; S1/S2/S3 don't touch those paths).

## 9. Stop conditions

Close T14 only when POST-T14 hits all criteria. If iteration finds a real gap that cannot be absorbed in T14 without exceeding 5 slices, dispatch as T15 — do not bundle into T14. Reference `feedback_iterate_until_clean_loop.md`.
