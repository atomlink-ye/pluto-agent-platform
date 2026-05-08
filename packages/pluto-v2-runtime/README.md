# @pluto/v2-runtime

Pluto v2 runtime package.

## Scope

- Loads authored runtime specs through `src/loader/**`.
- Runs authored specs through the v2 `RunKernel` with fake or Paseo-backed adapters.
- Ships the retained deterministic regression lane and the live `agentic_tool` lane.
- Re-exports evidence packet helpers and the archived translator surface.

## Modes

| Mode | Purpose | Notes |
| --- | --- | --- |
| `deterministic` | legacy regression lane | keeps the retained byte-stable parity surface |
| `agentic_tool` | live agentic lane | uses `runPaseo()` plus the in-process Pluto MCP server |

`agentic_tool` is the default live-run path. `deterministic` remains opt-in for regression coverage.

## Public Surface

- `loadAuthoredSpec(...)`
- `loadScenarioSpec(...)`
- `runScenario(...)`
- `runFake(...)`
- `makeFakeAdapter(...)`
- `makePaseoAdapter(...)`
- `makePaseoCliClient(...)`
- `runPaseo(...)`
- `assembleEvidencePacket(...)`
- `translateLegacyEvents(...)`
