# Runtime and Evidence Flow

Canonical reference: `docs/design-docs/agent-playbook-scenario-runprofile.md`.
PM Space context: [Run, Audit Middleware & Evidence Packet Model](https://ocnb314kma1f.feishu.cn/wiki/V4mcwu6DmiYim1kEhI2cd8G3nMb),
[Runtime Adapter & Provider Contract](https://ocnb314kma1f.feishu.cn/wiki/IhdDwIqlwi0PpfkTUxEcz6v1nGe),
and [Portable Workflow Contract](https://ocnb314kma1f.feishu.cn/wiki/G4Y8w2cgliV7v7kdosfcAxeWnHd).

## Runtime boundary

Pluto is the harness and observer. In the v1.5 mainline, the `team_lead` Agent owns
orchestration end-to-end: it reads per-role `paseo run` command templates from its
rendered prompt, spawns workers directly via `paseo run --detach --json`, and
coordinates via `paseo wait` / `paseo logs`. Pluto materializes the workspace, hands
the lead its rendered prompt, then observes — it does not bridge.

Legacy marker requests and the v1 lead-intent compatibility bridge remain quarantined
fallback lanes only.

This boundary keeps responsibilities clear. Pluto loads and validates the four
YAML layers, renders prompts, enforces gates, launches the team lead, observes
contracted surfaces, runs acceptance commands, validates artifacts, redacts
evidence, and emits an EvidencePacket. The team lead decides how to execute the
Playbook workflow narrative and emits `STAGE:` / `DEVIATION:` lines for Pluto to
observe.

## Manager-run harness path (v1.5 mainline)

1. Load Agent + Playbook + Scenario + RunProfile YAML.
2. Validate references: Playbook members exist as Agents, Scenario references
    the Playbook, RunProfile is launch-compatible, and required roles can be
    rendered.
3. Validate caps and hard constraints, including `knowledge_refs` max 3 refs,
    8k tokens total, and 4k per ref.
4. Render the `team_lead` system prompt in canonical stack order:
    Agent.system, Available Roles + Spawn Commands, Playbook workflow, Scenario
    specialization/knowledge/rubric where applicable, then Task last.
5. Render member prompts in the same stack order, without Available Roles or
    Workflow. Members do not receive the team roster or orchestration narrative.
6. Apply pre-launch gates and fail-closed runtime policy checks before
    materializing workspace state.
7. Verify repo required reads stay contained to the declared repo root.
8. Materialize the supported workspace/run directories (but do NOT pre-write
    status/task-tree/artifact files — those are produced by the lead/workers).
9. Launch `team_lead` via
    `paseo run --detach --json --provider <agent.provider> ...`, passing the
    rendered prompt (including per-role spawn command templates) and the transcript
    / coordination handle.
10. Observe the lead's stdout/transcript for `STAGE: <from> -> <to>` and
    `DEVIATION: <reason>` lines emitted directly by the lead.
11. Discover spawned worker agents via `paseo ls --label parent_run=<runId>`.
12. Capture each spawned worker's logs/output for evidence (via `paseo logs <id>`).
13. Wait for the lead to exit (configurable via
    `RunProfile.runtime.lead_timeout_seconds`, default ≥ 600s).
14. After `team_lead` exits, run `RunProfile.acceptance_commands`; honor
    `blocker_ok` flags while still recording the result.
15. Validate `RunProfile.artifact_contract.required_files` and each declared
    `required_sections` entry.
16. Validate `RunProfile.stdout_contract.required_lines` against team-lead
    stdout.
17. Validate observed STAGE/DEVIATION events and final-report citations against
    `Playbook.audit.required_roles` and `final_report_sections`.
18. Validate revision-loop count against `Playbook.audit.max_revision_cycles`.
19. Apply redaction per `RunProfile.secrets` and security policy.
20. Emit an EvidencePacket aggregating observed events, worker discovery data,
    file checkpoints, command outputs, stdout matches, revision summary,
    redaction summary, and audit status.

## Audit middleware contract

Three observable surfaces must agree:

- **Files**: every required file exists and contains required sections.
- **Stdout**: every required line or regex appears in team-lead stdout.
- **Workflow/deviation trace**: the lead emits `STAGE: <from> -> <to>` and
  `DEVIATION: <reason>` lines in its stdout; Pluto observes those directly and
  validates that each `audit.required_roles` entry has a corresponding STAGE
  transition.

Validation is fail-closed. Missing any required file, required section, stdout
match, event citation, required role citation, or justified deviation marks the
Run `failed_audit` unless a more specific terminal status applies. A successful
claim by the team lead is not enough; the three surfaces must support the
claim.

Audit is enforced by RunProfile and minimal Playbook audit side-data. The
Playbook workflow remains a natural-language narrative. It is not a DAG and is
not an execution graph for Pluto to schedule.

## Stacking caps

- `knowledge_refs`: max 3 refs, 8k tokens total, 4k per ref. Overflow fails
  closed before launch.
- Revision cycles: capped by `Playbook.audit.max_revision_cycles`. Exceeding
  the cap fails audit even if the final artifact looks usable.
- Required reads: missing or unreachable required reads block launch unless a
  policy explicitly allows proceeding.
- Secrets: secret values must not be serialized into prompts, EvidencePackets,
  downstream governance records, exports, or audit summaries.

## EvidencePacket schema

EvidencePacket is the sealed audit-lineage object for a Run. Its required shape
is:

- `id`
- `run_id`
- `playbook_id`
- optional `scenario_id`
- `run_profile_id`
- `agent_versions[]`
- `events[]`
- `file_checkpoints[]`
- `stdout_matches[]`
- `command_results[]`
- `revision_summary`
- `redaction_summary`
- `audit_status`
- `downstream_refs[]`
- `created_at`
- `sealed_at`

Status values are `success`, `failed_audit`, `failed_command`, and
`failed_artifact`. A cancelled or pre-launch-blocked Run may still emit failure
evidence when policy requires diagnosability, but it must not be represented as
successful evidence.

EvidencePackets are sealed and immutable after emission. Redaction is
irreversible. Downstream Document, Version, Review, Approval, PublishPackage,
compliance, and audit-export records attach by `evidence_packet_id`; they do
not recompute Run truth from raw logs or provider sessions.

## Quarantined fallback lanes

### Legacy marker bridge (TeamRunService)

`TeamRunService` in `src/orchestrator/team-run-service.ts` predates the
manager-run harness and uses marker-based dispatch. That older model treated
Pluto as a deterministic dispatcher that reacted to marker requests from a lead
session and launched workers on the lead's behalf. It is quarantined for
backward compatibility only.

### v1 lead-intent compatibility bridge

In the v1 fallback lane, adapters surface lead delegation intent to Pluto as
`worker_requested` events; Pluto performs the mechanical worker launch/spawn
fallback. Workflow/deviation reporting is synthesized from routing decisions
rather than observed from real STAGE/DEVIATION events. This lane is quarantined
for backward compatibility only. New development should target the v1.5
team-lead-owned orchestration model.

## Run lifecycle states

```text
queued -> launching -> running -> paused_for_gate -> validating -> completed
                                                -> failed_audit
                                                -> failed_command
                                                -> failed_artifact
                                                -> cancelled
```

- `queued`: launch request exists but has not begun.
- `launching`: Pluto is validating layers, gates, reads, and worktree setup.
- `running`: team lead is executing through Paseo.
- `paused_for_gate`: a manual or policy gate is waiting for an explicit decision.
- `validating`: team lead has exited and Pluto is running commands and contract
  checks.
- `completed`: EvidencePacket audit status is `success`.
- `failed_audit`: contracted evidence is missing, inconsistent, unredacted, or
  over revision cap.
- `failed_command`: an acceptance command failed and was not marked
  `blocker_ok`.
- `failed_artifact`: required artifacts or sections are absent or invalid.
- `cancelled`: launch or execution was cancelled; any emitted evidence must
  show cancellation rather than success.

## Pluto's runtime responsibilities (bounded)

Pluto's runtime responsibility mirrors the canonical model:

1. Load Agent + Playbook + Scenario + RunProfile.
2. Validate references, caps, and required reads.
3. Render team-lead and member prompts according to the canonical stack order,
   including per-role spawn command templates for the lead.
4. Fail closed on unsupported runtime policy before workspace materialization.
5. Materialize the supported workspace/run directories.
6. Launch team lead via `paseo run --detach --json --provider <agent.provider>
   ...`, passing the rendered system prompt and transcript / coordination
   handle.
7. Observe the lead's stdout/transcript for STAGE/DEVIATION events; discover
   spawned workers via `paseo ls --label parent_run=<runId>`.
8. After team lead exits, run `RunProfile.acceptance_commands` and validate
   `artifact_contract`, `stdout_contract`, observed STAGE/DEVIATION events,
   final-report citations, and revision cap.
9. Emit an EvidencePacket aggregating observed transitions, worker discovery
   data, file checkpoints, command outputs, stdout matches, final-report
   citations, revision summary, and redaction summary.

Pluto must not silently heal missing evidence by trusting the final summary. It
must not expose raw provider sessions as decision-grade evidence. It must keep
runtime-specific state behind adapters.

## Downstream flow

The downstream governance flow is:

```text
Playbook -> Scenario -> RunProfile -> Run -> EvidencePacket -> Document / Review / Approval / PublishPackage
```

Documents and Versions may incorporate artifacts or summaries from a Run, but
their governance lineage comes from the EvidencePacket. Reviews and Approvals
cite the EvidencePacket they considered. PublishPackages include EvidencePacket
refs as readiness inputs and audit-export anchors.
