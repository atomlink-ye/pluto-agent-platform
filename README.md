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

## Authoring Playbooks

For `agentic_tool` playbooks, actors should use `pluto-tool` as the runtime-facing control surface. The runtime injects `PLUTO_RUN_API_URL`, `PLUTO_RUN_TOKEN`, and `PLUTO_RUN_ACTOR` automatically, so playbook instructions should name the CLI rather than raw HTTP details.

Example actor instructions:

```md
# Lead actor

1. Inspect the current run state.
   `pluto-tool read-state --format=text`
2. Delegate the implementation task.
   `pluto-tool create-task --owner=generator --title="Draft the runtime change"`
3. Wait for the next relevant event.
   `pluto-tool wait --timeout-sec=300 --format=text`
4. Close the run when the work is done.
   `pluto-tool complete-run --status=succeeded --summary="Generator draft accepted."`
```

Use `pluto-tool send-mailbox --to=lead --kind=completion --body="..."` for mailbox completion handoff from delegated actors.

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
