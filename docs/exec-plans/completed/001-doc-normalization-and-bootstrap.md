# 001 — Doc Normalization and Bootstrap

## Purpose

Create the repository's authoritative documentation structure and freeze the minimum decision set required before implementation.

## Scope

- create top-level governance docs
- create design, spec, plan, and reference directories
- normalize repository terminology around playbook / harness / run
- freeze TypeScript + Postgres + forked Paseo direction

## Non-goals

- production implementation of runtime or UI features
- broad architectural experimentation after docs are written

## Sequence

1. create repository-level documents
2. create formal docs tree
3. map redesign references into formal authorities
4. freeze minimum stable core scope
5. verify document boundaries are clean

## Evaluation gates

- a new contributor can identify the authority for architecture, specs, and plans quickly
- the old rigid workflow concept is no longer the primary formal model
- TypeScript and Postgres are explicit repository decisions
- the docs tree matches the repository structure rules

## Completion criteria

- all required top-level docs exist
- core docs under `docs/` exist
- reference mapping exists
- terminology is internally consistent
