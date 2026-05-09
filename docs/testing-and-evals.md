# docs/testing-and-evals.md — v2 Test Surface

## Main Test Lanes

| Lane | Location | Purpose |
| --- | --- | --- |
| Root CLI | `tests/cli/` | `pluto:run --spec <path>` behavior and run-dir outputs |
| Root utilities | `tests/spec-hygiene*.test.ts` and retained repo tests | repo-level utility and policy checks |
| v2 core | `packages/pluto-v2-core/__tests__/` | contracts, pure core, projections, replay |
| v2 runtime | `packages/pluto-v2-runtime/__tests__/` | spec loader, adapters, runner, evidence, run inspection CLI, fixture invariants |
| Live smoke fixtures | `tests/fixtures/live-smoke/` | retained smoke oracles and captured evidence bundles |

## Canonical Commands

```bash
pnpm typecheck
pnpm test
pnpm build
pnpm pluto:run --spec packages/pluto-v2-runtime/test-fixtures/scenarios/hello-team-agentic-tool-mock/scenario.yaml
pnpm pluto:runs replay <runId> --run-dir=<path>
pnpm pluto:runs explain <runId> --run-dir=<path>
pnpm smoke:live --spec=packages/pluto-v2-runtime/test-fixtures/scenarios/hello-team-agentic-tool-mock/scenario.yaml
pnpm spec:hygiene
```

## Fixture Types

After T4-S4, the retained smoke fixtures split into three classes:

1. S4 parity fixture: `tests/fixtures/live-smoke/86557df1-0b4a-4bd4-8a75-027a4dcd5d38/`
   Preserved byte-for-byte as the deterministic regression oracle.
2. Agentic mock fixture: `packages/pluto-v2-runtime/test-fixtures/scenarios/hello-team-agentic-tool-mock/`
   Deterministic tool-lane tests with a mocked Paseo client and in-process MCP calls.
3. Agentic live fixture: `tests/fixtures/live-smoke/<runId>/`
   Captured by `pnpm smoke:live`, tracked by `tests/fixtures/live-smoke/agentic-tool-live-runid.txt`, and asserted by invariant-only coverage.

## Live Smoke

`pnpm smoke:live` is the retained end-to-end runtime smoke path for the v2 Paseo adapter.

- Deterministic smoke remains available as a legacy regression lane.
- Live agentic smoke is driven through `agentic_tool` and the in-process Pluto MCP server.
- The live invariant test reads the manifest-selected run directory and validates outcome, tool-call distribution, lead mailbox completion, authored-spec/playbook capture, and evidence-packet shape.

## Replay And Parity

- Keep the retained parity fixture in `tests/fixtures/live-smoke/86557df1-0b4a-4bd4-8a75-027a4dcd5d38/` unchanged.
- Use runtime package tests for deterministic adapter coverage and tool-lane invariants.
- Use `pnpm pluto:runs replay <runId>` to re-fold `events.jsonl` and check the current task projection for drift.
- Use `pnpm pluto:runs explain <runId>` to summarize tasks, mailbox traffic, artifacts, and optional final-reconciliation evidence.
- Treat the live fixture as an audit artifact, not a byte-stable oracle.
