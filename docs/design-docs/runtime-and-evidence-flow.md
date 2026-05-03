# Runtime and Evidence Flow

Canonical reference: `docs/design-docs/agent-playbook-scenario-runprofile.md`.

## Runtime boundary

Pluto is the harness for the v1.6 runtime: it loads the four YAML layers, renders role
prompts, materializes the mailbox/task-list state, launches the team, runs validation,
and emits the evidence packet.

The execution spine is **not** marker parsing or synthesized routing. It is the
combination of:

- `mailbox.jsonl` — append-only mirrored mailbox log
- `tasks.json` — shared task list and state machine
- hook outcomes — active control points
- acceptance command results — explicit validation

## Manager-run harness path (v1.6)

1. Load Agent + Playbook + Scenario + RunProfile YAML.
2. Validate references, required reads, caps, and runtime policy.
3. Render team-lead and member prompts in canonical stack order.
4. Materialize workspace plus run directory.
5. Create the mirrored mailbox log and shared task list.
6. Launch the team lead and bind the target live mailbox transport through paseo chat
   after `agent-teams-chat-mailbox-runtime` Stage B.
7. Create tasks in the shared task list and persist task transitions.
8. Exchange teammate coordination through typed mailbox messages, including TeamLead-driven `spawn_request`, `worker_complete`, and `final_reconciliation` envelopes in the default chat-backed path.
9. Run `TaskCreated`, `TaskCompleted`, and `TeammateIdle` hooks.
10. Process plan-approval request/response messages when teammates need permission
    elevation.
11. Run acceptance commands and audit validation.
12. Emit the EvidencePacket with file, mailbox, task, and command lineage.

## Audit middleware contract

Three observable surfaces must agree:

- **Files**: required artifacts and required sections.
- **Mailbox**: teammate-authored messages, FINAL summary, plan-approval and control-plane
  exchanges when applicable.
- **Task list**: required roles, dependency completion, task status transitions.

Validation is fail-closed. Pluto does not treat a prose summary as sufficient when the
mirrored mailbox or task list disagrees.

## EvidencePacket shape

The v1.6 EvidencePacket records:

- resolved authored stack (`playbook`, `scenario`, `runProfile`)
- status and summary
- artifact refs
- command results
- transitions derived from task state changes and final reconciliation flow
- role citations derived from teammate completion messages and FINAL summary references
- lineage including:
  - `mailboxLogPath`
  - `taskListPath`
  - `stdoutPath` / `finalReportPath` when present
  - `acceptanceOk`
  - `auditOk`

## Mailbox and task-list lineage

`mailbox.jsonl` is the durable, replayable message log for the run. Target after
`agent-teams-chat-mailbox-runtime` Stage B: live paseo chat is a transport, not the
final evidence store.

`tasks.json` is the durable task ledger. It records task ids, dependency edges,
assignment/claim state, and pending → in_progress → completed transitions.

Together they provide the canonical runtime proof surface for orchestration.

`PLUTO_DISPATCH_MODE=teamlead_chat` is the default execution path. `PLUTO_DISPATCH_MODE=static_loop` preserves the legacy one-release fallback while the chat-driven path hardens.

## Run lifecycle states

```text
pending -> running -> succeeded
                   -> failed
                   -> failed_audit
                   -> cancelled
```

Task-level lifecycle is independent and simpler:

```text
pending -> in_progress -> completed
```

## Downstream flow

```text
Playbook -> Scenario -> RunProfile -> Run -> EvidencePacket -> Document / Review / Approval / PublishPackage
```

Documents and approvals consume the sealed evidence packet. They do not reconstruct truth
from provider sessions or adapter-private diagnostics.
