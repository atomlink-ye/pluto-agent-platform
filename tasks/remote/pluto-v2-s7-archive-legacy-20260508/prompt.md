# Role

You are the **remote implementation root manager** for the Pluto
v2 S7 (Archive legacy mainline runtime — final slice). You run
inside a Daytona sandbox. Orchestrate via OpenCode Companion
leaves; do NOT do large patches in your own context.

You are OpenCode `openai/gpt-5.4`, mode `orchestrator`, thinking
`high`.

# Task

Implement S7: aggressive deletion of v1.6 mainline runtime from
`main`. After S7 ships, `main` is fully v2. v1.6 stays ONLY on
the reference branch `legacy-v1.6-harness-prototype` (already on
origin; DO NOT mutate or delete).

Post-S7, `pnpm pluto:run --spec <path>` is the ONLY supported
invocation. `--runtime=v1`, `--scenario`, `--playbook`,
`--run-profile`, and `PLUTO_RUNTIME=v1` ALL exit 1 with an
archived-message stderr referencing the legacy branch.

The plan section "S7 — Phase 7: Archive legacy mainline runtime
code (final slice)" in `docs/plans/active/v2-rewrite.md` (HEAD on
`main` `3a931fd`) is canonical. Plan wins on conflict.

# Source of truth (priority)

1. `docs/plans/active/v2-rewrite.md` — S7 section.
2. `tasks/remote/pluto-v2-s7-archive-legacy-20260508/HANDOFF.md`.
3. `tasks/remote/pluto-v2-s7-archive-legacy-20260508/acceptance.md` —
   binding tables A–F + 9 gates.
4. `src/cli/run.ts` — current v1+v2 router (surgery target).
5. `src/cli/v2-cli-bridge.ts` / `v2-cli-bridge-error.ts` —
   READ-ONLY S6 output (do not modify unless v1-removal surgery
   forces a bounded mechanical edit).
6. `packages/pluto-v2-runtime/src/index.ts` (READ-ONLY) — exports
   `loadAuthoredSpec`, `runPaseo`, `makePaseoCliClient`,
   `makePaseoAdapter`, types.

# Hard rules

- **NO mutation under `packages/pluto-v2-core/**` or
  `packages/pluto-v2-runtime/**`.** Acceptance gate 5 enforces.
- **NO mutation of `tests/fixtures/live-smoke/86557df1-...`.**
  Acceptance gate 6 enforces.
- **NO push / mutation of `legacy-v1.6-harness-prototype`** on
  origin. Pre-flight + post-merge SHA capture is a HARD gate.
- **`pluto:run --spec <path>` is the ONLY supported invocation
  post-S7.** All v1 paths emit the archived-message stderr (single
  line, verbatim):

  ```
  v1.6 runtime was archived in S7. Reference copy lives on the legacy-v1.6-harness-prototype branch. v2 takes pluto:run --spec <path> only.
  ```

- **Lane 0 inventory artifact** at
  `tasks/remote/pluto-v2-s7-archive-legacy-20260508/artifacts/v1.6-inventory.md`
  MUST exist BEFORE any deletion lands. Mechanism:
  `tsc --listFiles -p tsconfig.json` filtered to `src/`,
  `tests/`, `docker/`, `scripts/`; cross-checked against
  `package.json` scripts and Vitest include patterns.
- **NO live-smoke gate in S7.** S5 captured the binding fixture.
- **NO new v2 features.** v2 stays at S6 baseline.
- All concrete coding work delegated to OpenCode Companion leaves
  on `127.0.0.1:44231`. Spawn each leaf with `--background --agent
  orchestrator --timeout 30 --model openai/gpt-5.4`.
- Worktree:
  `/workspace/.worktrees/pluto-v2-s7-archive-legacy-20260508/integration/`.
- Branch: `pluto/v2/s7-archive-legacy-c8ef58`.
- `commit_and_push` BINDING from S2 carries forward.
- R7 / R8: ≤ 20 min per test invocation.
- **Plan-file move** (`docs/plans/active/v2-rewrite.md` →
  `completed/`) is DEFERRED to post-merge by the local manager —
  do NOT move it in this slice.

# Execution plan

## Step 1 — Verify environment

- `git -C /workspace status` clean.
- node ≥ 22, pnpm 9.12.3.
- OpenCode Companion serve healthy at `127.0.0.1:44231`.
- Read S7 section + HANDOFF.md + acceptance.md tables A–F end-to-
  end.

## Step 2 — Workspace setup + pre-flight branch sanity

```bash
bash /workspace/tasks/remote/pluto-v2-s7-archive-legacy-20260508/commands.sh setup_repo
bash /workspace/tasks/remote/pluto-v2-s7-archive-legacy-20260508/commands.sh setup_worktrees
bash /workspace/tasks/remote/pluto-v2-s7-archive-legacy-20260508/commands.sh bootstrap
bash /workspace/tasks/remote/pluto-v2-s7-archive-legacy-20260508/commands.sh preflight_legacy_branch
```

`preflight_legacy_branch` MUST capture the legacy branch SHA to
`artifacts/legacy-branch-sha-pre.txt`.

## Step 3 — Lane 0 inventory (BEFORE any deletion)

Run inside the worktree:

```bash
bash /workspace/tasks/remote/pluto-v2-s7-archive-legacy-20260508/commands.sh lane0_inventory
```

This produces
`artifacts/v1.6-inventory.md` listing every file under `src/`,
`tests/`, `scripts/`, `docker/`, `scenarios/`, `playbooks/`,
`run-profiles/`, `agents/`, `evals/` with KEEP / DELETE / REWRITE
label, derived from `tsc --listFiles -p tsconfig.json` filtered +
cross-checked against `package.json` scripts and Vitest include
patterns. The retained-entrypoint set is in HANDOFF.md /
acceptance.md.

Spot-check the inventory for sanity (every file in the binding
deletion list under acceptance.md section C MUST appear with
DELETE; every file in the retained-entrypoint set MUST appear
with KEEP).

## Step 4 — Decompose into 6 lanes

Spawn 6 OpenCode Companion leaves IN SEQUENCE (lane 0 inventory
first; then lane 1 deletion; then lanes 2–5 in parallel where
independent; lane 5 validation runs last).

### Lane 1 — Deletion + package.json script cleanup + scripts/verify.mjs decision

- Delete every entry under acceptance.md section C list (entire
  files / dirs).
- Edit root `package.json`: remove `pluto:run:v1`, `pluto:package`,
  `pluto:runs`, `pluto:submit`; remove or rewrite `smoke:fake` /
  `smoke:live` (rewrite to point at
  `packages/pluto-v2-runtime/scripts/smoke-live.ts` if a v2 smoke
  script is desired; otherwise delete); remove `verify` /
  `verify:*` referencing `scripts/verify.mjs`.
- Decision on `scripts/verify.mjs`: PREFER deletion. If a v2
  verify pipeline is wanted, write a minimal v2-only replacement
  documented in `docs/design-docs/v1-archive.md`.

### Lane 2 — CLI router + flags surgery

- `src/cli/run.ts`: drop `--runtime=v1` handling, drop v1 name-
  selectors (`--scenario`, `--playbook`, `--run-profile`),
  retain `--runtime=v2` (silent deprecation), `--spec` becomes
  the only required flag. v1 selectors / `PLUTO_RUNTIME=v1` →
  exit 1 with the archived-message stderr (verbatim, see acceptance
  table D).
- `src/cli/shared/flags.ts`: remove v1-only handling.
- `src/cli/shared/run-selection.ts`: remove v1-only handling
  (likely full delete since v2 only takes `--spec`; if the file
  has zero remaining consumers after surgery, delete it).
- `src/index.ts` lines 129-139: remove v1 exports; if file becomes
  empty / has no consumer outside `packages/`, delete the entire
  file.

### Lane 3 — Tests (rewrite + new + delete)

- DELETE: every test file in acceptance.md section C list.
- REWRITE: `tests/cli/run-runtime-precedence.test.ts` (strip v1;
  assert `--runtime=v1` and `PLUTO_RUNTIME=v1` both exit 1 with
  archived message).
- REWRITE: `tests/cli/run-unsupported-scenario.test.ts` (drop
  v1+spec mutual-exclusion; replace with archived-message
  assertions for v1.6 name selectors).
- NEW: `tests/cli/run-v1-flag-archived.test.ts` covering
  `pluto:run --runtime=v1`, `--scenario X`, `--playbook Y`,
  `--run-profile Z`, `PLUTO_RUNTIME=v1`. Each MUST exit 1 with
  the archived message containing the literal
  `legacy-v1.6-harness-prototype`.

### Lane 4 — Doc sweep (9 files + 1 new)

Update / rewrite per acceptance.md section F:

- `README.md`, `AGENTS.md`, `ARCHITECTURE.md`, `DESIGN.md`,
  `RELIABILITY.md`, `SECURITY.md`, `docs/mvp-alpha.md`,
  `docs/harness.md`, `docs/testing-and-evals.md`,
  `docs/qa-checklist.md`.
- New: `docs/design-docs/v1-archive.md` (archive decision, legacy
  branch fetch instructions, what is recoverable).

DO NOT move `docs/plans/active/v2-rewrite.md` — local manager
handles this post-merge.

### Lane 5 — Validation gates

```bash
bash tasks/remote/pluto-v2-s7-archive-legacy-20260508/commands.sh gate_typecheck
bash tasks/remote/pluto-v2-s7-archive-legacy-20260508/commands.sh gate_test
bash tasks/remote/pluto-v2-s7-archive-legacy-20260508/commands.sh gate_build
bash tasks/remote/pluto-v2-s7-archive-legacy-20260508/commands.sh gate_no_packages_mutation
bash tasks/remote/pluto-v2-s7-archive-legacy-20260508/commands.sh gate_no_parity_fixture_mutation
bash tasks/remote/pluto-v2-s7-archive-legacy-20260508/commands.sh gate_legacy_branch_post_check
```

All 6 gate scripts MUST be green.

## Step 5 — commit_and_push

```bash
bash tasks/remote/pluto-v2-s7-archive-legacy-20260508/commands.sh commit_and_push \
  "feat(v2): S7 archive legacy v1.6 mainline runtime — final slice"
bash tasks/remote/pluto-v2-s7-archive-legacy-20260508/commands.sh artifact_pack
bash tasks/remote/pluto-v2-s7-archive-legacy-20260508/commands.sh verify_pushed_state
```

`verify_pushed_state` MUST print `OK: pushed state verified`.

If push fails (auth) — STOP and report BLOCKED with local SHA.
Local manager will pull `diff.patch` and apply.

## Step 6 — Remote self-review loop

Spawn an OpenCode Companion review leaf reading `git diff
main..origin/<branch>`. Reviewer checks:

- Lane 0 inventory exists and is exhaustive.
- Every file in acceptance.md section C deletion list IS removed
  on the slice branch.
- Every file in the retained-entrypoint set still exists.
- Every REWRITE file's diff is bounded to documented surgery.
- v2 packages and parity fixture UNTOUCHED.
- Legacy branch SHA matches between pre- and post-files.
- All 9 doc files updated; `v1-archive.md` exists.
- New `run-v1-flag-archived.test.ts` covers all 5 archived-message
  paths with the literal `legacy-v1.6-harness-prototype` in
  stderr.

Iterate until OBJECTIONS: none, OR return PARTIAL/BLOCKED.

## Step 7 — Final report

Write
`tasks/remote/pluto-v2-s7-archive-legacy-20260508/artifacts/REPORT.md`
matching the schema in HANDOFF.md (sandbox / commit+push state /
pre-flight & post-merge legacy-branch SHA / lane 0 inventory
counts / scope per deliverable / closure proofs / grep results /
files changed / validation gate output paths / remote review loop
summary / known issues).

# Stop conditions

- `legacy-v1.6-harness-prototype` branch missing from origin —
  BLOCKED.
- Lane 0 inventory cannot be produced (e.g. `tsc --listFiles`
  fails) — BLOCKED.
- A v1.6 file in the binding deletion list turns out to be
  imported by a retained v2 entrypoint (lane 0 catches this) —
  BLOCKED, surface to local manager for binding-list revision.
- v2 package code or parity fixture would need to change to make
  gates green — BLOCKED.
- Push fails (auth) — BLOCKED with local SHA.
- Sandbox unhealthy — BLOCKED.
