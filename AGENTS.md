# AGENTS.md — Pluto v2 Guidance

`main` is v2-only. Do not reintroduce v1.6 runtime surfaces on `main`.

## Repo Map

```text
src/
  cli/
    run.ts                 # root CLI entrypoint; supported usage is --spec <path>
    v2-cli-bridge*.ts      # root bridge into the v2 runtime packages

packages/
  pluto-v2-core/          # contracts, pure core, projections
  pluto-v2-runtime/       # spec loader, fake adapter, paseo adapter, smoke script

tests/
  cli/                    # root CLI coverage
  *.test.ts               # retained repo utility coverage

docs/                     # product, runtime, testing, QA, and archive docs
```

## Source Of Truth

1. `package.json` — canonical root scripts
2. `src/cli/run.ts` and `src/cli/v2-cli-bridge.ts` — root CLI contract
3. `packages/pluto-v2-core/src/` — v2 contracts and pure execution model
4. `packages/pluto-v2-runtime/src/` — v2 loader, adapters, runner, evidence assembly
5. `docs/mvp-alpha.md` — v2 contract summary
6. `RELIABILITY.md` and `SECURITY.md` — repo-level operational policy

## Workflow

1. Understand the change and affected files.
2. For non-trivial work, update or add a plan under `docs/plans/active/`.
3. Run the lightest useful gates first: `pnpm typecheck`, `pnpm test`.
4. Keep changes minimal and focused.
5. Add or update tests when behavior changes.
6. Sync docs when contracts, workflows, or operator expectations change.
7. Do not move `docs/plans/active/v2-rewrite.md` as part of S7 doc cleanup.

## Canonical Commands

```bash
pnpm typecheck
pnpm test
pnpm build
pnpm pluto:run --spec packages/pluto-v2-runtime/test-fixtures/scenarios/hello-team-paseo-mock/scenario.yaml
pnpm smoke:live
pnpm spec:hygiene
```

## Test Placement

- Root `tests/cli/`: v2 CLI behavior
- Root retained utility tests: repo-level helpers and invariants
- `packages/pluto-v2-core/__tests__/`: contracts, core, projections, replay
- `packages/pluto-v2-runtime/__tests__/`: loader, adapters, runner, parity, evidence

## Documentation Sync

- CLI shape change: update `README.md`, `docs/harness.md`, `docs/testing-and-evals.md`, `docs/qa-checklist.md`
- Contract change: update `docs/mvp-alpha.md` and the relevant package docs
- Reliability or smoke behavior change: update `RELIABILITY.md` and `docs/harness.md`
- Archive-policy change: update `docs/design-docs/v1-archive.md`

## Forbidden Actions

- Do not modify or rewrite `origin/legacy-v1.6-harness-prototype`
- Do not restore `--runtime=v1` or name-selector usage to active docs on `main`
- Do not touch the retained parity fixture for S7 doc work
- Do not commit secrets, tokens, or local `.env` values
