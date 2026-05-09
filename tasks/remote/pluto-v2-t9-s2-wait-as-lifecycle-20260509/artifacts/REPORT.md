# T9-S2 Report

## Summary

- Added `turnDisposition` to successful mutating local-API responses.
- Added CLI default auto-wait for non-terminal mutating commands, with `--no-wait` opt-out and `--wait-timeout-ms` / `PLUTO_WAIT_TIMEOUT_MS` timeout control.
- Added driver-side `turn_state_transition` diagnostics and actor turn-state tracking for active, waiting, idle, and terminal states.
- Added smoke-acceptance polling detection by scanning actor transcripts for `read-state` between same-actor mutations.

## Design Choices

- Timeout default: `120000` ms in the CLI auto-wait path unless overridden by `--wait-timeout-ms` or `PLUTO_WAIT_TIMEOUT_MS`.
- Auto-wait timeout behavior: non-fatal. The merged CLI JSON returns `{ mutation, wait: { kind: "wait_timeout", timeoutMs } }` so the actor can decide what to do next.
- `complete-run` stays terminal-only: the server returns `turnDisposition: "terminal"`, and the CLI does not auto-wait after it.
- Turn-state traces are emitted in `run-paseo` runtime diagnostics, while evidence-packet runtime diagnostics stay filtered to the pre-existing wait / bridge / closeout categories.

## Tests

- Extended CLI coverage for default auto-wait, `--no-wait`, and terminal `complete-run` behavior.
- Extended local-API coverage for `turnDisposition` / `nextWakeup` response fields.
- Extended agentic Paseo coverage for lead auto-wait behavior and no explicit `pluto_read_state` between lead mutations.
- Added `turn-state.test.ts` for active -> waiting -> active -> terminal tracing.

## Gates

- `pnpm --filter @pluto/v2-runtime typecheck`: pass
- `pnpm exec tsc -p tsconfig.json --noEmit`: pass
- `pnpm --filter @pluto/v2-runtime test`: pass
- `pnpm test`: pass
- `gate_no_predecessor_mutation`: pass

## Baseline Gate Noise

- `gate_no_kernel_mutation` fails on the branch baseline because `main..HEAD` already includes the pre-existing bundle commit `a8e6573` plus unrelated drift such as `packages/pluto-v2-core/index.js` and many task artifact files. This slice did not add new `pluto-v2-core` edits.
- `gate_diff_hygiene` fails for the same branch-baseline reason: the existing bundle commit already makes `main..HEAD` much wider than the slice allowlist.
- `gate_no_verbatim_payload_prompts` fails on pre-existing captured live-smoke transcript fixtures that already contain the forbidden phrase on `main`; the slice did not add new prompt text with that wording.

## Stop Conditions

- No stop condition was hit.

## Review fixup (review round 2)

- Objection 1: rejected mutating responses no longer advertise `turnDisposition` / `nextWakeup`, and the CLI now only auto-waits when `accepted === true` and `turnDisposition === "waiting"`.
- Objection 2: `transitionAllActorsTerminal()` now terminalizes the full declared-actor set on run completion, including actors that never emitted a prior transition.
- Objection 3: smoke polling detection now matches anchored `pluto-tool ... <subcommand>` command lines instead of loose prose substring hits, and a prose-only `read-state` regression test was added.
- Objection 4: `task-closeout.test.ts` now restores the original exact wait-trace sequence assertion after filtering to wait-trace kinds.
- New tests added in this review fixup: 2.
- Fixup validation: `pnpm install`, `pnpm --filter @pluto/v2-runtime test`, and `pnpm test` passed; both `tsc`-based typecheck commands hit sandbox memory limits (`SIGABRT` / `137`) despite retrying with raised heap, so they remain an environment limitation rather than a code regression signal.
