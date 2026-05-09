# Pluto Agent Platform — v2 Mainline

Pluto `main` is v2-only after S7.

- Supported CLI entrypoint: `pnpm pluto:run --spec <path>`
- Run inspection surface: `pnpm pluto:runs replay <runId>` and `pnpm pluto:runs explain <runId>`
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

`pluto:runs` inspects completed runs:

- `pnpm pluto:runs replay <runId> [--run-dir=<path>]` replays `events.jsonl` and checks the task projection for drift.
- `pnpm pluto:runs explain <runId> [--run-dir=<path>] [--format=json]` prints a readable run narrative or emits structured JSON.

Legacy selectors and v1.6 runtime flags are no longer part of active usage on `main`.

## Authoring Playbooks

For `agentic_tool` playbooks, actors call Pluto through `pluto-tool`. The runtime materializes a single run-level binary at `<runDir>/bin/pluto-tool` and a per-actor wrapper that forwards to it; the wrapper is on the actor's `PATH`. Each actor must pass `--actor role:<role>` (or `--actor manager:<key>`) on every mutating call so the server can verify the actor's bound bearer token.

Mutating commands auto-wait for the next relevant event by default. Pass `--no-wait` to opt out, or `--wait-timeout-ms=<ms>` to override the deadline. Do not poll with `read-state` between same-actor mutations.

Example actor instructions:

```md
# Lead actor

1. Inspect the current run state.
   `pluto-tool --actor role:lead read-state --format=text`
2. Delegate the implementation task (auto-waits for the next event).
   `pluto-tool --actor role:lead create-task --owner=generator --title="Draft the runtime change"`
3. Close the run when the work is done.
   `pluto-tool --actor role:lead final-reconciliation --completed-tasks=<id>... --cited-messages=<id>... --summary="..."`
```

Composite verbs collapse common multi-step protocol patterns:

- `pluto-tool --actor role:generator worker-complete --task-id=<id> --summary="..."` — worker → completed + completion mailbox to lead.
- `pluto-tool --actor role:evaluator evaluator-verdict --task-id=<id> --verdict=pass --summary="..."` — evaluator → optional task close + final/task mailbox to lead.
- `pluto-tool --actor role:lead final-reconciliation --completed-tasks=... --cited-messages=... --summary="..."` — lead → `complete_run` with structured citations.

## Validation Surface

Root validation now centers on:

- v2 CLI tests under `tests/cli/`
- package tests under `packages/pluto-v2-core/__tests__/` and `packages/pluto-v2-runtime/__tests__/`
- retained repo utility tests such as `tests/spec-hygiene.test.ts` and `tests/spec-hygiene-cli.test.ts`

## Live Smoke

```bash
pnpm smoke:live --spec=packages/pluto-v2-runtime/test-fixtures/scenarios/hello-team-agentic-tool-mock/scenario.yaml
pnpm pluto:runs explain run-hello-team-agentic-tool-mock --run-dir=.tmp/live-quickstart/.pluto/runs/run-hello-team-agentic-tool-mock
```

The live smoke path uses the `agentic_tool` lane and the in-process Pluto MCP server. See `docs/harness.md` and `docs/testing-and-evals.md` for the retained control surface.
