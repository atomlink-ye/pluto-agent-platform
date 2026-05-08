# ARCHITECTURE.md — Pluto v2 Mainline

Pluto `main` is a v2 CLI plus package runtime stack.

## Active Modules

| Module | Responsibility |
| --- | --- |
| `src/cli/run.ts` | root CLI entrypoint and argument validation |
| `src/cli/v2-cli-bridge.ts` | bridge from root CLI into `@pluto/v2-runtime` |
| `packages/pluto-v2-core/` | authored spec schema, pure core, projections, replay |
| `packages/pluto-v2-runtime/` | spec loading, fake runtime, paseo runtime, evidence packet assembly |
| `packages/pluto-v2-runtime/scripts/smoke-live.ts` | retained live smoke harness |

## Control Flow

```text
pnpm pluto:run --spec <path>
  -> parse CLI flags in src/cli/run.ts
  -> load authored spec through the v2 bridge
  -> run the scenario through @pluto/v2-runtime
  -> write evidence packet and transcripts
  -> print the v2 bridge result envelope
```

## Runtime Boundary

- The root CLI owns process entry, exit code, and bridge-level error classification.
- `@pluto/v2-core` stays pure and provider-agnostic.
- `@pluto/v2-runtime` owns loading, adapters, execution, and evidence assembly.
- Paseo CLI details stay inside the v2 runtime adapter boundary.

## Archived Surface

The former v1.6 manager-run harness and related mainline runtime trees no longer define `main`.
They survive only on `origin/legacy-v1.6-harness-prototype`. See `docs/design-docs/v1-archive.md`.
