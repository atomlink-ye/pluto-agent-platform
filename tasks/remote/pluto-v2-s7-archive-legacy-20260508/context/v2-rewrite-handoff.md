# Pluto v2 rewrite handoff — freeze legacy harness prototype

Last updated: 2026-05-07

## Related environment status

- [VPS Daytona sandbox / OpenCode GPT-5.4 environment probe — 2026-05-07](./pluto-v2-vps-sandbox-env-probe-2026-05-07.md)

## Audience

This handoff is for the next manager who will take over Pluto after the Notion docs rewrite and the decision to stop treating the current v1.6 implementation as the long-term architecture base.

## Current decision

We should **rewrite the core, not keep incrementally refactoring the current harness implementation**.

The current repository has already served its highest-value purpose: it experimentally validated that an external agent team harness workflow can work with Fake and Paseo live runtimes. It should now be treated as a **legacy prototype / evidence oracle**, not as the target architecture.

Short form:

```text
Preserve the validated workflow evidence.
Freeze the current implementation as Legacy.
Rebuild main around a clean event-sourced RunKernel.
```

## Original Notion source

Root Notion page:

- URL: <https://www.notion.so/pluto-358d906605f781d0ad18fe66b6d97165?source=copy_link>
- Page ID: `358d906605f781d0ad18fe66b6d97165`
- Title: `pluto`

The current local clone of the Notion tree lives at:

- `.local/references/docs/notion-pluto-2026-05-06/`
- Index: `.local/references/docs/notion-pluto-2026-05-06/_index.md`
- Manifest: `.local/references/docs/notion-pluto-2026-05-06/_manifest.json`
- Raw MCP fetch JSON: `.local/references/docs/notion-pluto-2026-05-06/_raw/`

Clone snapshot status:

- Pages fetched: 78
- Fetch errors: 0
- Fetch method: Notion MCP through MCP Porter, serial calls only.

Important MCP note: do **not** fetch many Notion pages in parallel through MCP Porter. Parallel calls hit local port conflicts such as:

```text
listen EADDRINUSE: address already in use 127.0.0.1:33337
```

Use serial calls, for example:

```bash
mcporter call notion.notion-fetch \
  'id=https://www.notion.so/pluto-358d906605f781d0ad18fe66b6d97165?source=copy_link' \
  include_discussions=false \
  --config ~/.mcporter/mcporter.json
```

To inspect Notion tools:

```bash
mcporter list notion --schema --config ~/.mcporter/mcporter.json
```

## New product / architecture thesis

Pluto is an **External Agent Team Run Harness**.

It is not:

- a replacement for Paseo daemon;
- a clone of Claude Code's internal agent loop;
- a document-first review/approval/publish platform in v1;
- a generic multi-agent launcher.

Target architecture:

```text
Agent / Playbook / Scenario / RunProfile
  -> SpecCompiler
  -> TeamContext
  -> protocol request
  -> RunKernel authority validation
  -> append-only RunEventLog
  -> projections: tasks / mailbox / evidence
  -> EvidencePacket
  -> replay
```

Core principles:

```text
Agent output is input.
Protocol message is a request.
Harness validation creates state.
RunEventLog is the source of truth.
Projection is derived state.
Evidence is an audit projection.
Replay proves consistency.
```

## What to preserve from the current repo

Preserve these as reference/evidence:

1. Successful Fake runtime workflow.
2. Successful Paseo live team-run workflow.
3. Mailbox / task / evidence / plan-approval path learnings.
4. Runtime helper learnings, including the known pitfalls.
5. Captured fixtures and live evidence.
6. Smoke assertions in `docker/live-smoke.ts`.
7. Current four-layer object concepts: `Agent`, `Playbook`, `Scenario`, `RunProfile`.
8. Evidence expectations: role citations, artifact lineage, mailbox/task lineage, audit packet shape.
9. Paseo integration lessons: create/send/wait/logs/chat/session lifecycle, workspace isolation, concurrency hazards.

The old code should be an acceptance oracle, not the architecture to keep extending.

## What to stop carrying forward as architecture

Explicitly do not build v2 around these:

1. `src/orchestrator/manager-run-harness.ts` as the main architecture.
2. Direct mutation of `tasks.json` / `mailbox.jsonl` as authoritative state.
3. Dual-write ambiguity between mailbox/tasks/evidence/events.
4. Role-bound helper CLI paths such as `.pluto-runtime/roles/<role>/pluto-mailbox`.
5. Workspace-level helper context drift.
6. Adapter-specific orchestration branching tied to `PaseoOpenCodeAdapter` / OpenCode details.
7. Deferred platform surface as v1 mainline: Review, Approval, PublishPackage, RBAC, Marketplace, Schedule, Compliance, broad observability/analytics.
8. Active plan drift from previous product-shape iterations.

## First step: freeze current branch as Legacy

The intended freeze approach is simple:

1. Keep the current implementation state as a legacy branch.
2. Call the branch `Legacy` unless the operator chooses a more explicit equivalent such as `legacy/v1.6-harness-prototype`.
3. Continue new development on `main` as the v2 rewrite path.

Suggested operator sequence, after checking current git state and remote policy:

```bash
git status --short
git branch Legacy
git push -u origin Legacy
```

Then keep `main` for the rewrite. Do not force-push. Do not delete legacy code until the v2 path passes its acceptance gates.

Important: this handoff records the intended branch strategy only. It does not claim that the branch has already been created.

## v2 rewrite plan

### Phase 0 — Freeze and scope alignment

- Create/push the `Legacy` branch from the current implementation state.
- Mark current v1.6 runtime as `legacy prototype / reference harness` in docs.
- Update top-level docs so they no longer present current `manager-run-harness.ts` as the long-term architecture.
- Keep current fixtures/evidence available for acceptance.
- Stop broadening v1.6 except for critical evidence preservation.

### Phase 1 — v2 contracts first

Define before implementation:

- `RunEvent` schema and versioning.
- Protocol request schema.
- Authority validation outcomes.
- Accepted and rejected event taxonomy.
- Projection contracts: task board, mailbox, evidence packet.
- Replay acceptance rules.

RunEvent should be replay-grade from day one. Include at least:

- `eventId`
- `runId`
- `sequence`
- `timestamp`
- `schemaVersion`
- `actor`
- `requestId`
- `causationId`
- `correlationId`
- `entityRef`
- accepted/rejected status where applicable

### Phase 2 — Pure core

Build a clean core with no Paseo dependency:

```text
SpecCompiler
RunKernel
RunState reducer
RunEventLog
ProtocolValidator
Authority checks
```

The kernel should accept inputs and emit events/commands. It should not directly mutate task/mailbox/evidence files.

### Phase 3 — Projections and replay

Derive all user-visible run state from the event log:

- task projection;
- mailbox projection;
- evidence projection;
- final report projection if needed.

Add replay tests before real runtime integration:

```text
events.jsonl -> projections -> diff / acceptance
```

### Phase 4 — Fake runtime first

Use Fake runtime to prove the v2 flow deterministically:

```text
four-layer spec
  -> TeamContext
  -> static dispatch or structured protocol messages
  -> RunEvents
  -> projections
  -> EvidencePacket
  -> replay pass
```

Do not aim for bug-for-bug compatibility with v1.6. Aim for workflow/evidence/acceptance compatibility.

### Phase 5 — Paseo adapter second

Only after Fake + replay pass, add a thin provider-agnostic Paseo runtime adapter:

- `PaseoRuntimeAdapter`, not `PaseoOpenCodeAdapter` as the semantic boundary.
- `PaseoCliClient` as a thin CLI wrapper.
- Provider/model/mode are runtime config, not architecture boundaries.
- Paseo chat/session/timeline are external runtime state; Pluto RunEventLog remains authoritative.

### Phase 6 — CLI switch

Switch `pluto:run` to v2 only after:

- Fake v2 run passes;
- replay passes;
- old fixture replay/parity checks pass where applicable;
- one bounded Paseo live smoke succeeds.

Keep legacy v1 opt-in for one transition window.

### Phase 7 — Archive/delete legacy mainline

After v2 is accepted:

- remove v1.6 runtime from the default path;
- keep only reference fixtures/docs where useful;
- delete or archive obsolete helper/runtime code.

## Deferred until v2 core is proven

Do not start these until event-sourced replay is working:

- Paseo daemon client path;
- long-lived workers;
- MCP tool protocol;
- Review / Approval / PublishPackage;
- RBAC / multi-tenant;
- marketplace / schedule / compliance;
- UI-first dashboard;
- broad analytics/cost controls.

## Known legacy runtime lessons to keep in mind

From `.local/manager/handoff/state.md` and active plans:

- Current helper MVP proved useful but has wrong interface shape.
- Role-bound helper paths were judged wrong.
- A canonical helper path was preferred: `.pluto-runtime/pluto-mailbox`.
- `spawn` had false-timeout behavior even when work succeeded.
- `wait` UX was unstable; earlier flows overused sleep/polling.
- Lead could receive noisy post-handled runtime traffic.
- Workspace-level helper state could drift across runs.
- Live Paseo runs in the same workspace can contaminate each other.
- Plan-approval mailbox evidence had a captured live-smoke fixture issue.

These are reasons to avoid carrying helper-era implementation details into v2.

## Suggested first manager tasks

1. Read this handoff.
2. Read the local Notion clone index:
   - `.local/references/docs/notion-pluto-2026-05-06/_index.md`
3. Read the Notion root directly if needed through MCP Porter:
   - `358d906605f781d0ad18fe66b6d97165`
4. Inspect git status and create/push `Legacy` branch if approved/appropriate.
5. Draft a short v2 execution plan under `docs/plans/active/` before code changes.
6. Start with v2 contracts and replay-grade event schema, not with `manager-run-harness.ts` refactoring.

## Acceptance criteria for the rewrite kickoff

- Legacy branch exists and preserves the current prototype state.
- `main` has a clear v2 plan and does not depend on old helper architecture.
- v2 contract docs define RunEventLog as source of truth.
- First v2 tests prove pure event replay before live runtime work.
- Current Notion docs remain locally available for offline/reference use.
