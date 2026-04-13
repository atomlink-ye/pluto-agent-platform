# 002 — Minimum Stable Core

## Purpose

Deliver the first implementation slice that validates the product model: a governed run can be created from a playbook, observed by an operator, paused by approval, and completed with durable artifacts. This plan proves the playbook / harness / run model works end to end before expanding scope.

## Scope

- Playbook CRUD and listing
- Harness CRUD and attachment to playbook
- Run creation, lifecycle state machine, and durable persistence
- Run Plan compilation from playbook + harness
- Run Event append-only log
- EnvironmentSpec and RunSession boundaries sufficient for recovery
- Effective policy snapshot at run creation
- Durable approval tasks linked to runs
- Durable artifact registration linked to runs
- Postgres-backed storage for all product objects
- Operator-facing playbook list, run list, and run detail views

## Non-goals

- Broad enterprise administration or RBAC
- Full DAG/BPM graph authoring
- Advanced analytics beyond basic operator visibility
- Multi-surface parity
- Rich team orchestration modes (supervisor-led, shared-room)
- Trigger/webhook system

## Authority references

- `ARCHITECTURE.md` — module layout, source-of-truth rules, execution authority boundary
- `docs/product-specs/product-and-scope.md` — minimum reference scenario, product invariants
- `docs/product-specs/core-domain-model.md` — all object definitions and boundaries
- `docs/product-specs/operator-flows.md` — V1 page set and flow expectations
- `docs/contracts/*.md` — field-level contracts for each domain object
- `docs/design-docs/execution-model.md` — playbook/harness/run relationship

## Actors

| Actor | Description | Authority |
|---|---|---|
| Operator | Engineer managing agent runs through the platform UI | Create playbooks, start runs, resolve approvals, inspect artifacts |
| System (control plane) | The platform's run lifecycle engine | Compile run plans, enforce harness rules, register events, project state |
| Runtime (Paseo kernel) | The underlying agent execution runtime | Execute agent sessions, emit timeline events, request permissions |

---

## Feature 1: Playbook Records

### User story

> As an operator, I want to create and browse playbooks, so that I can define reusable task intent before starting any run.

### Specification

A playbook is a durable record in Postgres containing task intent fields defined in `core-domain-model.md` section 1. Playbooks must not contain harness concerns (approval policy, timeout, retry). Schema validation rejects harness-scoped fields.

- Input: playbook data with name, description, goal, instructions, inputs, artifact expectations, quality bar
- Output: persisted playbook record with generated ID and timestamps
- Error: validation failure returns structured error explaining which fields are invalid or which harness-scoped fields were present

### Deliverable standard

1. Playbook can be created with minimum required fields
2. Playbook with missing required fields is rejected with an explainable error
3. Playbook containing harness-scoped fields (approval, timeout, retry) is rejected
4. Playbooks are listed with name, description, and creation time
5. Single playbook can be retrieved by ID

### Test scenarios

#### Scenario 1.1: Create a valid playbook

- **Given:** a playbook payload with all required fields
- **When:** the playbook is submitted
- **Then:** a persisted record exists in Postgres with a generated ID, and all fields match the input

#### Scenario 1.2: Reject a playbook missing required fields

- **Given:** a playbook payload missing the `goal` field
- **When:** the playbook is submitted
- **Then:** creation fails with a validation error naming the missing field

#### Scenario 1.3: Reject harness-scoped fields in playbook

- **Given:** a playbook payload that includes an `approval_policy` field
- **When:** the playbook is submitted
- **Then:** creation fails with an error explaining that approval policy belongs to Harness

#### Scenario 1.4: List playbooks

- **Given:** three playbooks exist
- **When:** the playbook list is requested
- **Then:** all three are returned with name, description, and created timestamp

### Implementation notes

- Domain layer implemented in `packages/control-plane/src/services/playbook-service.ts`
- Validation via Zod schema in `packages/contracts/src/validation.ts` (`PlaybookCreateSchema`)
- In-memory repository; Postgres-backed repository deferred to integration phase
- 6 tests covering scenarios 1.1–1.4 plus getById and null-ID cases

### Checklist

- [x] implementation complete (domain layer)
- [x] test scenarios passing (6 tests)
- [x] deliverable standard verified
- [x] playbook contract doc consistent

---

## Feature 2: Harness Records and Attachment

### User story

> As an operator, I want to attach a governance harness to a playbook, so that runs created from it are constrained by approval rules, phase structure, and timeout expectations.

### Specification

A harness is a durable record in Postgres containing governance fields defined in `core-domain-model.md` section 2. A harness must not contain business task intent. A harness defines a phase skeleton (ordered, named phases), approval rules, timeout, retry, and evidence requirements. A harness can be attached to a playbook (many-to-one: one harness can serve multiple playbooks).

### Deliverable standard

1. Harness can be created with a phase skeleton and approval rules
2. Harness containing task-intent fields (goal, instructions) is rejected
3. Phase names within a harness are unique and ordered
4. A harness can be attached to an existing playbook
5. Playbook detail view shows the attached harness summary

### Test scenarios

#### Scenario 2.1: Create a valid harness

- **Given:** a harness payload with phases `[collect, analyze, review]` and an approval rule for the `review` phase
- **When:** the harness is submitted
- **Then:** a persisted record exists with the correct phase order and approval rules

#### Scenario 2.2: Reject duplicate phase names

- **Given:** a harness payload with phases `[collect, collect, review]`
- **When:** the harness is submitted
- **Then:** creation fails with an error naming the duplicate phase

#### Scenario 2.3: Reject task-intent fields in harness

- **Given:** a harness payload that includes a `goal` field
- **When:** the harness is submitted
- **Then:** creation fails explaining that goal belongs to Playbook

#### Scenario 2.4: Attach harness to playbook

- **Given:** an existing playbook and an existing harness
- **When:** the harness is attached to the playbook
- **Then:** retrieving the playbook includes the harness summary

### Implementation notes

- Domain layer implemented in `packages/control-plane/src/services/harness-service.ts`
- Validation via Zod schema in `packages/contracts/src/validation.ts` (`HarnessCreateSchema`)
- Phase uniqueness enforced via `superRefine`; task-intent fields rejected with "belongs to Playbook" messages
- Attachment stores `HarnessSummary` (id, name, description, phases) on the playbook record

### Checklist

- [x] implementation complete (domain layer)
- [x] test scenarios passing (4 tests)
- [x] deliverable standard verified
- [x] harness contract doc consistent

---

## Feature 3: Run Creation and Lifecycle

### User story

> As an operator, I want to start a governed run from a playbook, so that I can observe its progress through defined phases and know when it is blocked, waiting approval, or complete.

### Specification

A run is created from one playbook + one harness + concrete inputs. On creation, the system compiles an initial Run Plan from the harness phase skeleton and records an effective policy snapshot. The run transitions through lifecycle states defined in `core-domain-model.md` section 3. Only valid state transitions are allowed. Each transition appends a RunEvent to the durable event log.

Valid state transitions:

```
queued → initializing → running → waiting_approval → running → succeeded
                                                   → failed
                      → blocked → running
                      → failed
         → canceled (from any non-terminal state)
```

### Deliverable standard

1. Run is created from playbook + harness + inputs and starts in `queued`
2. Initial Run Plan is compiled with phases from the harness
3. Effective policy snapshot is recorded at creation time
4. Each state transition appends a durable RunEvent
5. Invalid state transitions are rejected (e.g., `succeeded` → `running`)
6. Run carries `failureReason` when failed and `blockerReason` when blocked
7. `EnvironmentSpec` and `RunSession` linkage is recorded when runtime sessions are established

### Test scenarios

#### Scenario 3.1: Create a run from playbook + harness

- **Given:** a playbook with harness attached and valid inputs
- **When:** a run is created
- **Then:** run exists in Postgres with status `queued`, linked to the playbook and harness, with an initial RunPlan and a policy snapshot

#### Scenario 3.2: Valid state transitions

- **Given:** a run in `running` state
- **When:** `waiting_approval` transition is triggered
- **Then:** run status is `waiting_approval` and a `run.status_changed` event is appended

#### Scenario 3.3: Invalid state transition rejected

- **Given:** a run in `succeeded` state
- **When:** a transition to `running` is attempted
- **Then:** the transition is rejected with an error explaining the invalid transition

#### Scenario 3.4: Run records failure reason

- **Given:** a run in `running` state
- **When:** the run transitions to `failed` with reason "required artifact missing"
- **Then:** run status is `failed` and `failureReason` is "required artifact missing"

#### Scenario 3.5: Event-driven state reconstruction

- **Given:** a sequence of RunEvents for a run: `created → started → phase.entered(collect) → approval.requested → approval.resolved → succeeded`
- **When:** run state is projected from events only
- **Then:** the projected state matches: status `succeeded`, all phases complete, approval resolved

### Implementation notes

- State machine in `packages/control-plane/src/services/run-state-machine.ts` encodes all 19 transitions from `run-governance.md` section 2
- RunService creates Run, RunPlan, PolicySnapshot, and appends `run.created` event atomically
- All transitions emit `run.status_changed` events with `fromStatus`/`toStatus` payload; `projectRunStateFromEvents` also handles distinct event types (`run.started`, `run.succeeded`, etc.) for forward compatibility
- `EnvironmentSpec` and `RunSession` types exist in contracts; `RunSessionRepository` interface and in-memory impl exist. Service-level session linkage deferred to runtime integration phase
- Informal transition diagram shows "canceled from any non-terminal state" but the authoritative `run-governance.md` only allows cancel from `running`, `blocked`, `waiting_approval`; implementation follows `run-governance.md`

### Checklist

- [x] implementation complete (domain layer)
- [x] test scenarios passing (6 tests)
- [x] deliverable standard verified (6 of 7; deliverable 7 — RunSession linkage — deferred to runtime integration)
- [x] run contract doc consistent (failureReason, blockerReason added to contract)
- [x] run-event contract doc consistent

---

## Feature 4: Durable Approvals

### User story

> As an operator, I want approvals to be durable and visible, so that I can review what was requested, decide, and have the run continue governed by my decision.

### Specification

When a run reaches an approval gate (defined by the harness), an ApprovalTask is created as a durable Postgres record linked to the run. The run transitions to `waiting_approval`. The approval task contains the action under review, severity, and run context. Resolution (approved/denied) is recorded durably and triggers a RunEvent. On approval, the run resumes. On denial, the run transitions to `failed` or `blocked` depending on harness rules.

### Deliverable standard

1. Approval task is created as a durable record when a run reaches an approval gate
2. Run transitions to `waiting_approval` when an approval is pending
3. Approval task is visible in the run detail view
4. Resolving an approval records the decision and resolver metadata
5. Approved → run resumes `running`; denied → run transitions to `failed` or `blocked`
6. Approval events are appended to the run event log

### Test scenarios

#### Scenario 4.1: Approval pauses run

- **Given:** a run in `running` state entering a phase with an approval rule
- **When:** the approval gate is reached
- **Then:** run status is `waiting_approval`, an ApprovalTask exists with status `pending`

#### Scenario 4.2: Approval resolution resumes run

- **Given:** a run in `waiting_approval` with a pending approval
- **When:** the operator approves
- **Then:** approval status is `approved`, run status is `running`, and `approval.resolved` event is appended

#### Scenario 4.3: Denial transitions run

- **Given:** a run in `waiting_approval` with a pending approval
- **When:** the operator denies
- **Then:** approval status is `denied`, run status is `failed` with `failureReason` referencing the denied approval

#### Scenario 4.4: Approval without prior request is rejected

- **Given:** a run in `running` state with no pending approvals
- **When:** an approval resolution is submitted
- **Then:** the resolution is rejected

### Implementation notes

- ApprovalService in `packages/control-plane/src/services/approval-service.ts`
- Approval record is saved before the run transitions to `waiting_approval` (ordered for consistency)
- Denial always transitions the run to `failed` with `failureReason: "approval denied: <id>"`. The spec mentions "or blocked depending on harness rules" but `waiting_approval → blocked` is not in `run-governance.md` allowed transitions; harness-rule-dependent denial routing deferred
- `ApprovalDecision` type added to contracts (`"approved" | "denied"`) to narrow the resolution decision

### Checklist

- [x] implementation complete (domain layer)
- [x] test scenarios passing (4 tests)
- [x] deliverable standard verified (5 of 6; deliverable 5 partial — denial always goes to `failed`, `blocked` path deferred)
- [x] approval states match `core-domain-model.md` section 8 (ApprovalDecision type added to contract)

---

## Feature 5: Durable Artifact Registration

### User story

> As an operator, I want artifacts produced during a run to be durably registered, so that I can inspect formal outputs and verify that required deliverables were produced.

### Specification

When a run produces an output matching an artifact expectation from the playbook, the control plane registers an Artifact record in Postgres linked to the run. Artifact identity and metadata are durable; payload may remain in runtime-local storage. At run completion, the system checks whether all required artifact expectations are satisfied. A run cannot transition to `succeeded` if required artifacts are missing.

### Deliverable standard

1. Artifact is registered as a durable record linked to a run
2. Artifact metadata includes type, title, producer context, and run linkage
3. Required artifacts missing at run completion block the `succeeded` transition
4. Artifacts are visible in the run detail view

### Test scenarios

#### Scenario 5.1: Register an artifact

- **Given:** a run in `running` state
- **When:** an artifact of type `retro_document` is produced
- **Then:** an Artifact record exists in Postgres linked to the run, with type and title

#### Scenario 5.2: Required artifact blocks completion

- **Given:** a playbook expects a required artifact of type `retro_document`, and the run has not registered one
- **When:** the run attempts to transition to `succeeded`
- **Then:** the transition is rejected with reason "required artifact missing: retro_document"

#### Scenario 5.3: All required artifacts present allows completion

- **Given:** a playbook expects a required artifact of type `retro_document`, and the run has registered one
- **When:** the run transitions to `succeeded`
- **Then:** the transition succeeds

### Implementation notes

- ArtifactService in `packages/control-plane/src/services/artifact-service.ts`
- All `ArtifactExpectation` entries in playbook are treated as required (no `required` flag on the type); this is an intentional V1 simplification
- `checkRequiredArtifacts` matches by `type` and optionally `format`
- Integrated into `RunService.transition` — the `succeeded` transition calls `checkRequiredArtifacts` and rejects with `"required artifact missing: <type>"` if unmet

### Checklist

- [x] implementation complete (domain layer)
- [x] test scenarios passing (3 tests)
- [x] deliverable standard verified
- [x] artifact boundary rule from `core-domain-model.md` section 9 enforced

---

## Feature 6: Operator Views

### User story

> As an operator, I want to browse playbooks, inspect runs, resolve approvals, and view artifacts through a UI, so that I can manage governed execution without reading raw logs or database records.

### Specification

The UI implements the V1 page set defined in `operator-flows.md`: Playbooks list, Playbook Detail, Runs list, Run Detail (business + governance + operator sections), Approvals surface, and Artifact sections. The UI consumes durable product-layer data from the control plane, not raw Paseo runtime streams for business objects.

### Deliverable standard

1. Playbook list shows playbooks with name, description, harness summary
2. Playbook detail shows intent, inputs, expected artifacts, quality bar, and attached harness
3. "Start Run" from playbook detail creates a run and navigates to run detail
4. Run list shows runs with status, phase, playbook, blocker indicator
5. Run list distinguishes `running`, `waiting_approval`, `blocked`, `failed`, `succeeded` visually
6. Run detail shows three sections: business (goal, inputs, summary), governance (phase, approvals, artifacts, blockers), operator (events, sessions)
7. Approval resolution is actionable from run detail
8. Artifacts are visible in run detail with type, title, and producer context

### Test scenarios

#### Scenario 6.1: Start a run from playbook

- **Given:** a playbook with an attached harness exists
- **When:** the operator opens the playbook detail and clicks "Start Run" with inputs
- **Then:** a run is created, and the operator sees the run detail view with status `queued` or `initializing`

#### Scenario 6.2: Run list shows live state

- **Given:** runs exist in states `running`, `waiting_approval`, `failed`, and `succeeded`
- **When:** the operator opens the run list
- **Then:** each run shows its status with visual distinction, and `waiting_approval` shows a blocker indicator

#### Scenario 6.3: Resolve approval from run detail

- **Given:** a run in `waiting_approval` with a visible approval card
- **When:** the operator clicks "Approve"
- **Then:** approval is resolved, run status updates to `running`, and the approval card shows `approved`

#### Scenario 6.4: Run detail shows three-layer information

- **Given:** a run with a playbook goal, active phase, one pending approval, and one registered artifact
- **When:** the operator opens the run detail
- **Then:** the business section shows the goal, governance section shows phase + approval + artifact, operator section shows event timeline

### Implementation notes

- REST API endpoints in `packages/server/src/api/app.ts`: playbooks, harnesses, runs (enriched with names), approvals, artifacts, events, health
- React frontend in `packages/app/`: Vite + React 19 + Tailwind CSS 4 + react-router-dom 7
- API client in `packages/app/src/api.ts` wraps all endpoints
- `StatusBadge` component provides visual distinction for all run, approval, and artifact statuses
- Vite dev server proxies `/api` to `http://localhost:4000`
- PlaybookDetailPage includes "Start Run" button when harness is attached
- RunDetailPage shows three sections (business, governance, operator) with approval resolution actions
- Run list enriched with `playbookName`/`harnessName` via server-side join for readable display

### Checklist

- [x] implementation complete (REST API + React UI for all V1 pages)
- [ ] test scenarios passing (E2E/integration browser tests not yet automated; manual verification)
- [x] deliverable standard verified (all 8 deliverables implemented)
- [x] page set matches `operator-flows.md` V1 requirements (Playbooks, Playbook Detail, Runs, Run Detail with approvals + artifacts)

---

## Implementation sequence

1. **Feature 1: Playbook Records** — no dependencies; establishes database foundation and first domain object
2. **Feature 2: Harness Records** — depends on Feature 1 (attachment relationship)
3. **Feature 3: Run Creation and Lifecycle** — depends on Features 1, 2 (run requires playbook + harness)
4. **Feature 4: Durable Approvals** — depends on Feature 3 (approvals are linked to runs)
5. **Feature 5: Durable Artifact Registration** — depends on Feature 3 (artifacts are linked to runs)
6. **Feature 6: Operator Views** — depends on all above (UI consumes all product objects)

Features 4 and 5 can be implemented in parallel after Feature 3.

## Evaluation gates

### Gate 1: Domain model stable — MET

- [x] Features 1, 2, 3 pass all test scenarios (16 tests)
- [x] Playbook/Harness boundary is enforced by validation
- [x] Run state machine rejects invalid transitions
- [x] RunEvents can reconstruct run state
- [x] Postgres schema is migrated and tested (25 integration tests + 5 E2E tests via Plan 003 F1)

### Gate 2: Governance objects durable — MET

- [x] Features 4, 5 pass all test scenarios (7 tests)
- [x] Approvals pause and resume runs
- [x] Required artifacts block premature completion
- [x] All governance objects are Postgres-backed (Plan 003 F1 delivered Postgres repositories)

### Gate 3: Operator surface functional — PARTIALLY MET

- [ ] Feature 6 passes all test scenarios (automated browser tests not yet set up; UI implementation complete)
- [ ] The minimum reference scenario from `product-and-scope.md` can be demonstrated end to end (requires live Paseo agent)
- [x] An operator can launch, observe, approve, and inspect without touching raw database or logs (UI pages built)

## Completion criteria

The plan is complete when all of the following are true:

- all six features pass their deliverable standard
- all test scenarios pass
- the minimum reference scenario runs end to end
- `ARCHITECTURE.md`, `core-domain-model.md`, `operator-flows.md`, and all contracts remain consistent with the implementation
- no terminology drift back to old workflow language
