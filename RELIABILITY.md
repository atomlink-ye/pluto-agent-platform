# RELIABILITY.md — Pluto v2 Policy

## Supported Runtime

`main` supports the v2 CLI bridge only:

- entrypoint: `pnpm pluto:run --spec <path>`
- bridge: `src/cli/v2-cli-bridge.ts`
- runtime package: `packages/pluto-v2-runtime/`

## Exit Codes

- `0`: run succeeded
- `1`: spec invalid, run failed, or run did not complete
- `2`: required runtime capability unavailable, including paseo CLI spawn failures

## Reliability Rules

- CLI routing is single-path on `main`; archived v1.6 flows are not a fallback.
- The bridge writes `evidence-packet.json` even on failure paths when possible.
- Transcript writing is best-effort on failure and required on successful runs.
- Runtime adapters must keep provider-specific errors inside the adapter boundary and return normalized outcomes to the bridge.

## Smoke Policy

- Root live smoke entrypoint: `pnpm smoke:live`
- Retained knobs: `PASEO_PROVIDER`, `PASEO_MODEL`, `PASEO_MODE`, `PASEO_THINKING`, `PASEO_HOST`, `PASEO_BIN`, `PLUTO_V2_WAIT_TIMEOUT_SEC`, `PLUTO_V2_WORKSPACE_CWD`
- Missing paseo capability is a structured blocker and should map to exit code `2`, not a silent pass.

## Cleanup Policy

- Preserve generated evidence artifacts for inspection.
- Do not delete archived v1.6 references from the legacy branch as part of normal reliability work on `main`.
