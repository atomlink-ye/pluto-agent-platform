# @pluto/v2-runtime

Deterministic Pluto v2 runtime package for Slice 4.

## Scope

- Loads authored runtime specs through `src/loader/**` only.
- Runs authored specs through the v2 `RunKernel` with a provider-agnostic runtime adapter.
- Ships the fake runtime adapter for fixture-backed end-to-end runs.
- Re-exports the Lane B translator and evidence packet helpers.

## Status

This package is fake-runtime only. A live Paseo-backed runtime adapter is deferred to S5.

## Public Surface

- `loadAuthoredSpec(...)`
- `loadScenarioSpec(...)`
- `runScenario(...)`
- `runFake(...)`
- `makeFakeAdapter(...)`
- `assembleEvidencePacket(...)`
- `translateLegacyEvents(...)`
