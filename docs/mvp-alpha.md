# Pluto MVP-alpha — v2 Contract Summary

## Goal

Pluto `main` accepts one authored v2 spec, runs it through the v2 runtime, and emits a compact evidence bundle.

## Mainline Entry

- CLI: `src/cli/run.ts`
- Supported invocation: `pnpm pluto:run --spec <path>`
- Bridge result: `status`, `summary`, `evidencePacketPath`, `transcriptPaths`, `exitCode`

## Mainline Packages

| Surface | Location | Purpose |
| --- | --- | --- |
| v2 contracts and core | `packages/pluto-v2-core/` | schemas, pure runtime core, projections, replay |
| v2 runtime | `packages/pluto-v2-runtime/` | spec loading, adapters, execution, evidence packet assembly |
| root CLI bridge | `src/cli/v2-cli-bridge.ts` | root process contract over the runtime package |

## Mode Contract

`orchestration.mode` is runtime-local and supports:

- `deterministic`
- `agentic_tool`

`agentic_tool` normalizes to the closed core `agentic` mode only at the runtime boundary. The live control plane is typed tool calls over the in-process Pluto MCP server.

## Required Outputs

- `evidence-packet.json`
- zero or more actor transcripts recorded in `transcriptPaths`
- CLI stdout using the v2 bridge result envelope

Live `agentic_tool` smoke captures also retain `events.jsonl`, `usage-summary.json`, `final-report.md`, and the authored-spec/playbook audit files in the run directory.

## Open-Role MVP (T14)

T14 ships:

- open custom non-lead roles via validated `ActorRole` strings
- required literal `lead` and `manager` actors for `agentic_tool`
- authored policy as the single authorization source-of-truth
- runtime wiring that resolves custom roles through load, prompt slicing, tokens, and route enforcement
- fail-fast duplicate `actorKey` detection for one-actor-per-role safety
- shared Fake and Paseo adapter contract coverage

Deferred to T15+:

- `actor:<id>` identity and multi-same-role workers in one run
- lead-profile generalization beyond the literal `lead` actor
- a user-authored capability or policy DSL
- actor-id-based playbook slicing
- new composite verbs beyond `worker-complete`, `evaluator-verdict`, and `final-reconciliation`

## Acceptance Shape

A run is acceptable when:

1. the authored spec loads successfully;
2. the runtime reaches a terminal outcome;
3. the CLI returns the documented result envelope;
4. the evidence packet is written;
5. transcript capture is available for the actors that ran.

## Archive Note

The former v1.6 four-layer manager-run harness, name-based selectors, and related authored-config surface are archived to `origin/legacy-v1.6-harness-prototype` and are not part of the active MVP contract on `main`.
