# T5-S2a Report

## Summary

- Added bootstrap-once plus minimal wakeup prompt rendering for the agentic Paseo loop.
- Added pure wakeup delta computation with per-actor event cursors and a guard for missing cursor state on reused actors.
- Added prompt-thinning unit coverage, loop coverage for repeat-turn thinning/cursor behavior, and the new skipped live invariant for post-bootstrap prompt ratios.

## Files Changed

- `packages/pluto-v2-runtime/src/adapters/paseo/agentic-tool-prompt-builder.ts`
- `packages/pluto-v2-runtime/src/adapters/paseo/wakeup-delta.ts`
- `packages/pluto-v2-runtime/src/adapters/paseo/run-paseo.ts`
- `packages/pluto-v2-runtime/__tests__/adapters/paseo/wakeup-prompt-builder.test.ts`
- `packages/pluto-v2-runtime/__tests__/adapters/paseo/wakeup-delta.test.ts`
- `packages/pluto-v2-runtime/__tests__/adapters/paseo/agentic-tool-loop.test.ts`
- `packages/pluto-v2-runtime/__tests__/fixtures/agentic-tool-live-invariants.test.ts`

## Validation

- `bash tasks/remote/pluto-v2-t5-s2a-prompt-thinning-20260508/commands.sh gate_typecheck`
- `bash tasks/remote/pluto-v2-t5-s2a-prompt-thinning-20260508/commands.sh gate_test`
- `bash tasks/remote/pluto-v2-t5-s2a-prompt-thinning-20260508/commands.sh gate_build`
- `bash tasks/remote/pluto-v2-t5-s2a-prompt-thinning-20260508/commands.sh gate_no_kernel_mutation`
- `bash tasks/remote/pluto-v2-t5-s2a-prompt-thinning-20260508/commands.sh gate_no_predecessor_mutation`
- `bash tasks/remote/pluto-v2-t5-s2a-prompt-thinning-20260508/commands.sh gate_no_verbatim_payload_prompts`
- `bash tasks/remote/pluto-v2-t5-s2a-prompt-thinning-20260508/commands.sh gate_wakeup_no_scaffold`
- `bash tasks/remote/pluto-v2-t5-s2a-prompt-thinning-20260508/commands.sh gate_diff_hygiene`

Focused pre-gate verification also passed:

- `pnpm --filter @pluto/v2-runtime typecheck`
- `pnpm --filter @pluto/v2-runtime exec vitest run __tests__/adapters/paseo/wakeup-prompt-builder.test.ts __tests__/adapters/paseo/wakeup-delta.test.ts __tests__/adapters/paseo/agentic-tool-loop.test.ts`

## Git

- Code commit created: `38f2c73` `feat(v2): T5-S2a prompt thinning (bootstrap once, wakeup deltas after)`
- `git push origin pluto/v2/t5-s2a-prompt-thinning` failed on auth:

```text
fatal: could not read Username for 'https://github.com': No such device or address
```

- Per task instructions, this auth failure is documented here for operator follow-up.

## Notes

- Running the full gates generated transient `packages/pluto-v2-core` worktree artifacts outside the slice allowlist; they were removed before commit so the final diff stayed within the binding prompt's hygiene scope.
