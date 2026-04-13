# Run Governance

## Purpose

Define the minimum stable governance rules for run lifecycle, approval classes, and effective policy precedence.

This file exists to freeze the minimum behavioral rules needed before implementation work starts.

## 1. Lifecycle states

Canonical run states for the minimum stable core:

- `queued`
- `initializing`
- `running`
- `blocked`
- `waiting_approval`
- `failing`
- `failed`
- `succeeded`
- `canceled`
- `archived`

Use **`canceled`** as the canonical spelling everywhere in contracts, code, and persistence.

## 2. Allowed run state transitions

Minimum allowed transitions:

- `queued -> initializing`
- `initializing -> running`
- `running -> blocked`
- `running -> waiting_approval`
- `running -> failing`
- `running -> failed`
- `running -> succeeded`
- `running -> canceled`
- `blocked -> running`
- `blocked -> failed`
- `blocked -> canceled`
- `waiting_approval -> running`
- `waiting_approval -> failed`
- `waiting_approval -> canceled`
- `failing -> running`
- `failing -> failed`
- `failed -> archived`
- `succeeded -> archived`
- `canceled -> archived`

Transitions outside this set should be rejected unless a later spec expands the lifecycle.

## 3. Terminal states

Terminal states are:

- `failed`
- `succeeded`
- `canceled`
- `archived`

`archived` is a post-completion administrative state, not a live execution state.

## 4. Approval action classes

Phase 1 canonical approval action classes:

- `destructive_write`
- `external_publish`
- `sensitive_mcp_access`
- `pr_creation`
- `production_change`

These classes should be usable in harness approval policy, policy snapshots, approval objects, and operator views.

## 5. Effective policy precedence

For the minimum stable core, effective policy should be resolved in this order:

1. repository or platform hard safety rules
2. org or project policy overlays, if enabled
3. harness defaults
4. run-specific resolved context

Playbook does **not** override governance policy.

## 6. Policy snapshot rule

Each run should retain a durable snapshot, or an equivalent durable record, of the effective policy boundary applied to it.

That durable policy record must be enough to explain:

- which approval classes were active
- which timeout rules were active
- which required evidence or artifact rules were active

## 7. Event and projection rule

For the minimum stable core:

- the append-only run event log is the durable execution history
- current run state may be stored as a materialized record or projection in Postgres
- operator views may read projections, but recovery and audit must remain explainable from events and governed records

## 8. Minimum implementation consequence

Before building beyond the scaffold/domain layer, the implementation must be able to answer:

- what state transitions are allowed
- what approval class triggered a waiting state
- what governed policy applied to the run
- how current state relates to durable history
