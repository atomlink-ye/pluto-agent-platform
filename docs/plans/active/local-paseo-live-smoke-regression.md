# Plan: Local Paseo live smoke regression

## Status

Status: Active

## Goal

Make the live agent-team regression path work without Docker when the host already has `paseo` and `opencode` installed. The live smoke should connect to the local Paseo daemon/CLI directly and run the OpenCode provider with the free MiniMax model.

Mode distinction: default/local mode uses the local Paseo daemon/socket; Docker-packaged or remote daemon mode sets `PASEO_HOST` and the adapter passes `--host <host>` to supported paseo commands. `http://` / `https://` prefixes are normalized away for the Paseo CLI. `OPENCODE_BASE_URL` is only an optional OpenCode HTTP debug endpoint.

## Scope

- Remove the hard requirement for `OPENCODE_BASE_URL` in host-local live smoke preflight.
- Ensure the live adapter uses Paseo provider `opencode` and model `opencode/minimax-m2.5-free` by default, while still allowing environment overrides.
- Keep Docker smoke available, but make local non-Docker live smoke a first-class documented path.
- Support explicit Paseo daemon/API mode via `PASEO_HOST` / `paseo --host` without making `OPENCODE_BASE_URL` the functional switch.
- Update regression tests and verification blocker checks so fast verify remains deterministic without Docker or paid models.
- Validate locally with installed `paseo` and `opencode`.

## Acceptance / verification target

- `pnpm typecheck`, `pnpm test`, `pnpm build`, `pnpm smoke:fake`, and `pnpm verify` pass.
- A local live smoke can be run with no Docker and no `OPENCODE_BASE_URL`, using `paseo` provider `opencode` and model `opencode/minimax-m2.5-free`.
- Docker/remote Paseo daemon mode can be selected with `PASEO_HOST`; local mode works with `PASEO_HOST` unset.
- Documentation and scripts do not imply Docker/OpenCode HTTP is mandatory for the host-local live adapter.

## Verification evidence

- Implemented adapter split for `--provider opencode` and `--model opencode/minimax-m2.5-free`; added `PASEO_MODEL` override.
- Updated local live smoke preflight to treat `OPENCODE_BASE_URL` as optional and to respect `PASEO_BIN` for the required Paseo CLI check.
- Added `pnpm smoke:local`; updated verify blocker check to use missing Paseo CLI instead of missing OpenCode endpoint.
- Updated docs/tests for the local smoke path and no-paseo blocker.
- `pnpm typecheck` — pass.
- `pnpm exec vitest run tests/repo-harness.test.ts tests/paseo-opencode-adapter.test.ts tests/live-smoke-classification.test.ts` — pass (48 tests).
- `PASEO_BIN="/nonexistent/paseo" PLUTO_LIVE_ADAPTER=paseo-opencode pnpm exec tsx docker/live-smoke.ts` — structured blocker: `paseo CLI unavailable`.
- Added adapter `host` / `PASEO_HOST` support; `run`, `wait`, `logs --follow`, `logs` fetch, `send`, and `delete` append `--host <host>` when set.
- Updated live smoke preflight to log local vs explicit daemon mode and probe `provider ls --json --host <host>` when `PASEO_HOST` is set.
- Normalized `http://` / `https://` prefixes from `PASEO_HOST` before passing values to Paseo CLI `--host`.
- `pnpm typecheck` — pass after `PASEO_HOST` support.
- `pnpm test -- tests/paseo-opencode-adapter.test.ts tests/repo-harness.test.ts tests/bootstrap/readiness-gates.test.ts tests/portable-workflow/export.test.ts` — pass (51 tests).
- `PASEO_BIN="/nonexistent/paseo" PLUTO_LIVE_ADAPTER=paseo-opencode pnpm exec tsx docker/live-smoke.ts; test "$?" -eq 2` — pass; structured blocker `paseo CLI unavailable`.
- `PASEO_HOST="localhost:6767" PASEO_PROVIDER="opencode" PASEO_MODEL="opencode/minimax-m2.5-free" pnpm smoke:live` — pass with `status: ok`; run `07e23814-1c46-46de-a9d8-d9a7fa9dc92c`, elapsed 44345ms.
- `pnpm build` — pass.
- `pnpm smoke:fake` — pass; run `c7876446-772c-4d35-8f24-d9a9b4cac0fc`.
- `pnpm verify` — blocked at `pnpm test` by existing failures unrelated to this live-smoke path: `tests/security/permit-contracts.test.ts` and `tests/cli/runs-follow.test.ts`.

## Follow-up

- Follow-up: fix existing `tests/security/permit-contracts.test.ts` and `tests/cli/runs-follow.test.ts` failures so `pnpm verify` can complete end-to-end.
- Architecture follow-up captured in `docs/plans/active/teamlead-orchestrated-agent-team-architecture.md`: live smoke currently proves real agents can run, but the target architecture is TeamLead-owned orchestration via a shared Paseo room/channel, with Pluto preparing the environment and observing evidence rather than owning worker dispatch decisions.
