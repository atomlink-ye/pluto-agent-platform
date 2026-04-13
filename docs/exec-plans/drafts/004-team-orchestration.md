# 004 — Team Orchestration (DRAFT)

> **Status**: Draft — refined after Oracle/Council review on 2026-04-14. Recommended Phase 2 scope is a supervisor-led team orchestration slice only.

## Purpose

Extend the minimum stable core with the smallest coherent multi-role execution slice. After plans 002 and 003, governed runs exist with a single lead agent and live runtime integration. This plan adds reusable role/team records, run-time team resolution, lead-to-worker delegation, contract-aligned handoff events, and minimal operator visibility without introducing richer coordination modes.

## Scope

- RoleSpec durable records, validation, CRUD, and listing
- TeamSpec durable records with role references, validation, CRUD, and listing
- Playbook team preference resolution at run creation; resolved team recorded on Run
- Supervisor-led team-aware Run Compiler
- Lazy role-session creation on accepted handoff, with RunSession binding per role
- Contract-aligned handoff events and run-plan mutation on delegation
- Minimal operator visibility in the existing run detail view (team summary, active role sessions, handoff timeline)
- Harness approvals and artifact requirements continuing to govern delegated work

## Non-goals

- Coordination modes beyond `supervisor-led` (`pipeline`, `shared-room`, `committee`)
- Worker-to-worker lateral delegation or mailbox-like coordination surfaces
- Pre-spawning one session per role at run start
- Generalized replan semantics or parallel stage generation beyond the initial supervisor-led slice
- Shared-room collaboration, room events, or heartbeat scheduling
- Advanced worktree policies beyond `per-run`
- Dedicated Team view or role-scoped artifact UI beyond existing run detail extensions

## Authority references

- `ARCHITECTURE.md` — execution authority boundary, source-of-truth rules, coordination domain
- `PLANS.md` — plan/scope discipline
- `docs/design-docs/execution-model.md` — playbook/harness/run/team-orchestrator relationship
- `docs/product-specs/core-domain-model.md` sections 11–12 — RoleSpec and TeamSpec product semantics
- `docs/contracts/role-and-team-contract.md` — canonical RoleSpec and TeamSpec shapes
- `docs/contracts/playbook-contract.md` — Playbook `team` preference contract and attachment boundary
- `docs/contracts/run-contract.md` — Run and RunSession fields for resolved team/session linkage
- `docs/contracts/run-event-contract.md` — contract-aligned handoff and coordination event names
- `.local/refDoc/product-redesign/reference/design-02.md` — reference team orchestration model
- `.local/refDoc/product-redesign/reference/test-design-04.md` — Stage 2 orchestration behavior tests

## Review decisions recorded for this draft

1. **Phase 2 scope should be narrower than the original draft.** This plan now targets one end-to-end slice: supervisor-led orchestration with durable role/team records, lead handoff, worker execution, and operator visibility.
2. **Coordination modes beyond supervisor-led are deferred.** `pipeline`, `shared-room`, and `committee` each imply different plan compilation, recovery, and UI semantics and are not part of this phase.
3. **RoleSpec/TeamSpec do not attach to Playbook using the same pattern as Harness.** Playbook continues to use its existing `team` preference field. The actual TeamSpec is selected or resolved at run creation and recorded on the Run.
4. **Multi-agent architectural risk is bounded by keeping Postgres and RunEvents authoritative.** The orchestrator may decide at run time, but role/session linkage, handoff facts, and plan mutation must remain durable and operator-visible.
5. **The handoff model is simplified for Phase 2.** This plan uses `handoff.created`, `handoff.accepted`, and `handoff.rejected` from the Run Event contract. Completion is inferred from stage/session/artifact events rather than a separate `handoff.completed` event.
6. **Only the Stage 2 reference scenarios that fit the narrowed slice are included.** Initial run-plan generation, formal handoff behavior, approval continuity, and artifact enforcement are in scope. Multi-mode comparison, generalized replan behavior, and broader parallel-stage semantics are deferred.

## Phase 2 risks and bounds

- **Authority drift risk** — orchestration decisions must not live only inside prompts or runtime-local state. Every delegation that changes execution must result in a durable RunEvent and RunPlan mutation.
- **Recovery complexity risk** — multiple runtime sessions increase resume/rebind complexity. To bound this, the run starts with the lead session only; worker sessions are created lazily on accepted handoff.
- **Governance ambiguity risk** — delegation must not bypass Harness approvals, evidence, or artifact requirements. Those rules stay run-scoped and phase-scoped.
- **UI drift risk** — operator surfaces should only expose contract-backed team/session/handoff state, not speculative coordination concepts.

## Actors

| Actor | Description | Authority |
|---|---|---|
| Operator | Engineer configuring teams and observing supervisor-led runs | Create roles/teams, start team runs, inspect role-level state |
| Lead Agent | The supervisory agent spawned by the Run Compiler | Decide delegation, initiate handoffs, coordinate worker roles |
| Role Agent | A specialized worker agent spawned on accepted handoff | Execute role-scoped tasks and return work within Harness boundaries |
| Control Plane | The platform's run lifecycle engine | Resolve team config, spawn sessions, track handoffs, enforce governance |

---

## Feature 1: RoleSpec Records

### User story

> As an operator, I want to define reusable role specifications, so that I can describe agent responsibilities independently of specific playbooks or runs.

### Specification

A RoleSpec is a durable Postgres record matching `role-and-team-contract.md`. RoleSpec defines a responsibility profile with: stable role ID, name, description, system prompt, tool policy, provider preset, memory scope, isolation preference, and background suitability.

### Deliverable standard

1. RoleSpec can be created with the contract-required identifying fields
2. RoleSpec is listed and retrievable by ID
3. RoleSpec validation rejects governance-scoped fields (approvals, timeouts, artifact rules)
4. Optional fields (`system_prompt`, `tools`, `provider_preset`, `memory_scope`, `isolation`) persist correctly

### Test scenarios

#### Scenario 1.1: Create a valid role
- **Given:** a role payload with stable ID `researcher`, name `Researcher`, and description `Gathers information`
- **When:** the role is submitted
- **Then:** a persisted record exists with correct fields

#### Scenario 1.2: Reject invalid role fields
- **Given:** a role payload that includes an approval or timeout field
- **When:** the role is submitted
- **Then:** creation fails with an error explaining that governance belongs to Harness or higher-level policy

#### Scenario 1.3: List roles
- **Given:** three roles exist
- **When:** the role list is requested
- **Then:** all three are returned

### Implementation notes

- RoleService in `packages/control-plane/src/services/role-service.ts`
- Validation via Zod schema in contracts; governance fields rejected with "belongs to Harness" message
- In-memory repository in `packages/control-plane/src/repositories/in-memory.ts`
- REST API endpoints: GET/POST `/api/roles`, GET `/api/roles/:id`
- 5 tests covering scenarios 1.1–1.3 plus getById and update

### Checklist

- [x] implementation complete (domain layer + API)
- [x] test scenarios passing (5 tests)
- [x] deliverable standard verified
- [x] contract shape matches `role-and-team-contract.md`

---

## Feature 2: TeamSpec Records and Run-time Resolution

### User story

> As an operator, I want to define reusable team compositions, so that I can group roles for coordinated execution while leaving the actual run-time team choice explicit.

### Specification

A TeamSpec groups RoleSpec references with coordination policy. For this phase's supported subset, TeamSpec defines: role IDs, `lead_role`, `coordination.mode = supervisor-led`, memory scope, and worktree policy.

Playbook does **not** gain a Harness-style attached TeamSummary in this phase. Playbook continues using its existing `team` preference fields. At run creation time, the control plane selects or resolves the actual TeamSpec and records that resolved team on the Run.

### Deliverable standard

1. TeamSpec can be created with roles and a lead role
2. TeamSpec validates that all referenced role IDs exist
3. `lead_role` must be a member of `roles` for this phase's supported subset
4. `coordination.mode` defaults to `supervisor-led`, and no other mode is accepted in this phase
5. Run creation can resolve a concrete TeamSpec while preserving Playbook's existing `team` preference boundary

### Test scenarios

#### Scenario 2.1: Create a valid team
- **Given:** roles `researcher`, `analyst`, and `reviewer` exist
- **When:** a team `retro-team` is created with those roles and lead `analyst`
- **Then:** a persisted team record exists with correct role references

#### Scenario 2.2: Reject unknown role reference
- **Given:** no role with id `nonexistent` exists
- **When:** a team is created referencing `nonexistent`
- **Then:** creation fails with an error naming the missing role

#### Scenario 2.3: Reject invalid lead role
- **Given:** a team references roles `researcher` and `reviewer`
- **When:** the team declares `lead_role = analyst`
- **Then:** creation fails explaining that the lead role must be included in `roles`

### Implementation notes

- TeamService in `packages/control-plane/src/services/team-service.ts`
- Validates all role IDs exist via RoleSpecRepository lookup
- Validates lead_role is a member of roles
- Coordination mode defaults to supervisor-led; other modes rejected
- In-memory repository in `packages/control-plane/src/repositories/in-memory.ts`
- REST API endpoints: GET/POST `/api/teams`, GET `/api/teams/:id`
- 7 tests covering scenarios 2.1–2.3 plus additional validation

### Checklist

- [x] implementation complete (domain layer + API)
- [x] test scenarios passing (7 tests)
- [x] deliverable standard verified
- [x] contract shape matches `role-and-team-contract.md`

---

## Feature 3: Supervisor-led Team Run Compilation

### User story

> As the control plane, I need to compile a supervisor-led team run from playbook, harness, and a resolved team, so that delegation happens through durable product objects rather than prompt-only coordination.

### Specification

When a run is created with a resolved TeamSpec, the Run Compiler:

1. Records the resolved team on the Run
2. Compiles the initial Run Plan from Harness phases plus Playbook/team context
3. Spawns the lead agent only, using the lead role's instructions plus overall playbook context
4. Registers a RunSession for the lead session tagged with the lead role ID
5. Exposes control-plane delegation tools that let the lead create handoffs to available roles
6. Creates a worker session only when a handoff is accepted, then registers a RunSession tagged with that worker role ID

### Deliverable standard

1. A team run starts with one lead session and a resolved team recorded on the Run
2. The initial Run Plan reflects Harness phases and team-aware role assignment intent
3. The lead session can see available team roles and initiate handoff requests
4. An accepted handoff creates the worker RunSession with the correct role ID
5. Single-agent runs continue to compile and execute unchanged when no team is resolved

### Test scenarios

#### Scenario 3.1: Generate initial team run plan
- **Given:** a Playbook, Harness, and TeamSpec for a retro workflow
- **When:** a team run is created
- **Then:** the run has Harness phases, a resolved team, a lead RunSession, and a visible initial Run Plan

#### Scenario 3.2: Accepted handoff spawns worker session
- **Given:** a running supervisor-led team run with lead role `analyst`
- **When:** the lead creates a handoff to role `researcher` and it is accepted
- **Then:** a worker RunSession is created for `researcher`, and the RunPlan shows the delegated stage assignment

---

## Feature 4: Contract-aligned Handoff Events and Plan Mutation

### User story

> As an operator, I want to see when the lead delegates work and when a worker accepts or rejects it, so that team execution remains explainable.

### Specification

When the lead delegates work, the control plane records handoff facts using the existing Run Event contract and mutates the Run Plan accordingly.

Phase 2 uses only these handoff events:

- `handoff.created`
- `handoff.accepted`
- `handoff.rejected`

`handoff.created` records the delegation request and the intended receiving role. `handoff.accepted` or `handoff.rejected` records whether the worker took ownership. Handoff completion is inferred through `stage.*`, `session.*`, and artifact events rather than a separate handoff terminal event.

### Deliverable standard

1. `handoff.created` records at least `from_role`, `to_role`, summary, and the delegated stage or context reference
2. `handoff.accepted` or `handoff.rejected` is recorded for each handoff outcome
3. A successful handoff produces a visible RunPlan mutation rather than only a text exchange
4. Run detail shows handoff events in timeline order with from/to role labels

### Test scenarios

#### Scenario 4.1: Handoff creates formal orchestration state
- **Given:** a team run in progress
- **When:** the lead creates a handoff to a worker role
- **Then:** a `handoff.created` event is recorded and the RunPlan changes to reflect the delegated work

#### Scenario 4.2: Rejected handoff does not create orphan execution state
- **Given:** a handoff was created to a worker role
- **When:** the worker rejects it
- **Then:** a `handoff.rejected` event is recorded and no orphan worker session or active delegated stage remains

---

## Feature 5: Minimal Operator Visibility for Team Runs

### User story

> As an operator, I want to see team execution state in the run detail, so that I can understand which role is leading, which roles are active, and how work is being delegated.

### Specification

The existing run detail view extends its operator section to show:

- resolved team summary and lead role
- active role sessions and their status
- handoff timeline

This phase does not add a dedicated Team view or role-scoped artifact surface.

### Deliverable standard

1. Run detail shows the resolved team and lead role
2. Active sessions are grouped by role
3. Handoff events appear in the event timeline with from/to role labels

---

## Implementation sequence

0. **Prerequisite stability from 003** — RunSession binding, runtime event projection, and recovery behavior must be stable enough to support multiple sessions per run
1. **Feature 1: RoleSpec Records** — no dependencies
2. **Feature 2: TeamSpec Records and Run-time Resolution** — depends on Feature 1
3. **Feature 3: Supervisor-led Team Run Compilation** — depends on Features 1, 2 and plan 003 runtime/session plumbing
4. **Feature 4: Contract-aligned Handoff Events and Plan Mutation** — depends on Feature 3
5. **Feature 5: Minimal Operator Visibility** — depends on Features 3 and 4

## Evaluation gates

### Gate 1: Role/team model stable
- Features 1 and 2 pass all test scenarios
- RoleSpec/TeamSpec validation enforces the responsibility/team boundary from `role-and-team-contract.md`
- Playbook keeps using `team` preference hints rather than a new Harness-style team attachment

### Gate 2: Supervisor-led team runs functional
- Initial RunPlan generation from Playbook + Harness + Team passes (`test-design-04.md` Stage 2, section 8.2 use case 1)
- Formal handoff behavior passes with durable handoff events plus RunPlan mutation (`test-design-04.md` Stage 2, section 8.3 use case 1, narrowed to this phase)
- Accepted handoff creates the worker RunSession with correct role attribution
- Single-agent runs still work unchanged when no team is resolved

### Gate 3: Governance and visibility preserved
- Approval gates still block delegated work and allow continued execution after approval (`test-design-04.md` Stage 2, section 8.4 use cases 1–2)
- Required artifact absence still prevents a team run from succeeding (`test-design-04.md` Stage 2, section 8.4 use case 3)
- Operator can see team summary, active role sessions, and handoff timeline in run detail
- Multi-session activity remains reconstructible from durable RunEvents and RunSession records

## Completion criteria

- the supervisor-led feature set above passes its deliverable standards
- a team run with at least 3 roles can be demonstrated with one lead-to-worker handoff
- the run records contract-aligned handoff events and role-tagged RunSessions
- single-agent runs still behave correctly
- operator can see role-level execution in run detail
- all affected contracts and product specs remain consistent with this narrowed phase boundary
