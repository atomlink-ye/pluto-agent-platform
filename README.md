# Pluto Agent Platform

Pluto Agent Platform is a TypeScript control plane for coding-agent teams. It treats agent execution as governed, durable runs instead of isolated chat sessions.

The core model is:

- **Playbook** — reusable task intent
- **Harness** — platform-enforced execution governance
- **Run** — the durable, operator-visible execution instance

## Quick start

The easiest out-of-box way to try the project is the seeded demo stack:

```bash
docker compose up --build pluto-demo
```

Then open:

- App UI: http://localhost:3000
- API health: http://localhost:4000/api/health

This path does **not** require provider auth. It starts the operator UI and the seeded demo API backend in fake runtime mode.

The demo image bundles the workspace and installs dependencies inside the image, so you do not need a local Node or pnpm setup just to try the project.

## What you get in the demo

The demo bootstraps sample data so open source users can explore the product immediately:

- playbooks
- harnesses
- runs in multiple lifecycle states
- approvals
- artifacts
- a supervisor-led team run with session and handoff examples

## Docker modes

### Out-of-box demo

Recommended onboarding path: use the quick-start command above.

### Live provider-backed Docker E2E

The live E2E stack uses tracked repo-owned Docker assets under:

- `docker/pluto-runtime/`
- `docker/pluto-platform/`

It still requires local provider auth mounted through `docker-compose.runtime.override.yml`.

Host prerequisites:

- `${HOME}/.local/share/opencode/auth.json`
- `${HOME}/.codex`

Run it with:

```bash
docker compose -f docker-compose.e2e-live.yml -f docker-compose.runtime.override.yml up --build --abort-on-container-exit --exit-code-from pluto-platform-e2e-live
```

## Current repository shape

- **Language:** TypeScript
- **Durable business state:** Postgres
- **Runtime and UI kernel:** forked Paseo
- **Product layer:** run lifecycle, approvals, artifacts, orchestration semantics, operator-facing UX
- **Delivery method:** EDD-first, with docs treated as part of the product

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

## Core principles

- Prefer **playbook / harness / run** over rigid workflow graphs
- Keep **design → spec → plan** boundaries clean
- Use **EDD** for every iteration
- Treat documentation consistency as a delivery requirement
- Keep durable truth in **Postgres**, not in runtime-local files
