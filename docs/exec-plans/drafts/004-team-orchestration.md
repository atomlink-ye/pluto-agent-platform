# 004 — Team Orchestration (DRAFT)

> **Status**: Draft — requires Oracle/Council review before activation.

## Purpose

Extend the minimum stable core with multi-role team orchestration. After plans 002 and 003, governed runs exist with a single lead agent. This plan delivers the role/team model that allows runs to spawn specialized agents coordinated by a lead, enabling collaborative agent workflows.

## Scope

- RoleSpec CRUD and listing
- TeamSpec CRUD with role references
- Team-aware Run Compiler (multi-agent spawn from team definition)
- Role-scoped sessions and handoffs
- Coordination modes (supervisor-led, pipeline)
- Operator visibility for team execution (run detail shows active roles)

## Non-goals

- Shared-room real-time collaboration (deferred to later plan)
- Committee voting mode (deferred)
- Mailbox-like coordination surfaces (deferred)
- Advanced worktree policies beyond per-run (deferred)

## Authority references

- `docs/product-specs/core-domain-model.md` sections 11–12 (RoleSpec, TeamSpec)
- `docs/contracts/role-and-team-contract.md` — canonical shapes and contract rules
- `docs/design-docs/execution-model.md` — playbook/harness/run relationship
- `.local/refDoc/product-redesign/reference/design-02.md` — phase 2 team orchestration
- `.local/refDoc/product-redesign/reference/test-design-04.md` — stage 2 test scenarios

## Actors

| Actor | Description | Authority |
|---|---|---|
| Operator | Engineer configuring teams and observing multi-role runs | Create roles/teams, start team runs, inspect role-level state |
| Lead Agent | The supervisory agent spawned by the Run Compiler | Delegate tasks, initiate handoffs, coordinate role agents |
| Role Agent | A specialized agent spawned to fulfill a specific role | Execute role-scoped tasks, produce role-scoped artifacts |
| Control Plane | The platform's run lifecycle engine | Spawn role agents, track sessions, enforce governance |

---

## Feature 1: RoleSpec Records

### User story

> As an operator, I want to define reusable role specifications, so that I can describe agent responsibilities independently of specific playbooks or runs.

### Specification

A RoleSpec is a durable record in Postgres matching the shape defined in `role-and-team-contract.md`. RoleSpec defines a responsibility profile with: name, description, system prompt, tool policy, provider preset, memory scope, and isolation preference.

### Deliverable standard

1. RoleSpec can be created with minimum required fields (name, description)
2. RoleSpec is listed and retrievable by ID
3. RoleSpec validation rejects governance-scoped fields (approvals, timeouts)
4. Optional fields (system_prompt, tools, provider_preset) are persisted correctly

### Test scenarios

#### Scenario 1.1: Create a valid role
- **Given:** a role payload with name "researcher" and description "Gathers information"
- **When:** the role is submitted
- **Then:** a persisted record exists with correct fields

#### Scenario 1.2: List roles
- **Given:** three roles exist
- **When:** the role list is requested
- **Then:** all three are returned

---

## Feature 2: TeamSpec Records

### User story

> As an operator, I want to define reusable team compositions, so that I can group roles for coordinated execution.

### Specification

A TeamSpec groups RoleSpec references with coordination policy. It defines: roles (by id), lead role, coordination mode, memory scope, and worktree policy.

### Deliverable standard

1. TeamSpec can be created with roles and a lead role
2. TeamSpec validates that all referenced role IDs exist
3. TeamSpec can be attached to a playbook (like harness attachment)
4. Coordination mode defaults to `supervisor-led` if not specified

### Test scenarios

#### Scenario 2.1: Create a valid team
- **Given:** roles "researcher", "analyst", "reviewer" exist
- **When:** a team "retro-team" is created with those roles and lead "analyst"
- **Then:** a persisted team record exists with correct role references

#### Scenario 2.2: Reject unknown role reference
- **Given:** no role with id "nonexistent" exists
- **When:** a team is created referencing "nonexistent"
- **Then:** creation fails with error naming the missing role

---

## Feature 3: Team-aware Run Compiler

### User story

> As the control plane, I need to spawn multiple role-scoped agent sessions when a run uses a team, so that each role has its own execution context.

### Specification

When a playbook has a team attached, the Run Compiler:
1. Spawns a lead agent with the team lead role's system prompt + overall playbook context
2. For each non-lead role, spawns a role agent with the role's system prompt + role-scoped context
3. Registers a RunSession for each spawned agent, tagged with the role ID
4. Provides the lead agent with MCP tools to communicate with role agents

### Deliverable standard

1. A team run spawns N agents (one per role)
2. Each agent's system prompt includes role-specific instructions
3. Each RunSession records the role ID
4. Lead agent can see which role agents are available

---

## Feature 4: Handoff Events

### User story

> As an operator, I want to see when work is handed between roles, so that I can understand the flow of a team run.

### Specification

When the lead agent delegates work to a role agent or receives results back, the control plane records handoff events. The `run-event-contract.md` defines `handoff.*` event types.

### Deliverable standard

1. `handoff.initiated` event records: from_role, to_role, context
2. `handoff.completed` event records: from_role, to_role, result summary
3. Run detail shows handoff timeline in the operator section

---

## Feature 5: Operator Views for Team Runs

### User story

> As an operator, I want to see team execution state in the run detail, so that I can understand which roles are active and how work is flowing.

### Specification

The run detail view extends the operator section to show:
- Active roles and their status
- Session list grouped by role
- Handoff timeline
- Role-scoped artifacts

### Deliverable standard

1. Run detail shows active roles with status badges
2. Sessions are grouped by role in the operator section
3. Handoff events appear in the event timeline with from/to role labels

---

## Implementation sequence

1. **Feature 1: RoleSpec Records** — no dependencies
2. **Feature 2: TeamSpec Records** — depends on Feature 1
3. **Feature 3: Team-aware Run Compiler** — depends on Features 1, 2
4. **Feature 4: Handoff Events** — depends on Feature 3
5. **Feature 5: Operator Views** — depends on all above

## Evaluation gates

### Gate 1: Role/Team model stable
- Features 1, 2 pass all test scenarios
- RoleSpec/TeamSpec boundary is enforced by validation
- Contract shapes match `role-and-team-contract.md`

### Gate 2: Multi-agent runs functional
- Features 3, 4 pass all test scenarios
- A team run spawns correct number of agents
- Handoff events are recorded

### Gate 3: Team visibility
- Feature 5 passes all test scenarios
- Operator can distinguish single-agent and team runs
- Role-level state is visible in run detail

## Completion criteria

- all five features pass their deliverable standard
- a team run with 3 roles can be demonstrated
- operator can see role-level execution in run detail
- all contracts and product specs remain consistent
