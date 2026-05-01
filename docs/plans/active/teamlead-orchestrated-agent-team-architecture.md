# Plan: TeamLead-orchestrated agent team architecture

## Status

Status: Active

## Problem statement

Current Pluto live smoke can run real Paseo/OpenCode agents, but the architecture is not yet the intended Agent Teams architecture.

Before iteration `pluto-regression-fix-20260501`, Pluto's TypeScript `TeamRunService` was still the real dispatcher:

- Pluto started a lead session.
- The lead emitted legacy marker lines for downstream roles.
- Pluto parsed those markers and started planner/generator/evaluator sessions itself.
- Pluto collected worker outputs and sent a final `SUMMARIZE` message to the lead.

That baseline proved real agents can run, but it was closer to a marker-based adapter protocol than to a true team-led orchestration model.

## Intended architecture

Pluto should prepare the environment and submit the task to the TeamLead. After that handoff, the TeamLead should own orchestration of the team.

The orchestration flow must be **playbook-driven and customizable**. Planner → generator → evaluator is the default playbook, not a hard-coded universal workflow. Users or product workflows must be able to author different playbooks for different situations, and Pluto should hand the selected playbook to TeamLead as part of the task context.

Pluto responsibilities:

- Prepare workspace, runtime configuration, provider/model, budget/safety gates, and evidence/log storage.
- Create or select the Paseo daemon target (`PASEO_HOST` when needed; local daemon/socket otherwise).
- Create a shared coordination substrate when needed, such as a Paseo chat room/channel.
- Submit the task to the TeamLead with enough context, constraints, and acceptance criteria.
- Observe events, persist evidence, enforce outer timeouts/safety, and surface final status.
- Start TeamLead in a runtime configuration that can execute shell/Paseo CLI commands. This capability is not semantically tied to a provider mode named `orchestrator`; provider modes are provider-specific permission/behavior presets.

TeamLead responsibilities:

- Interpret the selected playbook and decompose the task accordingly.
- For the default playbook, direct planner → generator → evaluator in sequence.
- For custom playbooks, follow the authored stages, roles, dependencies, review gates, and revision rules.
- Use upstream stage output as downstream contract/input where the playbook defines dependencies.
- Decide whether to request revisions or produce the final summary.
- Own the flow and state transitions inside the team, rather than relying on Pluto to dispatch each worker via marker parsing.
- Spawn teammates directly through Paseo where possible, for example by running `paseo run ...` from the TeamLead agent environment.
- Use `paseo chat` room commands to coordinate and leave a durable transcript when the playbook requires multi-agent collaboration.

Expected high-level flow:

1. Pluto creates run workspace for live-smoke validation under `/Volumes/AgentsWorkspace/tmp/pluto-regression-fix/live-quickstart/` by default for this regression-fix iteration, so humans can inspect artifacts outside the repo.
2. Pluto creates/identifies a Paseo coordination room/channel for the run.
3. Pluto starts TeamLead and submits the task plus room/channel reference.
4. TeamLead orchestrates according to the selected playbook:
   - Planner produces a plan/contract.
   - Generator implements or produces the requested artifact based on planner output.
   - Evaluator reviews generator output against the plan/contract.
   - If evaluator fails the result, TeamLead loops back to generator with concrete feedback.
   - If evaluator passes, TeamLead writes final synthesis.
5. Pluto records events/evidence and verifies that the observed run matches the intended team-led flow.

## Current implementation gap

- Authored `TeamPlaybookV0` selection is wired end-to-end and a non-default research-review playbook proves the flow is not hard-coded in `TeamRunService`.
- Every run now creates a deterministic file-backed coordination transcript, and evidence stores the nested `orchestration.transcript` ref shape only.
- The default `teamlead_direct` lane enforces planner → generator → evaluator dependency order with `dependencyTrace` evidence and deterministic final-citation validation.
- Evaluator `FAIL:` verdicts now drive a bounded revision loop with structured revision and escalation evidence.
- The legacy marker lane is quarantined behind `lead_marker`; it remains available for backward-compat and smoke coverage only.
- Live/Paseo chat room wiring and true TeamLead-owned host spawning remain future work; the current transcript is the durable bridge substrate under `.pluto/runs/<runId>/coordination-transcript.jsonl`.
- Existing live smoke now proves playbook selection, transcript presence, dependency ordering, and final citation checks, but it does not yet prove Paseo chat room use or agent-driven child spawning from the TeamLead runtime.

## Iteration `pluto-regression-fix-20260501` outcome

Shipped in this iteration:

- `TeamPlaybookV0` contract with stages, dependencies, revision rules, and final citation metadata.
- Default `teamlead-direct-default-v0` planner → generator → evaluator playbook.
- Non-default `teamlead-direct-research-review-v0` playbook selectable via `TeamTask.playbookId`.
- File-backed coordination transcript abstraction persisted as `coordination-transcript.jsonl`.
- `run_started`, `coordination_transcript_created`, `artifact_created`, `run_completed`, and `evidence.json` carry playbook id, orchestration source/mode, dependency trace, revision/escalation state, final reconciliation, and the nested transcript ref.
- Live adapter TeamLead prompt receives the selected playbook and transcript/room details plus explicit authority to use `paseo run`, `paseo chat`, `paseo wait`, `paseo logs`, and `paseo inspect` when shell/Paseo CLI access exists.
- The shipped `teamlead_direct` lane is a Pluto-mediated bridge: Pluto deterministically enforces the TeamLead-authored playbook and uses `spawnTeammate()` only when an adapter/runtime can honor host-side delegation. Otherwise the bridge falls back to `createWorkerSession()` while preserving transcript and evidence semantics.
- Legacy marker dispatch is labeled fallback-only in prompt/event evidence and preserved for compatibility.

Deferred from this iteration:

- First-class `paseo chat create/post/read/wait` room wiring.
- True TeamLead-owned host spawning in the live adapter/runtime instead of the Pluto-mediated bridge.
- Verifying room-backed, agent-driven coordination rather than only transcript-backed harness enforcement.
- Portable workflow export/import for non-default playbooks. `src/portable-workflow/*` remains default-playbook-only until logical refs and artifact expectations are versioned beyond `DEFAULT_TEAM_LOGICAL_REFS_V0`.

## Follow-up scope — agent-driven TeamLead host spawning

- Keep `task.orchestrationMode="teamlead_direct"` stable as the user-facing label.
- Replace the current Pluto-mediated bridge with a live adapter/runtime path that lets TeamLead own teammate spawning through `spawnTeammate()` or an equivalent room-backed host delegation seam.
- Extend live smoke to prove TeamLead-created child agents and shared-room coordination, not only harness-enforced transcript ordering.

## Reference: Claude Code Agent Teams docs 中文整理

Source: <https://code.claude.com/docs/en/agent-teams>

Relevant design points translated/summarized for Pluto:

- Agent team has a **Team Lead**. Team Lead creates the team, spawns teammates, and coordinates work.
- Teammates are separate agents with their own context windows and role-specific work.
- The Team Lead acts as the control plane for delegation, coordination, and completion.
- The useful abstraction is not just "many agents run"; it is "one lead owns a coordinated team".
- A team should have explicit task state: pending, in-progress, blocked, complete.
- Coordination should happen through a shared communication surface rather than implicit local variables inside the parent process.
- Pluto should therefore avoid treating the TeamLead as a text marker generator. The TeamLead should be the runtime-level orchestrator of planner/generator/evaluator flow.

Implication for Pluto:

- `TeamRunService` should become an outer harness/controller, not the step-by-step worker dispatcher.
- The adapter should expose a team/room-based orchestration path, likely using Paseo chat rooms plus `paseo run/send/wait/logs`.
- Tests should assert that the TeamLead caused the planner/generator/evaluator flow, not merely that Pluto observed marker lines and started workers itself.

## Reference: Anthropic long-running harness design 中文整理

Source: <https://www.anthropic.com/engineering/harness-design-long-running-apps>

Relevant design points translated/summarized for Pluto:

- Long-running agent applications need a **harness**: durable workspace, explicit state, logs, artifacts, and verifiable outputs.
- A robust pattern is planner → generator → evaluator, with roles separated rather than self-evaluation by the generator.
- Planner expands the original task into a spec/contract or sprint plan.
- Generator executes against that contract.
- Evaluator independently checks the output against acceptance criteria and produces concrete findings.
- If evaluation fails, feedback should drive another generation/revision round rather than ending immediately as an opaque failure.
- Quality improves when ambiguous objectives become explicit contracts and hard checks.
- Evidence should be persisted: messages, artifacts, issue reports, run logs, task state, and pass/fail criteria.

Implication for Pluto:

- The target run should produce a readable trace of planner contract, generator output, evaluator verdict, and TeamLead reconciliation.
- Final success should require evidence that the generator used planner output and evaluator reviewed generator output.
- The TeamLead should manage the revision loop, while Pluto stores evidence and enforces outer guardrails.

## Required design direction

Add a true TeamLead-orchestrated runtime path instead of extending the marker protocol indefinitely.

Updated 2026-05-01: for this regression-fix iteration, the default live-smoke / Paseo orchestrator validation workspace is `/Volumes/AgentsWorkspace/tmp/pluto-regression-fix/live-quickstart/`, not the prior repo-local live-smoke path.

Add a playbook model that is passed to TeamLead at run start. The playbook should be authored data/instructions, not TypeScript control-flow hardcoded into `TeamRunService`. The default playbook can be planner → generator → evaluator, but the platform must support custom playbooks such as research-only, code-review-only, implementation-with-two-reviewers, documentation generation, release-readiness, incident triage, or user-defined role graphs.

Possible implementation shape:

- Introduce a new adapter path or adapter, e.g. `PaseoRoomTeamAdapter`.
- Use `paseo chat create <room>` for each run.
- Pass the room id/name to TeamLead.
- Pass the selected playbook to TeamLead, including stages, roles, dependencies, stop conditions, evidence expectations, and revision rules.
- Start TeamLead with shell/Paseo CLI access. The orchestration capability comes from the agent being able to execute `paseo run/chat/wait/logs`, not from any specific mode label. OpenCode's `orchestrator` mode is an Oh My OpenCode / OpenCode-specific preset, while Claude-style modes are permission/plan/build-style presets; both can orchestrate if the agent can run the Paseo CLI.
- TeamLead posts instructions/status to the room and uses it as the shared coordination channel.
- TeamLead directly spawns planner/generator/evaluator or other playbook-defined teammates with `paseo run`, waits/inspects them with `paseo wait/logs/inspect`, and posts stage outputs or references back to the room.
- A minimal Pluto bridge should be treated as fallback only. The preferred architecture is TeamLead-direct spawning, because a TeamLead is itself a Paseo-run agent and can invoke Paseo CLI.
- Persist room messages into Pluto run events/evidence.
- Require a final TeamLead reconciliation message that cites planner output, generator output, and evaluator verdict.

Important distinction:

- Preferred path: TeamLead directly performs `paseo run` / `paseo chat` operations from its own agent environment.
- Acceptable only as a transitional fallback: Pluto may perform mechanical `paseo run` calls if a runtime configuration lacks shell/Paseo CLI access, but TeamLead must own the orchestration decisions and state through the room/channel.
- Not acceptable as final architecture: Pluto independently decides worker order and dispatches workers from hardcoded marker parsing while TeamLead only emits legacy marker lines.

## Testing expectations

Keep live test artifacts under the external regression-fix workspace for this iteration:

- Preferred live workspace: `/Volumes/AgentsWorkspace/tmp/pluto-regression-fix/live-quickstart/`
- `docker/live-smoke.ts` still falls back to `<repo>/.tmp/live-quickstart/` when `/Volumes/AgentsWorkspace/` is unavailable or not writable.

Future live smoke should verify:

- A Paseo room/channel is created or selected for the run.
- TeamLead posts/coordinates through that room/channel.
- The selected playbook is visible in TeamLead context and reflected in room messages/events.
- Planner output exists and is referenced by generator.
- Generator output exists and is referenced by evaluator.
- Evaluator verdict exists and is referenced by TeamLead final summary.
- Failure verdicts trigger a TeamLead-managed revision loop or an explicit TeamLead escalation.
- Evidence files include the room transcript or durable references to it.

## Acceptance criteria for this architecture change

- Documentation clearly states that Pluto prepares the run and hands control to TeamLead.
- Documentation and contracts clearly state that orchestration is playbook-driven; planner → generator → evaluator is only the default playbook.
- A playbook can be authored/configured without changing `TeamRunService` control flow.
- The live adapter has a room/channel-backed orchestration path, or a documented bridge where TeamLead remains the source of truth.
- Tests fail if planner/generator/evaluator run as independent parallel contributors with no dependency chain.
- Tests can run at least one non-default playbook to prove the flow is not hard-coded.
- Tests fail if TeamLead final output does not cite planner contract, generator result, and evaluator verdict.
- Live smoke remains inspectable under `/Volumes/AgentsWorkspace/tmp/pluto-regression-fix/live-quickstart/` for this iteration.

## Open questions

- What exact TeamLead prompt/playbook contract makes TeamLead reliably use `paseo run` and `paseo chat` without reverting to prose-only planning?
- Which provider/runtime configurations grant direct Paseo CLI spawning strongly enough for production use? This should be validated as a shell/tool permission capability, not inferred from mode names.
- If a runtime configuration cannot directly spawn agents, what is the cleanest fallback bridge protocol that keeps TeamLead as the decision owner while Pluto only performs mechanical spawning?
- What should the first portable playbook schema look like, and should it live in governance/catalog alongside role definitions?
- Should the room transcript become part of `EvidencePacketV0`, or should evidence reference a separate room transcript artifact?
- How many evaluator→generator revision rounds should live smoke allow before escalating?

## Paseo capability notes

Verified locally on 2026-05-01:

- `paseo provider ls` reports provider-specific modes. These mode labels are not the source of TeamLead orchestration capability; they are provider-specific permission/behavior presets.
- TeamLead orchestration capability is simply that the TeamLead agent can execute `paseo run`, `paseo chat`, `paseo wait`, and `paseo logs` from its environment.
- A TeamLead-style agent launched through `paseo run` successfully spawned a child agent with `paseo run --provider opencode --model opencode/minimax-m2.5-free ...`.
- Parent smoke agent: `7d255247-013e-4317-a2a7-c2ffde546c0a`.
- Child agent spawned by the parent: `3c281e0a-0f6e-4d61-b0dc-24dd2a6bc6fa`, which returned `CHILD_AGENT_OK`.
- `paseo chat` supports `create`, `post`, `read`, and `wait`, all with `--host`, so the TeamLead can create/use a run room as the coordination substrate.

Updated implication: the target should not assume Pluto must bridge spawning, and should not tie orchestration to an OpenCode mode label. The first-class target is TeamLead-direct orchestration using Paseo CLI, with Pluto acting as harness/observer.

## Gap review record

Detailed OpenCode Companion review plus independent `@oracle` and `@council` synthesis is recorded in:

- `docs/plans/active/opencode-agent-teams-gap-review.md`

That review confirms the current implementation is a marker-based Pluto dispatcher and recommends the staged path: explicit playbook contract → shared coordination channel/transcript → TeamLead-direct Paseo orchestration with fallback bridge only when needed → revision loop → marker protocol retirement/quarantine.
