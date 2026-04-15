# Pluto Agent Platform

Pluto Agent Platform is a TypeScript control plane for coding-agent teams. It treats agent execution as governed, durable runs instead of isolated chat sessions.

The core model is:

- **Playbook** — reusable task intent
- **Harness** — platform-enforced execution governance
- **Run** — the durable, operator-visible execution instance

## Quick start

The default one-command Docker startup now uses the real OpenCode runtime with the repo-owned MiniMax free-model config.

```bash
pnpm docker:live
```

Then open:

- App UI: http://localhost:3000
- API health: http://localhost:4000/api/health

This live path requires local OpenCode auth mounted into the runtime container via `docker/compose.auth.local.yml`:

- `${HOME}/.local/share/opencode/auth.json`
- `${HOME}/.codex`

It starts:

- the operator UI
- the live API backend in `PASEO_MODE=live`
- Postgres for durable run state
- the tracked Pluto OpenCode runtime container with the default model set to `opencode/minimax-m2.5-free`

To exercise a real quick-try task after the stack is healthy, run:

```bash
pnpm docker:live:smoke
```

The smoke task creates a tiny governed run that writes `.tmp/live-quickstart/hello-pluto.sh`, waits for a `run_summary` artifact, and prints the observed sessions + artifacts.
The smoke run now uses the default team-lead + planner + generator + evaluator orchestration path, so the final script contains greetings collected from the whole team instead of a single agent.

## Alternate Docker modes

### Real live quickstart (default)

```bash
pnpm docker:live
```

### Seeded fake-runtime demo

If you want the old authless seeded demo instead of the live runtime path:

```bash
pnpm docker:demo
```

That path still starts the operator UI and a seeded fake-runtime API backend for exploration without provider auth.

### Live provider-backed Docker E2E

The live E2E stack uses tracked repo-owned Docker assets under:

- `docker/pluto-runtime/`
- `docker/pluto-platform/`

It still requires local provider auth mounted through `docker/compose.auth.local.yml`.

Host prerequisites:

- `${HOME}/.local/share/opencode/auth.json`
- `${HOME}/.codex`

Run it with:

```bash
pnpm docker:e2e:live
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
