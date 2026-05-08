# V2 CLI Default Switch (S6 — historical)

> **Status (post-S7):** historical reference. The transition window
> documented here ended when S7 archived the v1.6 mainline runtime.
> `pluto:run` now accepts only `--spec=<path>` against the v2
> AuthoredSpec; `--runtime=v1`, `--scenario`, `--playbook`,
> `--run-profile`, and `PLUTO_RUNTIME=v1` exit 1 with the archived
> message and a pointer to the `legacy-v1.6-harness-prototype`
> branch. See `docs/design-docs/v1-archive.md`.

## Summary (S6 snapshot)

S6 switched `pluto:run` runtime selection to `v2` by default while
preserving an explicit `--runtime=v1` opt-in path for the frozen
v1.6 manager-run harness. The switch was intentionally additive in
`src/cli/**`: old selectors still worked on v1, while v2 required a
single AuthoredSpec via `--spec`.

## Runtime Routing (S6 snapshot)

- Runtime resolution was closed over `v1 | v2`.
- Precedence was `--runtime` flag, then `PLUTO_RUNTIME`, then the
  default `v2`.
- The v2 bridge did not re-read `PLUTO_RUNTIME`; routing was decided
  once in `src/cli/run.ts` before either runtime was entered.
- `--runtime=v1` emitted one stderr warning per invocation
  announcing the planned S7 archival.
- v2 rejected v1.6 name-based selectors (`--scenario`, `--playbook`,
  `--run-profile`) unless the caller explicitly opted into
  `--runtime=v1`.

Post-S7: `--runtime=v1` is no longer accepted; all v1 selectors
exit 1 with the archived message.

## V2 Output Contract

The default switch was a JSON-shape break for callers that parsed
`pnpm pluto:run` stdout.

- v1 output was the manager-run harness envelope with fields such
  as `runId`, `scenario`, `playbook`, `runProfile`, `workspaceDir`,
  `runDir`, `artifactPath`, `evidencePacketPath`, and `evidencePath`.
- v2 output is the bridge result envelope only:
  `status`, `summary`, `evidencePacketPath`, `transcriptPaths`,
  `exitCode`.

Post-S7: the v2 envelope is the only shape produced on `main`.
Consumers that depended on the v1 stdout shape must recover the
v1.6 source from the `legacy-v1.6-harness-prototype` branch and
re-implement against v2 if the feature is still needed.

## classifyPaseoError Rules

The CLI keeps the legacy exit-code-2 contract behind a closed
classifier used by the v2 bridge.

- `capability_unavailable`
  Triggered by raw spawn `ENOENT`, raw spawn `EACCES`, messages
  containing both `spawn` and `ENOENT`, post-spawn `paseo run
  failed with exit code ...` errors whose stderr mentions
  `command not found`, `ENOENT`, or `not executable`, and
  `Failed to spawn paseo CLI` failures.
- `spec_invalid`
  Used for AuthoredSpec parse failures such as strict-Zod
  rejection of v1.6-only fields.
- `run_not_completed`
  Used when the runtime exhausts steps without reaching
  completion.
- `agent_failed_to_start`
  Used when the surfaced error says an agent failed to start.
- `unknown`
  Fallback for everything else.

Exit-code mapping stays narrow:

- `capability_unavailable` => process exit code `2`
- all other failures => process exit code `1`
- success => process exit code `0`

## Unsupported Legacy Fields

The v2 `AuthoredSpecSchema` is strict and does not carry forward
v1.6-only fields such as `helperCli`, `worktree`,
`runtime.dispatchMode`, `concurrency`, `approvalGates`,
`runtimeHelpers`, or `teamleadChat`.

The bridge does not maintain its own allow/deny list. It relies on
strict Zod parsing and, when an `unrecognized_keys` issue is
present, rewrites the user-facing error to include the first
rejected field name:

`v2 AuthoredSpec does not support v1.6-only field <field>; recover legacy specs from the legacy-v1.6-harness-prototype branch.`

## Deprecation Timeline (closed)

- S6: `v2` became the default runtime for `pluto:run`.
- S6: `--runtime=v1` remained available and printed the
  deprecation warning on every invocation.
- S6 migration window: users with v1-specific selectors or stdout
  parsers were expected to pin `--runtime=v1` while moving to
  `--spec` and the bridge result shape.
- S7 (closed 2026-05-08): v1.6 mainline runtime archived;
  `--runtime=v1`, `--scenario`, `--playbook`, `--run-profile`,
  `PLUTO_RUNTIME=v1` all exit 1 with the archived message
  pointing at `legacy-v1.6-harness-prototype`.
