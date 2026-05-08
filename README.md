# Pluto Agent Platform — v2 Mainline

Pluto `main` is v2-only after S7.

- Supported CLI entrypoint: `pnpm pluto:run --spec <path>`
- Active runtime surface: `packages/pluto-v2-core/`, `packages/pluto-v2-runtime/`, and the root CLI bridge in `src/cli/`
- Archived v1.6 harness: `origin/legacy-v1.6-harness-prototype`

See `docs/design-docs/v1-archive.md` for the archive decision and recovery notes.

## Quickstart

```bash
pnpm install
pnpm typecheck
pnpm test
pnpm build
pnpm pluto:run --spec packages/pluto-v2-runtime/test-fixtures/scenarios/hello-team-agentic-tool-mock/scenario.yaml
```

Example authored runtime mode:

```yaml
orchestration:
  mode: agentic_tool
```

## CLI Contract

`pluto:run` accepts a single authored spec path and prints the v2 bridge result:

- `status`
- `summary`
- `evidencePacketPath`
- `transcriptPaths`
- `exitCode`

Legacy selectors and v1.6 runtime flags are no longer part of active usage on `main`.

## Validation Surface

Root validation now centers on:

- v2 CLI tests under `tests/cli/`
- package tests under `packages/pluto-v2-core/__tests__/` and `packages/pluto-v2-runtime/__tests__/`
- retained repo utility tests such as `tests/spec-hygiene.test.ts` and `tests/spec-hygiene-cli.test.ts`

## Live Smoke

```bash
pnpm smoke:live --spec=packages/pluto-v2-runtime/test-fixtures/scenarios/hello-team-agentic-tool-mock/scenario.yaml
```

The live smoke path uses the `agentic_tool` lane and the in-process Pluto MCP server. See `docs/harness.md` and `docs/testing-and-evals.md` for the retained control surface.
