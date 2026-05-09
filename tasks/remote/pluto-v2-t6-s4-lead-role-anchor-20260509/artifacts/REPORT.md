# T6-S4 Report

## Scope completed

- Added a bootstrap-only `## Role anchor` section to `buildAgenticToolPrompt`.
- Threaded `runId` from `run-paseo.ts` into the bootstrap prompt builder.
- Added bootstrap assertions for lead, generator, manager, and system actors.
- Strengthened the wakeup prompt test to prove the role anchor does not appear there.

## Prompt anchor text

`You are the live <actor> actor for run <runId>. Drive this run yourself by calling Pluto tool <wrapperPath> from your shell. Do NOT use external control planes ... There is no other actor; you are the actor.`

## Verification

- `./commands.sh bootstrap`: passed
- `./commands.sh gate_no_kernel_mutation`: passed
- `./commands.sh gate_no_predecessor_mutation`: passed
- `./commands.sh gate_diff_hygiene`: passed
- `./commands.sh gate_no_verbatim_payload_prompts`: failed on pre-existing out-of-scope live-smoke fixture transcripts under `tests/fixtures/live-smoke/029db445-aa2b-406e-ad16-fde7fb45e51d/**`
- `./commands.sh gate_typecheck`: runtime typecheck failed on existing `@pluto/v2-core` / `zod` baseline issues after bootstrap rewrote `pnpm-lock.yaml`; no T6-S4-specific errors were introduced
- `./commands.sh gate_test`: runtime package tests passed at `192/194`; root tests failed at `27/37` on existing CLI baseline issues caused by the same `zod`/core package state

## Notes

- The scripted bootstrap/install in the integration worktree produced unrelated `pnpm-lock.yaml` modifications and an untracked `packages/pluto-v2-core/index.js`. Those files were intentionally excluded from the T6-S4 commit.
- Remote push failed because this environment has no GitHub credentials for `https://github.com`.

## Verdict

T6-S4 COMPLETE
prompt-anchor-text: bootstrap says the actor is the live `<actor>` for run `<runId>`, must drive the run via `<wrapperPath>`, and must not use external control planes because there is no other actor
new tests: 1
typecheck-new-errors: 0
runtime-tests: 192/194
root-tests: 27/37
push: failed
