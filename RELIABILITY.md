# RELIABILITY.md

## Purpose

This document defines reliability expectations for the platform.

## Reliability goals

The system should be:

- recoverable
- observable
- governable
- resumable

## Core reliability requirements

## Current implementation status

### Startup recovery

The startup recovery sweep is **implemented and active**. `RecoveryService.recover()` runs once during server startup and performs a full scan of all non-terminal runs.

The recovery process for each non-terminal run (`recoverRun()`):

1. Skips runs that are already terminal (`failed`, `succeeded`, `canceled`, `archived`)
2. Reconstructs current state from the event log via `projectRunStateFromEvents()`
3. Returns `waiting_approval` immediately for runs in that state (no agent rebinding needed)
4. Checks for an active `RunSession` — if none exists, blocks the run
5. If the runtime agent still exists, re-tracks and re-binds it
6. If the agent is gone but a persistence handle exists, attempts session resurrection via `resumeFrom`
7. If no recovery path exists, blocks the run with an operator-visible reason

### Recovery operation outcomes

Each `recoverRun()` call returns one of four outcomes:

| Outcome | Meaning |
|---|---|
| `recovered` | Agent successfully re-bound or resurrected via persistence handle |
| `blocked` | No active session, agent gone with no persistence handle, or resurrection failed |
| `waiting_approval` | Run was in `waiting_approval` state — no agent needed |
| `skipped` | Run does not exist or is already terminal |

The aggregate `RecoveryResult` groups run IDs by these outcomes.

### Resumability and interruption visibility — current gaps

- **Run-level recovery** works as described above: the system can re-bind surviving agents or resurrect sessions from persistence handles
- **Session-level interruption tracking** is not yet implemented: `RunSession.status` only records `active` and `failed` — there is no `interrupted`, `resumed`, or `closed` status in production code today (see known debt in `run-contract.md`)
- **Operator-visible interruption history** is partially available: recovery events are logged, and blocked runs include a `blockerReason`, but there is no dedicated interruption timeline or session-level state history

### 1. Runs must remain operator-legible

At minimum, the system should make it clear:

- current run status
- current phase
- blocker reason
- pending approvals
- produced artifacts

### 2. Durable state must survive runtime interruption

If a runtime session ends unexpectedly, the platform should still preserve enough durable state to explain what happened and what remains actionable.

### 3. Recovery must be explicit

Recovery behavior should not be magical. A resumed run should have:

- visible prior status
- visible interruption history when relevant
- a clear next actionable state

### 3.1 Minimum resume contract

For the minimum stable core, recovery behavior should preserve or reconstruct enough state to answer:

- what run was active
- what phase it had reached
- whether an approval was pending
- which artifacts had already been registered
- whether a runtime session linkage existed and whether it is resumable or terminal

### 4. Artifact and approval handling must be durable

An approval request or artifact registration must not disappear because a client view reloads or a runtime process restarts.

## Minimum V1 reliability bar

- run summary can be reconstructed from durable state
- blocked and waiting-approval states are visible
- artifact metadata is durable
- operator can see whether a run is resumable or terminal
- interrupt and resume semantics are explicit enough to evaluate

The startup recovery sweep meets the first four items. The fifth item — interrupt and resume semantics — is partially met at the run level (recovery can re-bind or resurrect agents) but remains a gap at the session level (no `interrupted`/`resumed` session status tracking).

## Reliability anti-patterns

- relying on transient runtime memory as the only truth
- hiding failure reasons in low-level logs only
- treating approvals as ephemeral UI prompts
- producing artifacts without durable registration
