# DESIGN.md — Pluto v2 Principles

## Goal

Run a single authored v2 spec through a deterministic, event-shaped runtime and emit inspectable evidence with one supported CLI surface: `pluto:run --spec <path>`.

## Principles

1. Spec-first: one authored spec path is the runtime input.
2. Pure core: contracts, reducers, and projections live in `@pluto/v2-core`.
3. Runtime boundary: loading, adapters, and evidence assembly live in `@pluto/v2-runtime`.
4. Provider isolation: Paseo and model-specific details stay behind the runtime adapter.
5. Evidence-first output: runs must leave an evidence packet plus actor transcripts.
6. Archive, not dual-mainline: v1.6 remains recoverable on the legacy branch, not on `main`.

## References

- `docs/design-docs/v2-core.md`
- `docs/design-docs/v2-contracts.md`
- `docs/design-docs/v2-projections.md`
- `docs/design-docs/v2-paseo-adapter.md`
- `docs/design-docs/v1-archive.md`
