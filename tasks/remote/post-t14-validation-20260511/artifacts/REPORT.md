# POST-T14 Validation Report

> Iteration: T14 — Pluto v2 Open-Role MVP
> Date: 2026-05-11
> Verdict: PASS (after close-out doc-sync)

## Summary

T14 ships open-role MVP: authored Playbooks can declare custom non-lead roles (e.g. `poet`, `critic`), the runtime resolves them end-to-end with structural authorization, and duplicate-`actorKey` declarations fail fast. Lead remains structurally forced through `final-reconciliation` (T13-S2 still binds). Adapter contract suite covers Fake + Paseo. POST-T14 confirms canonical Symphony unchanged + open-role poet-critic scenario clean.

## Final stack on `main`

| Commit | Slice |
|---|---|
| `4d270595` | T14 plan + context packet |
| `966e0fb1` | T14-S4/S5 split |
| `4c01ad08` | T14-S1 — authority policy single source |
| `f3c93a42` | T14-S1 REPORT |
| `2f1495f0` | hotfix: zod dep on @pluto/v2-core |
| `105b381d` / `8716f428` | T14-Sx — paseo cascade test fixtures (T13-S2 follow-up) |
| `5967cea2` | T14-Sx REPORT |
| `9f38765a` | T14-S2 — open `ActorRole` enum → validated string |
| `1940fc06` | T14-S2 REPORT |
| `a09191f2` | T14-S4 — adapter contract suite (Fake + Paseo) |
| `701d5367` | T14-S4 REPORT |
| `dfd19899` | T14-S3 — runtime open-role wiring + duplicate-`actorKey` fail-fast |
| `81e72d0a` | T14-S3 REPORT |
| `75ef9135` | T14-S5 — open-role scenario fixture + docs sync |
| `c7db4b11` / `505160a8` / `fee3ff02` / `46c3749f` | T14-S5 REPORTs + canonical-pointer fix-up |

## Acceptance bar

| # | Bar | Evidence | Verdict |
|---|---|---|---|
| 1 | Symphony fixture remains 10/10 (no regression) | `tests/fixtures/live-smoke/symphony-summary-custom-test/evidence-packet.json` `status=succeeded`, `summary.audit={status:"pass",failures:[]}`, completedTasks=2, citedMessages=["8"], unresolvedIssues=[]. Smoke duration 308s, exit 0. | PASS |
| 2 | Custom-role spec compiles + runs end-to-end with audit pass | `tests/fixtures/live-smoke/run-poet-critic-open-role/evidence-packet.json` `status=succeeded`, `audit.status=pass`, `role:poet` + `role:critic` participated end-to-end (draft → critique → revise → accept). | PASS |
| 3 | Duplicate-`actorKey` declarations fail fast at load | `packages/pluto-v2-runtime/src/loader/authored-spec-loader.ts:175-193` + `__tests__/loader/authored-spec-loader.test.ts:335-360` (T14-S3) | PASS |
| 4 | Authority validation drives compiled policy (no separate matrix) | `packages/pluto-v2-core/src/core/authority.ts:87-93` `actorAuthorizedForIntent` reads `state.policy` (T14-S1) | PASS |
| 5 | Fake + Paseo pass shared `describeRuntimeAdapterContract` | `packages/pluto-v2-runtime/__tests__/adapters/contract/runtime-adapter-contract.ts` + `fake-adapter.contract.test.ts` + `paseo-adapter.contract.test.ts` (T14-S4) | PASS |
| 6 | Lead close-out structurally forced through `final-reconciliation` | Both Symphony and poet-critic evidence packets carry `summary.audit` (composite verb), not raw text from primitive `complete-run`. | PASS |
| 7 | README + `docs/harness.md` + `docs/mvp-alpha.md` describe the MVP honestly with explicit deferred T15+ list | All three docs now carry both the T14-shipped surface and the deferred T15+ bullets (post-T14 doc-sync commit). | PASS |
| 8 | Slice bundles include REPORTs | All five slices + Sx have committed REPORTs. | PASS |
| 9 | R8 honored | smoke:live ran exactly twice across the iteration: once during S5 (poet-critic capture, captured as fixture) and once at POST-T14 close (Symphony regression). | PASS |

## Deferred / known issues (NOT T14 defects)

- `tests/cli/*` harness rot — tests rewrite `packages/pluto-v2-core/{package.json,index.js}` and the local `zod` shim mid-run, corrupting subsequent worktree state. Documented across S1, S3, S5 REPORTs. **Defer to a small POST-T14 cleanup slice or T15 prep**. Not a T14 acceptance defect.

## Lessons

1. The `pluto-v2-core/package.json` zod-dep gap was on main since before T12 — it only surfaced under fresh-build conditions. Build/typecheck artifacts on main were sufficient because the workspace's pnpm hoisting masked the missing declaration. Hotfix: `2f1495f0`. Lesson: declare every actually-used dep, even when hoisting works today.
2. POST-T12 PASS used smoke:live only, not `pnpm --filter @pluto/v2-runtime test`. T13-S2 cascade test fixtures rotted unnoticed for a day. Lesson: capture cascade-test fixture rot as part of the slice that introduces the runtime behavior change. Codified into T14-Sx.
3. Stale-base reviewer false positives are real and recurring. When a reviewer cites "scope creep" against a branch that's based on an older main, rebase first and re-review (don't just argue — show clean diff). T14-S2, T14-S4, T14-S3 all hit this pattern.
4. Scope-correction in OC reviewer disputes: when a reviewer's verdict disagrees with empirical evidence (route enforcement on main, repo convention), push back in the SAME review session with file:line + bash command evidence. Stay structural, don't argue policy.
5. The poet-critic scenario shows the open-role MVP works end-to-end with a real LLM. Lead routed back through `final-reconciliation`, custom roles authorized cleanly, audit returned pass.

## Next iteration candidates (T15+)

- `tests/cli/*` harness rot cleanup (small, mechanical).
- `actor:<id>` identity rewrite (multi-same-role workers).
- User-authored capability/policy DSL.
- Lead-profile generalization beyond literal `lead`.
- Actor-id-based playbook section slicing.
