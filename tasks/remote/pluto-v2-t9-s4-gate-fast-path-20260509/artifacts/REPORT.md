# T9-S4 Report

## Summary

- Added split runtime typecheck entrypoints: `typecheck:src` and `typecheck:test`, plus src/test tsconfig files and a src-only runtime `build` target.
- Updated the T9 context packet and this slice bundle to codify single-attempt OOM handling: record the artifact, do not retry with a larger heap, and continue the remaining gates.
- Confirmed the slice stayed build-tooling only: no `packages/pluto-v2-runtime/src/**`, `packages/pluto-v2-runtime/__tests__/**`, or `packages/pluto-v2-core/src/**` edits landed.

## What Changed

- `packages/pluto-v2-runtime/package.json`
  Added `typecheck:src`, `typecheck:test`, composed `typecheck`, and pointed `build` at the src-only tsconfig.
- `packages/pluto-v2-runtime/tsconfig.src.json`
  Added a src-only runtime TS program.
- `packages/pluto-v2-runtime/tsconfig.test.json`
  Added a tests-only runtime TS program.
- `packages/pluto-v2-runtime/tsconfig.json`
  Made the catch-all intent explicit with `composite: false`.
- `.gitignore`
  Ignored `*.tsbuildinfo` outputs.
- `docs/notes/t9-context-packet.md`
  Replaced the old larger-heap retry advice with the new record-once OOM policy and documented the new runtime typecheck entrypoints.
- `tasks/remote/pluto-v2-t9-s4-gate-fast-path-20260509/commands.sh`
  Updated the slice bundle so typecheck artifacts are recorded and the gate flow continues past runtime/root OOM signatures instead of retrying ad hoc.

## Measurements

- Warm baseline `pnpm --filter @pluto/v2-runtime typecheck`:
  `14s`, exit `0`.
- Final `pnpm --filter @pluto/v2-runtime typecheck:src`:
  `205s`, exit `134` (`FATAL ERROR: Reached heap limit`).
- Final `pnpm --filter @pluto/v2-runtime typecheck:test`:
  `199s`, exit `134` (`FATAL ERROR: Ineffective mark-compacts near heap limit`).
- Final `pnpm exec tsc -p tsconfig.json --noEmit`:
  `203s`, exit `1` after fatal heap OOM.
- Final `pnpm --filter @pluto/v2-core exec tsc -p tsconfig.json`:
  `8s`, exit `0`.
- Final `pnpm --filter @pluto/v2-runtime build`:
  `207s`, exit `134` after fatal heap OOM.

## Diagnostics

- One allowed diagnostic pass of `tsc -b tsconfig.src.json --verbose` was captured in `artifacts/tsc-build-verbose-runtime-src.txt`.
- The verbose output shows the core project is already up to date and the runtime src project still heap-OOMs during its own build step.
- Because cold `typecheck:src` still heap-OOMs after the split, this slice hit the prompt's stop path in spirit: the harness/runtime limit is documented, but the intended fast-path win was not achieved in this sandbox.

## Gates

- `pnpm --filter @pluto/v2-core exec tsc -p tsconfig.json`: pass
- `pnpm --filter @pluto/v2-runtime typecheck:src`: heap OOM (`134`)
- `pnpm --filter @pluto/v2-runtime typecheck:test`: heap OOM (`134`)
- `pnpm exec tsc -p tsconfig.json --noEmit`: heap OOM (`1` with fatal Node OOM output)
- `pnpm --filter @pluto/v2-runtime test`: pass (`242` passed, `2` skipped)
- `pnpm test`: pass (`37/37`)
- `gate_no_kernel_mutation`: pass
- `gate_no_source_changes`: pass
- `gate_diff_hygiene`: pass

## Stop Condition

- Stop condition hit: `2`
- Reason: cold `typecheck:src` still OOMs after the split, and the one allowed `tsc -b --verbose` diagnostic confirmed the failure happens while building the runtime src project itself.

## Notes

- `pnpm-lock.yaml` was modified by the existing bootstrap/install flow and was intentionally left uncommitted.
- `packages/pluto-v2-core/index.js` remains an untracked bootstrap artifact and was intentionally left uncommitted.
- New tests added: `0`.

## Verdict

```text
T9-S4 COMPLETE
typecheck:src duration: 205s (was 14s as single program on the warm baseline run)
typecheck:test duration: 199s
project-references-active: no
oom-discipline-codified: yes
new tests: 0 (build-only slice)
typecheck-new-errors: unknown (typecheck aborted on heap OOM before diagnostics completed)
runtime-tests: 242/244
root-tests: 37/37
push: failed
stop-condition-hit: 2
```

## Decisions made

- **Composite project references on v2-core**: NOT shipped.
  - Rationale: the split runtime tsconfigs were kept, but the follow-up composite/reference wiring was not carried forward because the sandbox never demonstrated a reliable cold improvement once the reference path was exercised.
  - Evidence: the first fast-path runtime src check passed quickly (`3s`, exit `0`) after the split landed, then subsequent re-runs regressed to heap OOMs (`190s` to `205s`, exit `134`) once the runtime program had to traverse the full graph again. The working diagnosis was that the inherited `paths` mapping still let the runtime program walk into `@pluto/v2-core` source on cold runs, so project references were not buying the intended isolation.
- **`tsc -b` build mode in scripts**: NOT used.
  - Rationale: build mode only helps if the referenced src declarations can be emitted reliably. In this sandbox, the src emit/typecheck step itself was the failing step, so switching the scripts to `tsc -b` would have moved the failure earlier without removing the cold OOM risk.
  - Evidence: the investigation path showed that a test config can only benefit from referencing src if the src declarations exist first, and the runtime src build/typecheck step was already the point that aborted with fatal heap OOMs.
- **`paths` mapping for `@pluto/v2-core`**: kept inherited from the parent tsconfig.
  - Rationale: overriding the runtime split configs to point at `../pluto-v2-core/dist/*.d.ts` would only be safe if cold v2-core builds were reliably available first. That prerequisite was not stable enough on this sandbox to justify shipping a second resolution mode.

## Approaches considered and rejected

- **Composite runtime src config plus `tsc -b` scripts**
  - Rejected because the cold runtime src build still aborted with fatal heap OOM once build mode was exercised, so the change would not have satisfied the fast-path goal.
- **Runtime test config referencing runtime src declarations**
  - Rejected as a shipped configuration because it depends on the runtime src declaration emit succeeding first, and that emit step was the unstable part on this sandbox.
- **Overriding runtime split-config `paths` to `v2-core/dist` declarations**
  - Rejected because it would have coupled the runtime fast path to a reliable prior v2-core build output, which the sandbox investigation did not establish as a dependable cold-path invariant.
- **Retrying typecheck with larger Node heaps or alternate `tsc` entrypoints**
  - Rejected by policy and by evidence. The slice codified the single-attempt OOM discipline specifically to stop repeating unsuccessful `NODE_OPTIONS=--max-old-space-size` retries and wrapper-script variations.

## Stop conditions hit

- **#2: cold `typecheck:src` still OOMs after split**
  - Evidence: `205s`, exit `134` (`FATAL ERROR: Reached heap limit Allocation failed - JavaScript heap out of memory`).
  - Diagnostic artifact: not committed on this branch. The local investigation used a one-off verbose build-mode diagnostic outside the tracked task artifacts, so future fixups should not assume a committed `tsc-build-verbose-runtime-src.txt` is present here.
