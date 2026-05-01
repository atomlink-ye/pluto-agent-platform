# OpenCode Agent Teams Gap Review

**Review Date:** 2026-05-01
**Status:** Active Review

---

## 1. Historical Baseline Summary

### Core Components

| File | Role | Current Behavior |
|------|------|------------------|
| `src/orchestrator/team-run-service.ts` | Central orchestrator | Baseline lane parsed worker requests and owned sequencing logic |
| `src/contracts/adapter.ts` | Adapter interface | Baseline seam before playbook/transcript/spawn additions |
| `src/adapters/paseo-opencode/paseo-opencode-adapter.ts` | Live adapter | Baseline lane parsed legacy marker output from the lead and spawned workers via `paseo run` |
| `src/orchestrator/team-config.ts` | Team configuration | Defined the static role graph before playbook selection was wired end-to-end |
| `src/governance/seed.ts` | Governance seeds | Creates `PlaybookRecordV0` with ID `playbook-default-governance` (unused in orchestration) |
| `docker/live-smoke.ts` | Integration test | Verifies lead started, >=2 workers completed, artifact mentions roles |

### Baseline Flow

```
TeamRunService.run()
  ├── adapter.startRun()
  ├── adapter.createLeadSession() → spawns lead agent
  ├── Loop: readEvents() → parses legacy marker lines
  │   └── dispatchWorkerWithRetry() → spawns worker agents
  ├── When contributions >= required: sendMessage("SUMMARIZE")
  └── Collects lead_summary → writes artifact
```

### Baseline Code Evidence

**team-run-service.ts:340-353** — Pluto parses worker requests:
```typescript
if (ev.type === "worker_requested") {
  const targetRole = String(ev.payload?.["targetRole"] ?? ev.roleId ?? "");
  workersDispatched.add(targetRole);
  await this.dispatchWorkerWithRetry(runId, task, role, instructions, ...);
}
```

**paseo-opencode-adapter.ts** — The baseline live adapter prompt instructed the lead to emit a strict legacy marker format that Pluto parsed.

---

## 2. Gap List vs Agent Teams/Harness Target

### Remaining Critical Gaps After S6

| # | Gap | Target | Current | Severity |
|---|-----|--------|---------|----------|
| 1 | **No shared coordination channel** | Paseo room/channel for all team communication | File-backed transcript shipped; no live room/channel yet | Critical |
| 2 | **Pluto-mediated bridge still owns direct-lane dispatch** | TeamLead owns flow; Pluto only prepares env and observes | `runTeamleadDirectFlow()` enforces the playbook and uses adapter spawn hooks only as a bridge seam | Critical |
| 3 | **Role graph / export surface still constrained** | Playbooks and logical refs can evolve without static role-order assumptions | Non-default playbook selection is shipped, but role order and portable export remain constrained by default-team assumptions | High |
| 4 | **Live smoke still cannot prove TeamLead-owned host spawning** | Smoke demonstrates TeamLead-created child agents or room-backed delegation | Smoke proves transcript/evidence/dependency order, but not true TeamLead-owned runtime spawning | High |
| 5 | **Room transcript is not yet the live source of truth** | Room messages persisted as evidence | Nested transcript evidence is shipped, but it is file-backed only | Medium |

### Playbook Customizability Gaps

| Gap | Description |
|-----|-------------|
| **Playbook loaded only as first bounded seam** | `TeamRunService` now selects authored `TeamPlaybookV0` data and passes it to adapters/TeamLead, but still retains legacy fallback dispatch mechanics |
| **Minimal playbook schema exists** | `TeamPlaybookV0` covers stages, dependencies, revision rules, and final citation metadata; file/YAML authoring remains future work |
| **Custom playbook unit coverage exists** | Non-default research-review playbook selection is tested; live smoke still uses default unless configured later |
| **Role graph not configurable** | `ROLE_ORDER: AgentRoleId[] = ["lead", "planner", "generator", "evaluator"]` is hardcoded |

### Regression-fix iteration outcomes through S6 (2026-05-01)

- Authored playbooks live in `src/orchestrator/team-playbook.ts` and are attached to `DEFAULT_TEAM`.
- `TeamTask.playbookId` selects a non-default playbook without adding per-playbook branches to `TeamRunService`.
- A file-backed coordination transcript records TeamLead/transcript intent at `.pluto/runs/<runId>/coordination-transcript.jsonl`.
- Run events and `evidence.json` now include `playbookId`, `orchestrationSource`, `orchestrationMode`, revision/escalation/final-reconciliation evidence, and the nested `orchestration.transcript` ref.
- `docker/live-smoke.ts` now fails when playbook/transcript orchestration evidence is missing or the recorded transcript file does not exist.
- Default `teamlead_direct` runs now enforce playbook dependency order, record `dependencyTrace`, and support a bounded revision/escalation loop.
- Live adapter prompts explicitly instruct TeamLead to use `paseo run/chat/wait/logs/inspect` when shell/Paseo CLI exists, while the legacy marker lane remains fallback-only.

Remaining critical gaps after this seam:

- Paseo chat room creation/post/read/wait is not wired yet.
- Pluto still performs the deterministic direct-lane bridge orchestration instead of observing a fully agent-driven TeamLead runtime.
- Live smoke still does not prove room-backed coordination or TeamLead-owned host spawning.

---

## 3. Risk Assessment: What is Misleadingly Green Today

### What Passes (Green)

| Check | Status | Risk |
|-------|--------|------|
| `pnpm typecheck` | ✅ Passes | Safe |
| targeted regression tests | ✅ Pass | Safe for current adapter changes |
| `pnpm smoke:fake` | ✅ Passes | Safe |
| `pnpm smoke:local` (when paseo available) | ✅ Passes | **MISLEADING** |
| Live smoke assertions | ✅ Passes | **MISLEADING** |

### Why It Is Still Misleading

1. **Live smoke now verifies:**
   - Lead session created
   - Playbook/transcript evidence exists and the transcript file is present
   - Default direct-lane stages complete in dependency order
   - Final reconciliation citations validate when required
   - Artifact mentions roles (lead, planner, generator, evaluator)

2. **Live smoke still does NOT verify:**
   - TeamLead actually spawned teammates from its own runtime (vs Pluto using the bridge)
   - Any room/channel was created or used
   - A real room transcript was the source of truth

3. **The architecture looks functional** because:
   - Agents do run end-to-end
   - Artifact contains contributions from all roles
   - Evidence is persisted
   - Dependency/citation/revision evidence is present

4. **But it's fundamentally different** from the target:
   - Target: TeamLead owns orchestration, Pluto observes
   - Current: Pluto ships a playbook-enforcing bridge for `teamlead_direct`, while the legacy lane still relies on markers

---

## 4. Concrete Staged Remediation Plan

### Phase 1: Architecture Clarification (Week 1-2)

**Goal:** Make the current architecture explicit; add instrumentation to detect the gap.

| Task | Acceptance Test | Files |
|------|-----------------|-------|
| Add `orchestrator_source` event field to distinguish "pluto_dispatched" vs "lead_requested" | Events contain `orchestrator_source: "lead_marker"` vs `"pluto_fallback"` | `src/contracts/types.ts`, `src/orchestrator/team-run-service.ts` |
| Add smoke assertion for orchestration source | Smoke fails if >50% workers dispatched via fallback | `docker/live-smoke.ts` |
| Document current marker-based protocol in `docs/harness.md` | Section added explaining current vs target | `docs/harness.md` |

### Phase 2: Playbook Model Introduction (Week 3-4)

**Goal:** Define playbook schema; wire into team config without changing control flow.

| Task | Acceptance Test | Files |
|------|-----------------|-------|
| Define `TeamPlaybookV0` schema (stages, roles, dependencies, stop conditions) | Schema compiles; validation passes | `src/contracts/types.ts` |
| Add `playbook` field to `TeamConfig` | Config accepts playbook; defaults to planner→generator→evaluator | `src/orchestrator/team-config.ts` |
| Pass playbook to lead session via adapter | Lead receives playbook in prompt | `src/adapters/paseo-opencode/paseo-opencode-adapter.ts` |
| Add smoke test for non-default playbook | Smoke runs with custom playbook; fails if flow differs | `docker/live-smoke.ts` |

### Phase 3: Room/Channel Adapter Path (Week 5-8)

**Goal:** Implement room-based coordination; transition from marker protocol.

| Task | Acceptance Test | Files |
|------|-----------------|-------|
| Add `createRoom()` to `PaseoTeamAdapter` interface | Interface updated | `src/contracts/adapter.ts` |
| Implement `PaseoRoomAdapter` using `paseo chat` | Adapter creates room; returns room ID | New: `src/adapters/paseo-room/index.ts` |
| Pass room ID to TeamLead; TeamLead posts to room | Lead messages appear in room | `src/adapters/paseo-opencode/paseo-opencode-adapter.ts` |
| Persist room transcript to evidence | Evidence includes room transcript path | `src/orchestrator/evidence.ts` |
| Add smoke assertion: room created | Smoke fails if no room created | `docker/live-smoke.ts` |

### Phase 4: TeamLead Orchestration Enforcement (Week 9-12)

**Goal:** Pluto steps back; TeamLead owns flow.

| Task | Acceptance Test | Files |
|------|-----------------|-------|
| Remove marker parsing from adapter | Adapter no longer emits `worker_requested` from text | `src/adapters/paseo-opencode/paseo-opencode-adapter.ts` |
| Add `team_event` event type for room messages | Events include room-sourced messages | `src/contracts/types.ts` |
| Pluto observes room, not dispatches | `TeamRunService` only reads events; doesn't dispatch | `src/orchestrator/team-run-service.ts` |
| Add dependency chain verification | Evidence proves planner→generator→evaluator flow | `src/orchestrator/evidence.ts` |
| Add revision loop test | Smoke runs with intentional evaluator failure; verifies retry | `docker/live-smoke.ts` |

### Phase 5: Full Custom Playbook Support (Week 13+)

**Goal:** Author playbooks without code changes.

| Task | Acceptance Test | Files |
|------|-----------------|-------|
| YAML/JSON playbook authoring | Playbooks load from file; no code changes | `src/orchestrator/playbook-loader.ts` |
| Non-default playbook smoke test | Smoke runs research-only playbook | `docker/live-smoke.ts` |
| Documentation: "How to author a playbook" | Docs explain schema and examples | `docs/playbook-authoring.md` |

---

## 5. Questions for Oracle/Council Review

### Strategic Questions

1. **Does current Paseo expose a first-class orchestrator/team spawning primitive beyond `paseo chat` and `paseo run/send`?**
   - Updated finding: even without a separate primitive, a TeamLead agent launched through `paseo run` can itself run `paseo run` to spawn child agents when its runtime grants shell/Paseo CLI capability. This capability is not tied to a mode named `orchestrator`; modes are provider-specific permission/behavior presets.
   - Room-based bridge remains useful as a fallback only, not the preferred path.

2. **What should the first portable playbook schema look like?**
   - Should it live in governance/catalog alongside role definitions?
   - Or should it be a separate concern?

3. **How many evaluator→generator revision rounds should live smoke allow before escalating?**
   - Current: 0 (fails immediately)
   - Target: configurable via playbook

### Technical Questions

4. **Is the marker-based protocol acceptable as a transitional bridge?**
   - The target doc says "acceptable as transitional bridge: Pluto may perform mechanical `paseo run` calls if Paseo currently requires CLI-side spawning"
   - But "not acceptable as final architecture: Pluto independently decides worker order"

5. **Should room transcript become part of `EvidencePacketV0`, or should evidence reference a separate room transcript artifact?**

6. **What's the minimal viable change to prove TeamLead orchestration?**
   - Option A: Add room creation, pass room ID to lead, verify lead posts to room
   - Option B: Keep marker protocol but add instrumentation to prove lead decided order

---

## 6. Oracle and Council Review Synthesis

This section incorporates independent review from `@oracle` and `@council` requested after the OpenCode review.

### Shared conclusion

All reviewers agree on the same core diagnosis:

- Current Pluto is a useful MVP harness, but **not yet a TeamLead-owned agent-team runtime**.
- The main architectural problem is not provider/model wiring; it is **control-plane ownership**.
- `TeamRunService` still owns dispatch, sequencing, fallback, summarization timing, and evaluator failure behavior.
- `PaseoOpenCodeAdapter` still uses the legacy marker protocol as the effective control plane for the fallback lane.
- The platform needs a playbook-driven, room/transcript-backed execution seam where TeamLead decisions are durable and observable.

### Oracle review highlights

Oracle emphasized these risks:

1. **Two control planes** — TeamLead appears to coordinate, but Pluto actually controls dispatch. This will become brittle and confusing.
2. **Hard-coded MVP flow leaks everywhere** — role union, default team, fake adapter, live adapter prompt, and service completion logic assume lead/planner/generator/evaluator.
3. **Evidence can falsely imply orchestration quality** — current evidence proves agents ran, not that they coordinated.
4. **Legacy tests protect the old architecture** — tests assert marker behavior that should eventually disappear.
5. **Marker parsing is fragile** — orchestration depends on exact stochastic text lines.

Oracle's simplification advice:

- Do not build a full TypeScript workflow engine; that recreates the wrong control plane.
- Start with a minimal playbook schema: stages, role, dependencies, acceptance gate, max revisions, evidence expectations.
- If Paseo cannot let TeamLead spawn agents directly, use a thin bridge: TeamLead posts structured spawn/continue decisions to the room; Pluto mechanically executes them; room transcript remains source of truth.
- Remove or quarantine `underdispatchFallback` in the TeamLead-owned path.
- Avoid supporting marker and room protocols indefinitely.

### Council review highlights

Council agreed the gap is material, with critical gaps:

1. Pluto owns orchestration decisions.
2. Marker protocol is the current control plane.
3. No shared coordination substrate exists.
4. No stage dependency enforcement exists.
5. No TeamLead-managed revision loop exists.
6. No executable playbook model exists.

Council recommended a staged approach:

1. Make playbooks explicit and data-driven.
2. Introduce a coordination channel abstraction.
3. Replace marker parsing with a structured TeamLead→Pluto bridge protocol.
4. Add revision loops and harden smoke acceptance.

Council also suggested a minimal `TeamPlaybookV0` shape with stages, role per stage, dependencies, output kind, optional revision rules, and final artifact requirements.

Council confidence note: direction has strong consensus. Subsequent local Paseo probing showed a TeamLead-style agent can spawn another agent via `paseo run` when it has shell/Paseo CLI access. The preferred target is TeamLead-direct spawning plus room/transcript evidence. A room/transcript-backed bridge remains an acceptable fallback for runtime configurations that cannot run Paseo CLI.

## 7. Consolidated Remediation Plan

The combined OpenCode + Oracle + Council plan is:

### Stage A — Preserve current harness, stop claiming full Agent Teams semantics

Purpose: keep the working live smoke, but make the architecture gap explicit.

Acceptance:

- Docs state that current live smoke proves real agents run, not TeamLead-owned orchestration.
- Evidence distinguishes marker/bridge/fallback sources.
- Existing repo-local fallback evidence path remains inspectable when the preferred `/Volumes/AgentsWorkspace/tmp/pluto-regression-fix/live-quickstart/` workspace is unavailable.

### Stage B — Add data-driven playbook contract

Purpose: make orchestration intent configurable before changing runtime mechanics.

Minimal fields:

- `id`, `title`, `leadRoleId`
- `stages[]`: `id`, `roleId`, `action`, `dependsOn`, `instructions`, `outputKind`, `maxAttempts`
- `revision`: evaluator/reviewer stage → generator/target stage, verdict trigger, max rounds, max-round behavior
- `final`: final role, required stage IDs, required citations, artifact format

Acceptance:

- Default playbook encodes planner → generator → evaluator.
- At least one non-default playbook, such as `research-only`, validates and can be selected.
- Playbook selection is recorded in run events/evidence.
- No code change in `TeamRunService` is required to select the non-default playbook.

### Stage C — Add TeamLead-direct Paseo orchestration capability

Purpose: make TeamLead, not Pluto, the direct owner of teammate spawning and coordination.

Acceptance:

- TeamLead is launched in a runtime configuration with proven shell/Paseo CLI capability. Do not infer this from mode names alone; OpenCode/Claude/Codex modes are provider-specific permission or behavior presets.
- TeamLead prompt includes the selected playbook plus explicit authority to run `paseo run`, `paseo wait`, `paseo logs`, and `paseo chat`.
- A smoke test proves TeamLead can spawn at least one child teammate via `paseo run` and report its agent id/output.
- Pluto does not call `createWorkerSession` in the TeamLead-direct path except as a documented fallback for runtime configurations without shell/Paseo CLI access.

Local proof recorded:

- `paseo provider ls` reports provider-specific modes; these are not the architecture primitive.
- Parent TeamLead-style agent `7d255247-013e-4317-a2a7-c2ffde546c0a` spawned child agent `3c281e0a-0f6e-4d61-b0dc-24dd2a6bc6fa` with `paseo run`, proving the important capability: a TeamLead can invoke Paseo CLI to create teammates.
- Child returned `CHILD_AGENT_OK`.

### Stage D — Add coordination channel / transcript abstraction

Purpose: create a shared substrate that can prove TeamLead decisions.

Acceptance:

- Every team-led run creates or selects a coordination channel.
- Prefer `paseo chat` rooms when available.
- Provide a file-backed transcript fallback if needed.
- Transcript includes task ID, playbook ID, TeamLead messages, stage requests, stage outputs, evaluator verdicts, and final reconciliation.
- Evidence includes transcript path or durable transcript refs.

### Stage E — Introduce structured TeamLead protocol over room/transcript

Purpose: make TeamLead decisions structured and inspectable while TeamLead directly uses Paseo CLI where possible.

Protocol principle:

- TeamLead authors structured decisions in the room/transcript.
- TeamLead executes `paseo run` / `paseo wait` / `paseo logs` directly for teammate lifecycle when its runtime/tool permissions allow it.
- Pluto validates the transcript, budget/time/idempotency, and final evidence from outside the team.
- Pluto executes mechanical spawn operations only in fallback runtime configurations where TeamLead cannot access Paseo CLI.
- Room/transcript is the source of truth.

Acceptance:

- Generator cannot run before planner stage output exists when default playbook declares that dependency.
- Evaluator cannot run before generator output exists.
- Duplicate TeamLead spawn requests are idempotent.
- No legacy marker regex path is used in the new team-led path.
- Underdispatch fallback is disabled or explicitly marked invalid for the team-led path.

### Stage F — Add revision loop and stronger live smoke

Purpose: prove harness-style evaluator feedback, not just independent worker completion.

Acceptance:

- Evaluator `FAIL` triggers TeamLead-directed generator revision.
- Revision is bounded by playbook max rounds.
- Successful rerun produces final TeamLead summary that cites planner contract, generator output, evaluator verdict, and transcript ref.
- Max-round failure produces explicit escalation evidence.

### Stage G — Retire or quarantine marker protocol

Purpose: avoid two permanent control planes.

Acceptance:

- Marker protocol is either removed from the live path or clearly labelled legacy/fallback.
- Main live smoke uses room/transcript-backed TeamLead orchestration.
- Tests fail if planner/generator/evaluator are independent parallel contributors with no dependency chain.
- Tests include a non-default playbook to prove planner/generator/evaluator is only the default, not hard-coded.

## 8. Summary

| Dimension | Current | Target | Gap |
|-----------|---------|--------|-----|
| Orchestration owner | Pluto (TeamRunService) | TeamLead | **Critical** |
| Coordination substrate | None (marker parsing) | Paseo room/channel | **Critical** |
| Playbook usage | None (governance record only) | Authored data passed to lead | **Critical** |
| Dependency chain | None (parallel workers) | Planner→Generator→Evaluator | **High** |
| Revision loop | None (fails on evaluator error) | TeamLead-managed retry | **High** |
| Evidence completeness | Worker outputs + summary | + room transcript + dependency proof | **Medium** |

The current code is functional but implements a fundamentally different architecture than the target. Live smoke passes but doesn't verify the key differentiator: TeamLead ownership of orchestration. The remediation plan adds instrumentation first (to detect the gap), then introduces the playbook model, then transitions to room-based coordination, and finally enforces TeamLead orchestration.
