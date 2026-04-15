# Testing and Evaluation Strategy

## Purpose

This document defines how the repository executes EDD in practice.

## Repository-level rule

This repository uses **evaluation-driven development (EDD)**.

Every iteration must follow:

1. define the evaluation target
2. identify the authoritative docs
3. implement the minimum coherent change
4. verify the change
5. reconcile impacted docs

## Relationship to TDD

TDD is a preferred execution technique inside EDD, especially for domain and orchestration logic.

The repository's broader operating rule is EDD because delivery here includes:

- tests
- operator-visible behavior
- architectural consistency
- documentation consistency

## Testing priorities

The first tests should protect the product model rather than superficial transport or snapshot detail.

Priority order:

1. domain model tests
2. orchestration and run lifecycle tests
3. runtime integration tests
4. backend integration tests
5. UI behavior tests
6. E2E tests

## What must be proven early

- Playbook and Harness stay separated by responsibility
- Run is the true execution object
- Run Plan can be derived without a rigid graph authoring system
- approvals are durable and actionable
- artifacts are durably registered
- blocked and waiting-approval states are visible

## Iteration checklist

Each non-trivial iteration should answer:

- What is the evaluation target?
- Which document is authoritative?
- What is the minimum change?
- How will failure be visible?
- What documents must be updated afterward?

## Documentation consistency as a quality gate

An iteration is not complete if:

- architecture changed but `ARCHITECTURE.md` did not
- product behavior changed but product specs did not
- sequencing changed but plans did not
- terminology drifted back to old workflow language without clarification

## Phase 1 recommended evaluation order

### Stage 0: repository bootstrap

- docs tree exists
- top-level governance docs exist
- terminology is frozen
- minimum scope is frozen

### Stage 1: domain model

- playbook behavior
- harness behavior
- run lifecycle
- environment and session linkage boundaries
- approvals and artifacts

### Stage 2: integration

- Postgres-backed durable state
- runtime event projection into run-level records
- approval and artifact linkage
- policy snapshot application
- interrupt and resume reconstruction

### Stage 3: operator surface

- playbook launch flow
- run list and run detail visibility
- approval resolution flow
- artifact visibility

## Concrete minimum evaluation cases

Phase 1 should include explicit evaluation coverage for:

- Playbook must not absorb Harness responsibilities
- Harness must not absorb task semantics
- Run can be created from Playbook + Harness + input context
- RunSession linkage is visible without making runtime state authoritative
- effective policy can be explained for a run
- interruption and resume behavior can be evaluated from durable state and events
- operator views distinguish waiting approval, blocked, failed, and succeeded states

## Minimum stage gates

### Stage 0 completion gate

- top-level governance docs exist
- `docs/` taxonomy exists
- terminology is internally consistent

### Stage 1 completion gate

- Playbook, Harness, Run, EnvironmentSpec, RunSession, and Policy Snapshot boundaries are specified and testable
- the system can explain why each object exists and what it must not absorb

### Stage 2 completion gate

- durable run records persist in Postgres
- runtime linkage is projected into RunSession records or equivalent
- policy application is visible through a durable snapshot or equivalent governed record
- interrupt and resume behavior can be reconstructed from durable state

### Stage 3 completion gate

- an operator can launch a run from a playbook
- the run detail view exposes phase, blocker, approvals, artifacts, and recovery-relevant state
- approval handling and terminal outcomes remain operator-legible

## Beta Gate

The beta gate is the minimum CI quality bar for M2 milestone work.

Required lane:

- build must pass
- typecheck must pass
- test must pass
- CI must be green

Excluded from the required lane:

- Docker integration tests
- live-agent E2E tests
- UI E2E tests

These remain separate optional lanes and do not block the beta gate.

The beta gate is enforced on pull requests, not only on merged commits.

This aligns with EDD by making CI green necessary but not sufficient. Documentation consistency remains a stated gate criterion and is still checked manually under the repository's EDD rules.

Database integration tests skip when `DATABASE_URL` is absent so CI can stay green without requiring a Postgres service container.

## Success bar

The repository is progressing correctly only if implementation quality and documentation quality rise together.
