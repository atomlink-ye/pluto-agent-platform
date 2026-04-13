# Design Docs

This directory records design decisions, rationale, tradeoffs, and enduring architectural constraints.

Read here when you need to understand **why the system is shaped this way**.

## Documents

- [system-architecture.md](./system-architecture.md) — kernel strategy, TypeScript + Postgres direction, durable boundaries, target module shape
- [execution-model.md](./execution-model.md) — playbook / harness / run model and why workflow is intentionally weakened
- [operator-experience.md](./operator-experience.md) — product-facing information architecture and operator experience principles

For product behavior, go to [`docs/product-specs/`](../product-specs/index.md).
For implementation sequencing, go to [`docs/exec-plans/`](../exec-plans/testing-and-evaluation-strategy.md).
