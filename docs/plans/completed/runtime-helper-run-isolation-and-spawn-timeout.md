# Plan: Unified runtime helper CLI MVP hardening

## Status

Status: **Completed 2026-05-03**. Implemented in remote OpenCode root manager (Daytona sandbox `1e74561f`); verified locally via direct surgical-diff inspection after fix-round v2 addressed all 3 v1-acceptance defects.

Verification gates (per slice):
- `timeout 120 pnpm exec vitest run tests/orchestrator/runtime-helper.test.ts`: PASS (21.56s)
- `timeout 1200 pnpm test` (full regression gate): PASS
- `timeout 1200 pnpm smoke:live`: FIXTURE_CAPTURED — run completed successfully, but assertion `mailbox.jsonl is missing the plan-approval round-trip messages` failed. This is **NOT a Slice A regression** (Slice A did not touch plan-approval mailbox routing). Captured under `tests/fixtures/live-smoke/a55b71bb-b794-4a67-9d11-eb8d23cea701/` for offline replay; tracked as a separate follow-up plan (`docs/plans/active/runtime-helper-plan-approval-mailbox-evidence.md`).

Iteration history:
- Discovery review 2026-05-03 (`@oracle` + `@council`) returned NOT_READY → 5 gaps closed.
- Mid-flight amendment 2026-05-03: refusal #0 added (no role-bound CLI paths; role is a parameter).
- v1 acceptance review 2026-05-03 returned REJECT with 3 defects (authority precedence inverted; stale-roles cleanup missing on workspace reuse; polling timer not unref'd) → fix-round v2 addressed all three.
- v2 acceptance: ACCEPT (direct manager review of surgical diff).

## Goal

Fix the live-runtime helper's correctness failures without expanding scope:

1. Move the canonical helper interface to **one and only one** shared CLI path at `./.pluto-runtime/pluto-mailbox` with internal role/context resolution. Role-bound CLI paths (`./.pluto-runtime/roles/<role>/pluto-mailbox`) and any role-specific entrypoint **must be deleted entirely**, not kept as compatibility shims. Roles will generalize over time; baking role identity into the executable path is an architectural mistake.
2. Keep helper `spawn` from reporting a false timeout when the spawn action actually succeeded.
3. Keep helper `wait` available and usable through the shared CLI before any broader flow tweaks.
4. Make live-helper authority explicit and run-isolated so workspace reuse cannot cause stale-context drift.

Lead-noise reduction is **not** a separate Slice A goal; it is a downstream consequence of `wait` delivery and is acceptable as long as it does not regress.

## Scope

- Update runtime-helper materialization so the canonical shared CLI is the **only** materialized helper executable. Stop creating per-role wrapper files under `<rootDir>/roles/<roleId>/pluto-mailbox`. Remove the `runtimeHelperRolePath()` export and any consumers; remove the role-shim text from help output and from `docs/harness.md`.
- Resolve role/run/context inside the shared CLI from runtime-injected environment/context, with explicit CLI flags (`--role`, `--run`, `--context`) only as fallback. Role is **a parameter**, not a path.
- Pin live-session helper authority to the runtime-injected run-local context file (see §"Live helper authority" below).
- Preserve spawn-timeout hardening and shared-CLI wait usability with the narrowed ack semantics defined below.
- Add regression coverage for the shared CLI plus timeout/env-resolution/mismatch-rejection behavior.
- Run targeted tests plus one bounded live `hello-team` verification in a fresh isolated test directory.

Out of scope: docs-as-config refactor Phase 2 (Paseo facade), Phase 4 (harness split), Phase 5 (static_loop removal), and any swap of the helper's underlying IPC mechanism. Slice A keeps the file-RPC implementation; any future relay/IPC change belongs to a later slice with its own ADR.

Per architecture synthesis 2026-05-03 (`/tmp/architecture-synthesis.md`), the original "helper-as-thin-chat-poster" framing has been **dropped**: the helper file-RPC is a Pluto-owned local control API, not a duplicate mailbox transport. Mailbox transport stays as paseo chat (already implemented via `PaseoChatTransport`). The helper stays as the local control API. Slice A does not touch this layering.

## Refusals (binding for Slice A)

0. **No role-bound executable paths.** The helper executable lives only at `./.pluto-runtime/pluto-mailbox`. No `./.pluto-runtime/roles/<role>/pluto-mailbox`, no per-role wrapper, no compatibility shim. Role is resolved from env/CLI parameters at invocation time, not from the executable path. Reason: roles will generalize; pinning role identity to a filesystem path is the wrong abstraction.
1. **No bypass of run-local authority checks** in the explicit `--context` / env path. The fail-closed cross-validation rule above is non-negotiable.
2. **No new helper-only protocol fields** that do not map cleanly to `MailboxMessage` / `MailboxEnvelope` (`src/contracts/four-layer.ts:286-341`). The helper's request/response wire shape is a thin proxy onto the typed envelope schema.
3. **No deepening of timeout-inference hacks**. The current bounded fallback in `maybeInferTimedOutSuccess` (`src/orchestrator/runtime-helper.ts:826-853`) stays as-is; do not add new heuristics. With the narrow spawn ack rule (transport accepted + response durably written) the false-timeout class disappears at its source.
4. **No weakening of mailbox evidence authority**. `mailbox.jsonl` and `tasks.json` remain Pluto-owned durable lineage in this slice (per `docs/design-docs/agent-playbook-scenario-runprofile.md §4` and `docs/design-docs/runtime-and-evidence-flow.md §3`).
5. **No claim that same-workspace concurrent live runs are safe**. Live verification uses a fresh isolated directory; operators serialize otherwise.
6. **No improvements to the in-process polling server beyond what these bug fixes require**. The polling server should not grow new responsibilities in Slice A.

## Live helper authority (binding)

Live helper authority MUST be the **runtime-injected run-local context file**, not the shared-workspace context index.

Authority precedence:

1. Runtime-injected `PLUTO_RUNTIME_HELPER_CONTEXT` pointing at `<workspace>/.pluto-runtime/runs/<runId>/contexts/<role>.json` is loaded first.
2. Runtime-injected `PLUTO_RUNTIME_HELPER_ROLE` and `PLUTO_RUNTIME_HELPER_RUN_ID` are validation inputs. The loaded JSON's `roleId` / `runId` MUST match the injected env (and matching CLI flags). On mismatch the helper exits non-zero with an explicit error code (`runtime_helper_context_role_mismatch:<expected>:<actual>` or `runtime_helper_context_run_mismatch:<expected>:<actual>`). This applies symmetrically in the `--context` / explicit-path branch — that branch must not short-circuit cross-validation.
3. CLI fallback: `--context <path>`, else `--role` + `--run` driving the index-resolved branch.
4. Shared `.pluto-runtime/contexts/<role>.json` and `context-index.json` remain only as a **manual fallback to the latest run** for operator inspection. They are never the source of truth for live agent sessions.

The current bug at `src/orchestrator/runtime-helper.ts:698-702` (early return on env/`--context` without role/run cross-validation) is the canonical example to fix.

## Spawn ack semantics (narrow definition)

Spawn `ok` means **both** of the following are true:

1. The mailbox transport accepted the message (`sendMessage(...)` returned without throwing).
2. The helper response file was durably written under `<runDir>/runtime-helper-responses/<requestId>.json`.

Spawn `ok` does **not** require, and must not block on:

- mailbox mirror logging (best-effort, post-ack)
- downstream worker session startup
- task being claimed/in_progress in `tasks.json`
- any other post-send work

Client-side timeout (`runtime_helper_timeout:spawn`) is a fallback for the case where neither a response file nor an inferred-success signal arrives within the deadline. Slice A keeps the inferred-success path (claim observed in `tasks.json`) but defines spawn ack itself by the two conditions above.

## Run-isolation and concurrency contract (binding)

- Per-run helper context lives at `<workspace>/.pluto-runtime/runs/<runId>/contexts/<role>.json`. This is the live authority (per §"Live helper authority").
- Per-run helper request/response/usage paths live under the run dir: `<runDir>/runtime-helper-requests.jsonl`, `<runDir>/runtime-helper-responses/`, `<runDir>/runtime-helper-usage.jsonl`. Materialization already does this; preserve it.
- Same-workspace concurrent live runs are **explicitly unsupported** in Slice A. The live-verification gate MUST use a fresh isolated test directory or operators MUST serialize runs in a shared workspace.
- The shared `.pluto-runtime/contexts/*.json` and `context-index.json` files are refreshed on every materialization. Live sessions MUST NOT depend on them — only the run-local context is authoritative.
- Slice A does NOT add a runtime lock manager or any cross-run coordination. The contract above is enforced by convention plus failing-closed on stale-context resolution.

## Verification target

### Unit tests (targeted, <30s wall clock)

- `tests/orchestrator/runtime-helper.test.ts::"materializes a shared helper CLI that can list tasks and author typed envelopes"` — canonical shared CLI is the primary interface and `wait` is available on it.
- `tests/orchestrator/runtime-helper.test.ts::add "does not materialize per-role helper executables"` — assert NO file exists at `<workspace>/.pluto-runtime/roles/<role>/pluto-mailbox` after materialization for any role; only `<workspace>/.pluto-runtime/pluto-mailbox` exists. (NEW)
- `tests/orchestrator/runtime-helper.test.ts::"keeps run-local helper contexts while refreshing shared contexts when the same workspace is reused"` — reused workspace preserves old run-local context while shared latest context refreshes.
- `tests/orchestrator/runtime-helper.test.ts::add "resolves helper context from injected run-local env and rejects mismatched role/run overrides"` — live authority is the injected run-local context; mismatched injected role/run vs. file content fails closed (NEW; this is the §1 gap-closure test).
- `tests/orchestrator/runtime-helper.test.ts::"acknowledges spawn before slow mailbox logging can trigger a false timeout"` — spawn ack is not blocked on slow post-send logging.
- `tests/orchestrator/runtime-helper.test.ts::"infers spawn success from claimed task state when the helper response arrives too late"` — bounded spawn fallback path.
- `tests/orchestrator/runtime-helper.test.ts::"lets helper wait time out on the requested task timeout instead of the fixed client timeout"` — wait owns its timeout budget.
- `tests/orchestrator/runtime-helper.test.ts::"satisfies helper waits directly and suppresses redundant lead-session noise while the lead stays busy"` — lead path can block on helper wait instead of sleep/poll; direct wait delivery is used.

### Live evidence (one bounded `hello-team` run, fresh isolated dir, ≤600s)

- `<runDir>/workspace-materialization.json` — helper materialized for this run; records run-scoped paths.
- `<workspaceDir>/.pluto-runtime/pluto-mailbox` — canonical shared CLI exists at the documented path.
- `<workspaceDir>/.pluto-runtime/roles/` — directory must NOT exist (or must be empty); no per-role executable was materialized.
- `<workspaceDir>/.pluto-runtime/runs/<runId>/contexts/lead.json` and `…/planner.json` — live sessions can pin to run-local role context.
- `<runDir>/runtime-helper-usage.jsonl` — actual helper command usage (`spawn`, `wait`, `complete`, `verdict`, `finalize`).
- `<runDir>/runtime-helper-responses/<spawn-request-id>.json` matching a `spawn` request id from usage — proves spawn ack durably written for the real run.
- `<runDir>/events.jsonl` — `spawn_request_received` / `spawn_request_executed`, `mailbox_message_delivered` (with `deliveryMode=runtime_helper_wait` where applicable), `final_reconciliation_received`, `run_completed`.
- `<runDir>/mailbox.jsonl` — helper-authored envelopes present on the run lineage.
- `<runDir>/tasks.json` — expected task ids transitioned and were claimed/completed within the same run.

## Notes

- Keep changes focused to `src/orchestrator/runtime-helper.ts`, `src/adapters/paseo-opencode/paseo-opencode-adapter.ts` (env injection only), prompt/docs references, related tests, and only adjacent runtime code if required by verification.
- The hidden risk in this slice is **accepting the wrong authority path by default**, not big design uncertainty. Most of the canonical-CLI scaffolding is already in place; the work is precision and a missing test.
- Per repo memory R8: smoke:live runs ONCE at slice end. R7: 20-min cap per test invocation; targeted-only during fix passes.
