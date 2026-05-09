# T9-S1b — Per-actor bearer-token binding

You are working in:
- **Worktree (where you commit code)**: `/workspace/.worktrees/pluto-v2-t9-s1b-token-actor-binding-20260509/integration`
- **Branch (already checked out at the worktree)**: `pluto/v2/t9-s1b-token-actor-binding`
- **Bundle (read-only inputs)**: `/workspace/tasks/remote/pluto-v2-t9-s1b-token-actor-binding-20260509/`
- **Where REPORT goes**: write to `/workspace/.worktrees/pluto-v2-t9-s1b-token-actor-binding-20260509/integration/tasks/remote/pluto-v2-t9-s1b-token-actor-binding-20260509/artifacts/REPORT.md` (the worktree-side path is what gets committed; commands.sh has a `sync_bundle_into_worktree` step that ensures the directory exists)

Your first command should be:
```
cd /workspace/.worktrees/pluto-v2-t9-s1b-token-actor-binding-20260509/integration && git status --branch --short && git log --oneline main..HEAD
```

Surface map / current iteration status: read `docs/notes/t9-context-packet.md` first.

**Authority plan:** `docs/plans/active/v2-harness-workflow-hardening.md` T9-S1b.
**Predecessors merged on `main`:** T9-S1 `9e42f54`, T9-S2 `b48fba0`, T9-S3 `62e00a0f`, T9-S4 `829b64b7`.

## Why T9-S1b exists

T9-S1 (narrowed) shipped explicit `--actor` flag + run-level
binary + `Pluto-Run-Actor` header required + actor-set
membership check. But it explicitly DEFERRED token-actor
**cryptographic binding**: at run start, `run-paseo.ts:633`
generates ONE `bearerToken` and shares it across every actor
handoff. So a malicious actor with one valid token could
forge requests as any other actor by setting a different
`Pluto-Run-Actor` header.

T9-S1b closes that gap: each actor gets its own bearer token;
the server validates that the token in `Authorization: Bearer
<token>` is bound to the same actor named in the
`Pluto-Run-Actor` header. Mismatch → 403 `actor_mismatch`.

## Scope (in)

### 1. Per-actor token issuance in run-paseo

**Modify** `packages/pluto-v2-runtime/src/adapters/paseo/run-paseo.ts`:

- Replace the single per-run `bearerToken = randomUUID()` with
  a `Map<actorKey, string>` of per-actor tokens, generated at
  the same point in the run lifecycle.
- The map is populated for ALL declared actors at run start,
  not lazily — so `complete-run` terminalization (T9-S2 fix)
  and the actor-set membership check (T9-S1) both work for
  pre-declared but never-active actors.
- Pass each actor its own token through `handoff.json` (the
  per-actor cwd's handoff is the channel). Existing handoff
  threading already exists; just change which token gets baked
  in.

### 2. Token registry exposed to the API layer

**Modify** `packages/pluto-v2-runtime/src/api/pluto-local-api.ts`:

- The `LocalApiConfig` (or equivalent) currently takes
  `bearerToken: string`. Change to either:
  - (A) `tokenByActor: ReadonlyMap<string, string>` — map of
    actor key → token, OR
  - (B) `tokenForActor: (actorKey: string) => string | null`
    — function form that lets the registry stay in run-paseo.
- Pick whichever shape integrates cleanest with the existing
  config wiring; document the choice in REPORT.

- Mutating route handlers, after the existing actor-header
  check (T9-S1), verify:
  - `Authorization: Bearer <token>` is present.
  - The token matches what's bound to the actor named in
    `Pluto-Run-Actor` header.
- Mismatch → 403 with body
  `{ error: { code: "actor_mismatch", detail: "token bound to <bound>, request claimed <claimed>" } }`.
  (The detail string can show only the claimed actor; do NOT
  echo the bound token's actor in production responses to
  avoid information leakage. For T9-S1b ship the test-friendly
  shape; T10 can tighten.)

### 3. CLI awareness

`packages/pluto-v2-runtime/src/cli/pluto-tool.ts` already reads
the bearer token from `handoff.json` (T9-S1). Verify nothing
breaks because each actor's handoff now carries a different
token. No CLI behavior change expected; if you need to touch
this file, the change should be ≤10 lines.

### 4. actor-bridge wiring

`packages/pluto-v2-runtime/src/adapters/paseo/actor-bridge.ts`
materializes per-actor cwd + handoff.json. Confirm each actor's
handoff gets its own token written. Existing function signature
likely already takes the token as an argument; just thread the
correct per-actor token through. ≤20 lines expected.

### 5. Tests

**New / modified:**

`packages/pluto-v2-runtime/__tests__/api/pluto-local-api.actor.test.ts`
(extend existing T9-S1 suite):
- Token bound to `role:lead`, request from `role:lead` → 200.
- Token bound to `role:lead`, request `Pluto-Run-Actor: role:generator` (with lead's token) → **403 `actor_mismatch`**.
- Mismatch test must use a SHARED HTTP client across the two requests so we're verifying the server-side check, not a client-side issue.
- Existing happy-path (correct token + correct actor header) tests must still pass.

`packages/pluto-v2-runtime/__tests__/adapters/paseo/run-paseo.test.ts`
(or wherever run-paseo's setup is tested):
- Two-actor run produces two distinct tokens.
- Each actor's `handoff.json` has the correct bound token.
- Token registry contains entries for ALL declared actors,
  including those that never mutate.

`packages/pluto-v2-runtime/__tests__/adapters/paseo/actor-bridge.test.ts`:
- The existing subprocess test (T6-S1 regression) still passes
  with per-actor tokens.

## Scope (out — DO NOT touch)

- `packages/pluto-v2-core/**` (closed kernel — byte-immutable).
- `packages/pluto-v2-runtime/src/tools/**` (kernel-adjacent).
- `packages/pluto-v2-runtime/src/mcp/**`.
- `packages/pluto-v2-runtime/src/evidence/**`.
- T9-S2 surface (`run-paseo.ts` turn-state machine, `wait-registry.ts`, etc.) — only consume; the existing T9-S2 mutation lifecycle stays unchanged.
- T9-S3 surface (`composite-tools.ts`, etc.) — only consume; the new composite verbs use the same actor enforcement as primitive routes.
- T9-S4 surface (tsconfigs, build scripts) — leave alone.
- `tests/fixtures/live-smoke/**`.

## Diff hygiene allowlist

`git diff --name-only main..HEAD` must be a subset of:

- `packages/pluto-v2-runtime/src/adapters/paseo/run-paseo.ts`
- `packages/pluto-v2-runtime/src/adapters/paseo/actor-bridge.ts`
- `packages/pluto-v2-runtime/src/api/pluto-local-api.ts`
- `packages/pluto-v2-runtime/src/cli/pluto-tool.ts` (only if absolutely needed; ≤10 lines)
- `packages/pluto-v2-runtime/__tests__/api/pluto-local-api.actor.test.ts`
- `packages/pluto-v2-runtime/__tests__/adapters/paseo/run-paseo.test.ts` (new file possibly)
- `packages/pluto-v2-runtime/__tests__/adapters/paseo/actor-bridge.test.ts`
- `tasks/remote/pluto-v2-t9-s1b-token-actor-binding-20260509/**`

## Gates (use the T9-S4 fast-path)

```bash
pnpm install
pnpm --filter @pluto/v2-runtime typecheck:src    # T9-S4 fast path
pnpm --filter @pluto/v2-runtime typecheck:test   # T9-S4 split test program
pnpm exec tsc -p tsconfig.json --noEmit          # root typecheck
pnpm --filter @pluto/v2-runtime test             # baseline 242/244 (S3) — must stay or improve
pnpm test                                         # 37/37
```

`commands.sh` for this slice already wires these via the
existing gate functions. **OOM discipline (from T9-S4)**: if a
typecheck step exits 137 or 134 (Killed / heap fatal), record
once, do NOT retry with `--max-old-space-size`, do NOT invoke
`./node_modules/.bin/tsc` directly. Continue with other gates;
document the harness limit in REPORT.

## Hard rules

- N2 grep gate: forbid `must match exactly` / `payload must match exactly`.
- Closed v2-core surface byte-immutable.
- Server fail-closed on mismatch (403, NOT 200 + error in body).
- Existing T9-S1/S2/S3 happy paths must not regress.

## Stop conditions

1. Kernel mutation required → STOP.
2. Existing test cascade > 8 files → STOP, narrow scope.
3. Per-actor token issuance breaks the existing handoff.json
   contract in a way that cascades to > 3 predecessor source
   files → STOP. Document the cascade in REPORT.

## REPORT.md required structure

The REPORT must include (at minimum) these sections — even if
short:

```markdown
# T9-S1b Report

## Summary
<1-3 paragraphs of what shipped>

## What changed
<file-by-file>

## Decisions made
- **Config shape (Map vs function)**: chose <A|B> because <reason>
- **Error response shape**: chose <reason>
- ... (each non-obvious choice with rationale)

## Approaches considered and rejected
- ... (each: what you tried, what evidence made you reject it,
  what you shipped instead)

## Stop conditions hit
- ... (numbered stop condition or "none"; with evidence if
  hit)

## Gates
<artifact-by-artifact>

## Verdict
<verdict block>
```

This is mandated by the iteration's process — future fixup
rounds rely on the REPORT to avoid re-asking for already-rejected
work.

## Verdict format

```
T9-S1b COMPLETE
config-shape: <Map|Function>
mismatch-status: 403
mismatch-error-code: actor_mismatch
all-actors-tracked-at-start: yes
new tests: <N>
typecheck-new-errors: 0
runtime-tests: <pass>/<total>
root-tests: <pass>/<total>
push: ok | failed
stop-condition-hit: <none|1|2|3>
```

Begin.
