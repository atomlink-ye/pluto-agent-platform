# Plan: Runtime helper Paseo live hello-team

> **Status (2026-05-07):** this plan targets the v1.6 runtime helper / mailbox lineage,
> which is now frozen as legacy. New work is governed by
> [`docs/plans/active/v2-rewrite.md`](v2-rewrite.md). Pending follow-ups in this plan are
> preserved for reference but should not be acted on against `main` until the v2
> acceptance gates land. The v1.6 snapshot at freeze time lives on
> `origin/legacy-v1.6-harness-prototype`.

## Status

Status: Active, partial feature proof complete; follow-up required.

## Goal

Prove a minimal helper-authored mailbox flow on top of a real Paseo live run, then tighten helper stability so the path can be trusted as the nucleus of a real local Pluto mailbox runtime.

## What has been proven

- A minimal helper-authored mailbox happy path works in fake mode and can be observed from runtime artifacts.
- A real Paseo live run was completed in the target workspace using helper-authored mailbox messages for the core chain.
- Helper-authored actions are visible in dedicated usage logs, mailbox mirrors, and event logs.

## Confirmed successful live proof

Target workspace:

- `/Volumes/AgentsWorkspace/tmp/pluto-symphony-custom-test/symphony`

Successful real live run:

- run id: `267a8637-8868-435b-b7cb-c3289d0a6ce8`
- data dir: `.pluto-runtime-helper-live`

Observed live Paseo session ids:

- lead: `c79be3d1-bb2e-4ac1-8189-c4541f5ba705`
- planner: `e19a8816-cad2-43f7-a159-3050dc8995fc`
- generator: `82bcb304-2cdd-496b-ba8a-18e7bfd79d0b`
- evaluator: `ef73d9bc-3464-4666-a43c-d89aee147c67`

Evidence files from the successful run:

- `runtime-helper-usage.jsonl`
- `mailbox.jsonl`
- `events.jsonl`
- `workspace-materialization.json`

## Confirmed problems / blockers

### 1. Helper interface shape is wrong

The current MVP materializes role-bound wrapper commands under paths like:

- `./.pluto-runtime/roles/lead/pluto-mailbox`
- `./.pluto-runtime/roles/planner/pluto-mailbox`

This is now considered the wrong interface.

Desired direction:

- one shared canonical CLI path, e.g. `./.pluto-runtime/pluto-mailbox`
- role/run/context resolved inside the CLI, not encoded in the executable path
- role-bound paths may exist only as temporary compatibility shims if needed

### 2. Helper stability bug: false timeout on `spawn`

User-observed issue:

```bash
./.pluto-runtime/roles/lead/pluto-mailbox spawn --task task-1 --role planner --rationale "Planners produce implementation plans"

runtime_helper_timeout:spawn
```

Even when the spawn appears to have actually happened, the helper may still return a timeout. This is a priority correctness bug in helper request/response acknowledgment.

### 3. `wait` behavior and notification model are not finished

The original helper flow overused:

- `sleep`
- repeated `tasks` polling

The intended next step is:

- a real helper `wait` command/path
- mixed strategy: if the target role is known to be waiting, satisfy the wait directly; otherwise fall back to a direct session send path

### 4. Lead receives too much noisy Pluto traffic

After messages are already semantically handled, the lead can still receive late or redundant runtime traffic, especially around busy periods and finalization. This needs suppression/cleanup.

### 5. Workspace-level helper context drift

Root cause identified in failed follow-up live runs:

- workspace-level `.pluto-runtime` context drifts across runs
- backing data-dir paths and current run ids can mismatch
- multiple live runs in the same workspace can conflict

Observed failed/conflicting runs include:

- `4e70eee1-203d-4381-8a17-5fc140c805f6` — helper context drift / pending downstream tasks
- `ed71eb23-715d-47ca-a51c-dbcc82f8725a` — lead confused by incomplete/incorrect runtime state

### 6. Live run concurrency in the same workspace is unsafe

At one point there were multiple concurrent live Paseo agents bound to the same target workspace, including multiple leads and planners from different runs. This contaminates:

- `.pluto-runtime`
- mailbox/task evidence
- workspace artifact state

Any future live verification must serialize runs or create a fresh isolated directory per run.

## Attempted optimization work and current stop point

Several OpenCode Companion jobs were used to explore helper stabilization, including:

- `task-444184-e1254c`
- `task-931d33-83f7c4`
- `task-72a29e-a76ab1`
- `task-ef7f6a-ab826f`

These threads were stopped after drifting into the wrong interface or into inefficient exploration/testing loops.

## Current recommended next step for the successor manager

Do **not** continue patching the role-bound helper design.

Instead, restart from this narrowed target:

1. replace the role-specific helper entrypoint with a single canonical CLI path;
2. resolve role/run/context internally;
3. fix false timeout on `spawn` acknowledgment;
4. make helper state run-isolated or force-safe refreshed per run;
5. only then re-run one real live hello-team path in a fresh isolated test directory.

## Guardrails for the successor manager

- keep scope extremely narrow
- do not broaden into unrelated runtime redesign
- bound every test/run to 600s max
- inspect `paseo ls` before any live rerun and ensure exactly one active lineage in the target workspace or use a fresh isolated directory
- use actual spawned session ids + `paseo logs` for debugging, not only artifact files

## Key evidence references for handoff

- successful live run artifacts:
  - `/Volumes/AgentsWorkspace/tmp/pluto-symphony-custom-test/symphony/.pluto-runtime-helper-live/runs/267a8637-8868-435b-b7cb-c3289d0a6ce8/`
- successful fake helper proof artifacts:
  - `.tmp/runtime-helper-verify-data/runs/runtime-helper-verify/`
- problematic lead session to inspect:
  - `376e4ba1-1be6-4d86-9111-341fed3e112c`

## Completion condition for this plan

This plan should remain active until all of the following are true:

- unified helper CLI exists and is the canonical interface
- `spawn` no longer returns false timeouts after successful processing
- helper `wait` exists and is used in the live happy path
- lead noise after semantic handling/finalize is materially reduced
- a real live hello-team run succeeds in a fresh isolated test directory with no workspace-context drift
