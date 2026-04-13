# 002 — Minimum Stable Core

## Purpose

Define the first implementation slice that is large enough to validate the product model but small enough to stay governable.

## Scope

Phase 1 should deliver:

- Playbook records and listing
- Harness attachment and summary
- Run creation and lifecycle state
- EnvironmentSpec and RunSession boundaries sufficient for recovery and operator visibility
- effective policy snapshot or equivalent governed policy record
- Run list and run detail views
- durable approvals
- durable artifact registration
- Postgres-backed durable product state

## Non-goals

- broad enterprise administration
- full graph authoring
- advanced analytics
- wide surface parity

## Suggested implementation order

1. contracts and core domain model
2. Postgres-backed durable records
3. run lifecycle, EnvironmentSpec, RunSession, and policy snapshot records
4. approval / artifact linkage and runtime projection boundary
5. operator-facing playbook and run views

## Evaluation gates

- a run can be created from a playbook
- run status and phase are durable and visible
- environment and session linkage are visible enough to support recovery reasoning
- effective policy for a run can be explained
- approval can pause and resume governed execution
- artifacts are durably registered
- operator can distinguish active, blocked, waiting-approval, and terminal runs

## Completion criteria

- the minimum reference scenario in product scope can be demonstrated end to end
- authoritative docs remain consistent with the implementation slice
