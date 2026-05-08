# docs/testing-and-evals.md — Post-S7 Test Surface

## Main Test Lanes

| Lane | Location | Purpose |
| --- | --- | --- |
| Root CLI | `tests/cli/` | `pluto:run --spec <path>` behavior and archived-flag rejection |
| Root utilities | `tests/spec-hygiene*.test.ts` and retained repo tests | repo-level utility and policy checks |
| v2 core | `packages/pluto-v2-core/__tests__/` | contracts, pure core, projections, replay |
| v2 runtime | `packages/pluto-v2-runtime/__tests__/` | spec loader, adapters, runner, parity, evidence |
| Live smoke fixtures | `tests/fixtures/live-smoke/` | retained replay and evidence oracles |

## Canonical Commands

```bash
pnpm typecheck
pnpm test
pnpm build
pnpm pluto:run --spec packages/pluto-v2-runtime/test-fixtures/scenarios/hello-team-paseo-mock/scenario.yaml
pnpm smoke:live
pnpm spec:hygiene
```

## What Changed In S7

- Root validation no longer treats v1.6 harness tests as active mainline coverage.
- Active root coverage centers on the v2 CLI plus retained repo utility tests.
- Most execution coverage now lives inside the v2 package test suites.
- Historical v1.6 eval assets are archived with the legacy branch, not exercised from `main`.

## Replay And Parity

- Keep the retained parity fixture in `tests/fixtures/live-smoke/86557df1-0b4a-4bd4-8a75-027a4dcd5d38/` unchanged.
- Use package-level parity and replay tests to protect translator and evidence behavior.

## Live Smoke

`pnpm smoke:live` is the retained end-to-end runtime smoke path for the v2 paseo adapter.
Its knob table is defined in `docs/harness.md`.
