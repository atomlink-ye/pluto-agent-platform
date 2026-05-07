# V2 CLI Default Switch

## Summary

S6 switches `pluto:run` runtime selection to `v2` by default while preserving an explicit `--runtime=v1` opt-in path for the frozen v1.6 manager-run harness. The switch is intentionally additive in `src/cli/**`: old selectors still work on v1, while v2 requires a single AuthoredSpec via `--spec`.

## Runtime Routing

- Runtime resolution is closed over `v1 | v2`.
- Precedence is `--runtime` flag, then `PLUTO_RUNTIME`, then the default `v2`.
- The v2 bridge does not re-read `PLUTO_RUNTIME`; routing is decided once in `src/cli/run.ts` before either runtime is entered.
- `--runtime=v1` emits one stderr warning per invocation:
  `v1.6 runtime is deprecated; will be archived in S7. See docs/design-docs/v2-cli-default-switch.md for migration.`
- v2 rejects v1.6 name-based selectors (`--scenario`, `--playbook`, `--run-profile`) unless the caller explicitly opts into `--runtime=v1`.

## V2 Output Contract

This default switch is also a JSON-shape break for callers that parse `pnpm pluto:run` stdout.

- v1 output is the manager-run harness envelope with fields such as `runId`, `scenario`, `playbook`, `runProfile`, `workspaceDir`, `runDir`, `artifactPath`, `evidencePacketPath`, and `evidencePath`.
- v2 output is the bridge result envelope only:
  `status`, `summary`, `evidencePacketPath`, `transcriptPaths`, `exitCode`.
- Consumers that were assuming the v1 stdout shape must either pin `--runtime=v1` during migration or update to the v2 result schema.

## classifyPaseoError Rules

The CLI keeps the legacy exit-code-2 contract behind a closed classifier used by the v2 bridge.

- `capability_unavailable`
  Triggered by raw spawn `ENOENT`, raw spawn `EACCES`, messages containing both `spawn` and `ENOENT`, post-spawn `paseo run failed with exit code ...` errors whose stderr mentions `command not found`, `ENOENT`, or `not executable`, and `Failed to spawn paseo CLI` failures.
- `spec_invalid`
  Used for AuthoredSpec parse failures such as strict-Zod rejection of v1.6-only fields.
- `run_not_completed`
  Used when the runtime exhausts steps without reaching completion.
- `agent_failed_to_start`
  Used when the surfaced error says an agent failed to start.
- `unknown`
  Fallback for everything else.

Exit-code mapping stays narrow:

- `capability_unavailable` => process exit code `2`
- all other failures => process exit code `1`
- success => process exit code `0`

## Unsupported Legacy Fields

The v2 `AuthoredSpecSchema` is strict and does not carry forward v1.6-only fields such as `helperCli`, `worktree`, `runtime.dispatchMode`, `concurrency`, `approvalGates`, `runtimeHelpers`, or `teamleadChat`.

The bridge does not maintain its own allow/deny list. It relies on strict Zod parsing and, when an `unrecognized_keys` issue is present, rewrites the user-facing error to include the first rejected field name:

`v2 AuthoredSpec does not support v1.6-only field <field>; use --runtime=v1 for legacy specs.`

## Deprecation Timeline

- S6: `v2` becomes the default runtime for `pluto:run`.
- S6: `--runtime=v1` remains available and prints the deprecation warning on every invocation.
- S6 migration window: users with v1-specific selectors or stdout parsers should pin `--runtime=v1` while moving to `--spec` and the bridge result shape.
- S7: the v1.6 runtime is archived and the opt-in compatibility path is removed.
