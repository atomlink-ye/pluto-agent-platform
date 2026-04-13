# System Architecture

## Purpose

This document records the core architecture decisions behind the repository and the intended implementation shape.

## Decision summary

The project will be implemented as a **TypeScript, Postgres-backed platform built on a forked Paseo kernel**.

That means:

- keep Paseo's runtime and interaction substrate as the execution kernel
- build product semantics on top of that kernel
- keep durable business truth in Postgres
- avoid a dual-system architecture where the product and runtime disagree about state

## Why fork Paseo

Paseo already validates several hard problems that this repository should not rebuild first:

- agent runtime lifecycle
- provider integration
- worktree and execution isolation primitives
- timeline and live interaction surfaces
- terminal and session substrate
- multi-surface client shell

The value of this project is not reimplementing those foundations. The value is productizing governed execution around them.

## Architectural intent

The target platform should become a control plane for coding-agent teams where:

- Playbooks describe reusable task intent
- Harnesses describe governed execution rules
- Runs provide durable, observable execution instances
- approvals, artifacts, and replay are first-class product surfaces

## Why Postgres

This repository adopts **Postgres** for durable product state.

Reasons:

- strong fit for durable relational business objects
- clear transactional boundaries for runs, approvals, and artifacts
- better support for explicit constraints and indexed reporting views
- good fit for eventual projections and audit-friendly state history

This is a local repository decision and should be treated as authoritative for this codebase even if earlier reference material explored other options.

## Durable storage boundary

### Postgres owns durable business state

Postgres is the authority for:

- Playbook records
- Harness records
- Run records
- Run Plan projections
- Run Event metadata
- Approval tasks
- Artifact metadata
- Role and Team definitions
- audit-oriented records

### Runtime-local files remain non-authoritative for business state

Paseo-style runtime-local storage may still hold:

- provider session state
- terminal scrollback
- workspace execution traces
- artifact payload files
- transient caches

### Invariant

The same concept must not be authoritative in both Postgres and runtime-local files.

## Event history and projection model

The repository uses an **append-only event history plus durable projections** approach for governed execution.

- Run events are the durable execution history
- run records, run summaries, run plans, approval state, and artifact state are stored in Postgres as current-state records or projections
- runtime-local state may assist execution, but it must not replace either durable history or durable product state

This keeps the system event-aware and recovery-friendly without forcing the entire implementation to expose only raw events.

## Target module shape

The repository should evolve toward a small, coherent monorepo rather than an explosion of shallow packages.

Illustrative direction:

```text
packages/
├── server/         # forked Paseo server and runtime integration surface
├── app/            # operator-facing UI
├── cli/            # inherited or adapted CLI
├── contracts/      # schemas and shared contracts
└── control-plane/  # run lifecycle, approvals, artifacts, projections
```

This shape should stay flexible, but the responsibility split should remain stable.

## Durable execution authority

The system should enforce run governance on the server side.

- the product layer creates and governs runs
- harness rules are evaluated against durable product state
- runtime sessions carry out work but do not replace governed execution authority
- Paseo skills can inform strategies or defaults, but they are not the durable engine of record

## Integration boundary

The product layer should consume and govern runtime activity rather than disappear into runtime implementation detail.

Preferred direction:

1. create and govern runs in the product layer
2. map governed execution to runtime sessions
3. project runtime activity back into durable run events
4. update approvals, artifacts, and summaries in product-layer state

Important rule:

The product layer should not devolve into a thin projection of raw runtime state. It must remain the authority for run lifecycle, governance, and operator-facing truth.

## Tenancy stance for Phase 1

Phase 1 should be conservative.

- design identifiers and records so tenancy can be introduced later without rewriting every table
- keep the minimum stable core effectively single-tenant unless an active plan expands that scope
- avoid claiming full tenancy support before explicit product and security specs exist

## Phase 1 non-goals

- full BPM-style graph authoring
- deep enterprise admin and RBAC
- broad surface parity before the operator core works
- advanced analytics before durable run visibility exists
