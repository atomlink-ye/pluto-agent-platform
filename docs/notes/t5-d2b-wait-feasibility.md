# T5-D2b wait feasibility discovery

- Date: 2026-05-08
- Slice: T5-D2b - wait feasibility spike
- Authority plan: `docs/plans/active/v2-actor-loop-hardening.md`

## Final Summary

```text
T5-D2b RESULT
single-flight session: pass
B-completes-before-A-wait: yes, 21501ms
A-cancellation cleanup: clean
tightest-timeout-in-chain: server wait cap @ 120s
recommendation: GO
```

## What Ran

- Proof script: `packages/pluto-v2-runtime/scripts/smoke-wait-feasibility.ts`
- Transport shape: two detached Paseo/OpenCode actors using OpenCode `bash` plus `curl` against a throwaway localhost JSON-RPC endpoint.
- Stub tools:
  - `pluto_wait_for_event(timeoutSec)` sleeps for `min(timeoutSec, 120)` and returns `{ kind: 'timeout', waited_ms }`.
  - `pluto_read_state()` returns immediately.

## Findings

### 1. Deadlock / single-flight scheduler risk

- **Pass.** Actor A entered a 30s wait at `1778256480961`.
- Actor B reached `pluto_read_state` at `1778256489464` while A was still blocked.
- Actor A did not complete until `1778256510965`.
- Result: B's request completed **21.501s before** A's wait returned.
- Interpretation: one blocked OpenCode session did **not** prevent another Paseo-managed session from progressing.

### 2. Lost wakeups / arm-then-park race

- **Not directly exercised.** This spike intentionally used a sleep-only stub, with no real cursor, wait registry, or wake delivery path.
- What D2b proves is narrower: the current runtime can carry a blocking wait-shaped request without freezing sibling actor sessions.
- Remaining S2b requirement: implement atomic cursor check + wait registration in production code, or the registry can still lose wakeups even though the transport is feasible.

### 3. Timeout-chain mismatch

- **Pass at the tested boundary.** A 120s wait completed normally.
- Observed timeout winner in the live path was the proof server's explicit 120s wait cap, not Paseo or OpenCode.
- Supporting values:
  - `paseo wait --help`: default timeout is **no limit** unless `--timeout` is supplied.
  - Node HTTP defaults on this host: `requestTimeout=300s`, `headersTimeout=60s`, `timeout=0s`, `keepAliveTimeout=5s`.
  - Live probe: `actor-a3` held the request for `120000ms` and returned normally.
- Interpretation: within a 120s envelope, this runtime did **not** show a shorter hidden tool/session cap.

### 4. Cancellation / cleanup behavior

- **Clean in the proof path.** Actor A2 started a 120s wait, then `paseo stop` was issued 5s later.
- The server observed the HTTP client disconnect after `9615ms` total wait time.
- A fresh Actor B2 read request completed immediately afterward.
- Interpretation: stop/interrupt unwound the blocked request cleanly enough for the proof, and post-cancel sibling progress remained intact.

## Recommendation For S2b

- **GO** for the runtime-feasibility question that D2b was meant to answer.
- Rationale:
  - blocked wait traffic did not deadlock the sibling scheduler,
  - cancellation produced a clean disconnect,
  - no earlier timeout fired before a 120s server-held wait completed.
- Constraint that still matters: GO here is only about transport/runtime feasibility. S2b still needs an atomic wait-registry design to avoid lost wakeups.

## Migration Cost Re-estimate

- Recommendation-held path: keep the existing T5-S2b plan shape.
- Updated estimate: still roughly the plan's stated `~700-1200 LOC, 6-9 files`.
- Reason the cost does not shrink much: D2b removed the transport feasibility doubt, but it did **not** eliminate the real implementation work around cursor atomicity, cancellation fan-out, and observability.

## Notes On Gates

- `pnpm exec tsx packages/pluto-v2-runtime/scripts/smoke-wait-feasibility.ts`: **passed** and produced the summary above.
- `pnpm --filter @pluto/v2-runtime typecheck`: **fails before this spike's new code is isolated** due pre-existing repo issues outside D2b scope, including:
  - `packages/pluto-v2-core/package.json` not declaring `zod`, causing module-resolution failures from baseline source files.
  - existing type errors across `packages/pluto-v2-core/**` and `packages/pluto-v2-runtime/src/**` unrelated to this spike.
- Because the runtime barrel import pulled in the broken baseline dependency graph, the proof script imports the Paseo CLI client directly from `src/adapters/paseo/paseo-cli-client.ts` to keep the spike runnable without touching out-of-scope production surfaces.
