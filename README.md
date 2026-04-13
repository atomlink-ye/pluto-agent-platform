# Pluto Agent Platform

Pluto Agent Platform is a TypeScript, Postgres-backed rewrite direction for a workflow-oriented agent operations platform built on top of a forked Paseo kernel.

## What this repository is trying to become

This project is not a traditional chat-first agent shell and not a static workflow-graph engine.

It is intended to become a control plane for coding-agent teams where:

- **Playbook** defines task intent
- **Harness** defines platform-enforced execution rules
- **Run** is the durable, observable execution object

The product remains workflow-oriented in the sense of **workflow-oriented UX and operations**, where users work around reusable task definitions and visible runs rather than isolated chat sessions. The core model intentionally weakens the idea of a rigid workflow graph and replaces it with **playbook + harness + run**.

## Strategic direction

- **Language:** TypeScript
- **Durable business state:** Postgres
- **Runtime and UI kernel:** forked Paseo
- **Product layer:** run lifecycle, approvals, artifacts, orchestration semantics, operator-facing UX
- **Delivery method:** EDD-first, with documents treated as part of the product surface

## Documentation entry points

Read in this order:

1. [CLAUDE.md](./CLAUDE.md) (with `AGENTS.md` pointing to the same guide)
2. [ARCHITECTURE.md](./ARCHITECTURE.md)
3. One top-level topic document as needed
4. The matching source of truth under `docs/`

## Documentation map

- [`docs/design-docs/`](./docs/design-docs/index.md) — design decisions and architectural reasoning
- [`docs/contracts/`](./docs/contracts/index.md) — canonical field-level contracts for core objects
- [`docs/product-specs/`](./docs/product-specs/index.md) — product behavior, domain objects, user-visible rules
- [`docs/exec-plans/`](./docs/exec-plans/testing-and-evaluation-strategy.md) — execution plans, EDD workflow, active implementation plans
- [`docs/references/`](./docs/references/index.md) — reference summaries and source mapping from redesign inputs

## Current repository state

This repository currently prioritizes documentation normalization before code implementation. The immediate goal is to freeze terminology, scope, architectural boundaries, and the minimum stable core before building the actual monorepo.

## Core principles

- Prefer **playbook / harness / run** over rigid workflow graphs
- Keep **design → spec → plan** boundaries clean
- Use **EDD** for every iteration
- Treat documentation consistency as a delivery requirement
- Keep durable truth in **Postgres**, not in runtime-local files

## Status

Phase 0: documentation bootstrap and decision freeze.
