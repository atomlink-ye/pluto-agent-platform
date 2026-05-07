# v2 Paseo Adapter

## Scope

Lane 4 adds the v2-runtime fixture and live-smoke surfaces for the new Paseo adapter path without changing the v2 kernel, runner, loader, evidence, or fake adapter code.

## Mock Fixture

- `test-fixtures/scenarios/hello-team-paseo-mock/scenario.yaml` carries the authored v2 spec for the deterministic Paseo plan.
- `mock-script.json` uses the Table E shape: one entry per model turn with `turnIndex`, `actor`, `transcriptText`, `usage`, and `waitExitCode`.
- Each `transcriptText` contains a fenced `json` block that matches `PaseoDirectiveSchema`.
- The checked-in `expected-events.jsonl` and `expected-evidence-packet.json` are the mechanical kernel outputs for that scripted turn sequence.

## Live Smoke

- Root `pnpm smoke:live` now targets `packages/pluto-v2-runtime/scripts/smoke-live.ts`.
- The script uses the real `makePaseoCliClient`, `makePaseoAdapter`, and `runPaseo` path.
- It authors an inline spec for `scenario/hello-team-real` and writes one fixture capture under `tests/fixtures/live-smoke/<runId>/`.
- Captured artifacts match Table F:
  - `events.jsonl`
  - `evidence-packet.json`
  - `final-report.md`
  - `usage-summary.json`
  - `paseo-transcripts/<actorKey>.txt`

## Bounds And Diagnostics

- The script enforces the binding live-smoke limits: total turns `<= 20` and total cost `<= $0.50`.
- `usage-summary.json` includes:
  - run status and final summary
  - total turns, input tokens, output tokens, total tokens, and cost
  - per-actor usage breakdown
  - per-turn breakdown with `waitExitCode`
  - by-model usage breakdown
  - the evidence packet path

## Export Surface

- `packages/pluto-v2-runtime/src/index.ts` only grows via additive Paseo re-exports so downstream callers can import the new client, adapter, directive helpers, and runner without changing existing entry points.
