# ARCHITECTURE.md

## Purpose

This document defines the structural architecture of Pluto Agent Platform: module boundaries, source-of-truth rules, dependency directions, and the main execution flow.

## System intent

Pluto Agent Platform is a **TypeScript, Postgres-backed, workflow-first agent operations platform** built on top of a forked Paseo kernel.

The architecture deliberately avoids treating workflow as a rigid graph product. Here, workflow-first means a **workflow-oriented UX and operational model**, not graph authoring. The primary execution model is:

- **Playbook** — reusable task intent
- **Harness** — deterministic execution governance
- **Run** — durable execution instance

## Architectural stance

### 1. Fork Paseo as the kernel

Paseo provides the runtime and interaction substrate:

- daemon and process management
- provider integration
- worktrees and execution isolation primitives
- timeline and terminal surfaces
- permission and approval-adjacent runtime flows
- existing client shell and operator affordances

This repository adds the product layer on top of that substrate rather than rebuilding those foundations from scratch.

### 2. One language, one primary backend stack

- **Language:** TypeScript
- **Durable business database:** Postgres
- **Runtime-local storage:** Paseo-managed local files and runtime state

## Source-of-truth rules

### Durable business state lives in Postgres

Postgres is the authority for durable product objects such as:

- playbooks
- harnesses
- runs
- run plans and projections
- run events metadata
- approvals
- artifact metadata
- role and team definitions
- audit records

Postgres should also hold the append-only run event log and the materialized records derived from it.

### Runtime-local state remains runtime-local

Paseo-style local runtime storage can hold:

- provider session persistence handles
- terminal scrollback
- workspace-local execution traces
- artifact payload files
- transient runtime caches

### Invariant

The same business concept must not have two authorities.

Examples:

- a run status is authoritative in Postgres, not in a local JSON file
- an artifact payload may exist on disk, but artifact identity and lineage are authoritative in Postgres

### Event and projection authority

For the minimum stable core, the repository adopts this model:

- the **Run Event log** is the authoritative execution history
- **Run**, **Run Plan**, approval state, and artifact state are durable Postgres records or projections derived from governed writes and events
- runtime-local files are never the authority for either history or current product state

## High-level module layout

The target implementation should evolve toward a TypeScript monorepo with a clear split between kernel reuse and product modules.

Illustrative direction:

```text
packages/
├── server/            # forked Paseo daemon and server integration surface
├── app/               # operator-facing UI built on the forked client shell
├── cli/               # inherited or adapted CLI surface
├── contracts/         # shared schemas, DTOs, domain contracts
├── control-plane/     # run lifecycle, approvals, artifacts, projections
└── website/           # optional documentation or site surface later
```

The precise package split can stay small at first. The key rule is architectural separation by responsibility, not package count.

## Execution authority boundary

This repository should behave as a **single-system fork with internal module boundaries**.

- the server-side product layer owns durable execution authority
- the harness is enforced by product-layer state and policies
- runtime sessions execute work but do not become the authority for run truth
- Paseo skills and runtime primitives are reusable strategy material, not the durable workflow engine

## Product-layer domains

### Core execution domain

- Playbook
- Harness
- Run
- Run Plan
- Run Event

### Governance domain

- Approval Task
- Policy checks
- Evidence requirements
- Artifact registration

### Coordination domain

- RoleSpec
- TeamSpec
- handoff records
- coordination mode metadata

### Operator domain

- run summaries
- blocker visibility
- approval queues
- artifact views
- replay and audit surfaces

## Dependency direction

Preferred dependency direction:

```text
UI / operator flows
        ↓
control-plane services
        ↓
domain contracts / schemas
        ↓
runtime integration boundary
        ↓
forked Paseo kernel capabilities
```

Constraints:

- product semantics should not be hidden inside provider-specific runtime code
- UI should consume stable product-layer contracts rather than raw runtime internals where possible
- runtime integration may project events upward, but it should not become the authority for business state

## Main execution flow

```text
Playbook + Harness + Inputs + Team Context
                    ↓
              Run is created
                    ↓
         Initial Run Plan is compiled
                    ↓
     Control plane drives governed execution
                    ↓
Runtime activity is projected into Run Events
                    ↓
Approvals / artifacts / summaries are updated
                    ↓
Run reaches succeeded / failed / canceled / blocked
```

## Workflow language policy

This project may still describe itself as workflow-first at the product level, but the architecture does **not** center on a static workflow graph.

Architecturally:

- playbooks stay intentionally weakly defined
- harnesses impose deterministic boundaries
- runs and events carry actual execution truth

## V1 architectural bias

Phase 1 should stay conservative:

- one primary operator-facing UI surface
- one durable backend model on Postgres
- one minimum stable run lifecycle
- one approval path
- one artifact registration path
- minimal but explicit runtime integration
- a schema that is tenancy-ready even if V1 remains effectively single-tenant

## Non-goals for the minimum stable core

- full BPM-style workflow engine
- broad multi-surface parity from day one
- complex tenancy enforcement before the core run model is stable
- advanced analytics before basic replay, approval, and recovery work reliably
