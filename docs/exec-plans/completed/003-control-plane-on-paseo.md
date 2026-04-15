# 003 — Control Plane on Paseo

## Purpose

Wire the domain model from plan 002 to the live Paseo runtime. After 002, durable product objects exist in Postgres but nothing drives actual agent execution. This plan delivers the integration layer that compiles runs into Paseo agent sessions, projects Paseo events back into durable RunEvents, enforces harness governance during execution, and recovers run state after restarts. The result is a governed run that is both durable (Postgres) and alive (Paseo agents).

## Status

**Completed.** All six features implemented with 30+ test scenarios passing. Recovery (F6) was completed by Plan 005 F3. Live Paseo integration delivered by Plan 005 F2. Known deferrals:

- Handoff durability still relies on events plus in-memory service state rather than a durable handoff record/projection (tracked in tech-debt-tracker.md)
- Live E2E coverage uses the Docker path from Plan 005 rather than standalone Plan 003 tests

## Scope

- Postgres migration framework and schema for all product objects
- Runtime Adapter that subscribes to Paseo `AgentManager` events and projects them into RunEvents
- Run Compiler that creates Paseo agent sessions from playbook + harness + inputs
- Phase Controller that enforces harness rules (approval gates, required artifacts, phase ordering)
- RunSession binding between durable run records and Paseo `ManagedAgent` instances
- Recovery path that reconstructs run state from events and rebinds Paseo sessions after restart
- Control-plane MCP tools that runs' lead agents use to declare phase transitions and artifact production

## Non-goals

- Team orchestration beyond single lead agent (multi-role coordination is a later plan)
- Trigger/webhook system
- Rich policy engine with org/project overlay hierarchy
- UI implementation (covered by 002 Feature 6; this plan provides the backend it consumes)
- Modifying Paseo's internal agent lifecycle or storage

## Authority references

- `ARCHITECTURE.md` — execution authority boundary, source-of-truth rules, dependency direction
- `docs/product-specs/core-domain-model.md` — all object definitions, cross-object rules
- `docs/product-specs/product-and-scope.md` — relationship to Paseo, product invariants
- `docs/design-docs/execution-model.md` — playbook/harness/run compilation relationship
- `docs/design-docs/system-architecture.md` — fork architecture, runtime-kernel vs product-layer
- `docs/contracts/*.md` — field-level contracts for RunEvent, Run, RunSession, Approval, Artifact

## Actors

| Actor | Description | Authority |
|---|---|---|
| Operator | Engineer who starts runs and resolves approvals via UI | Trigger run creation, resolve approvals, inspect state |
| Control Plane | The product-layer services built by this plan | Compile runs, spawn agents, enforce governance, project events, manage recovery |
| Paseo Kernel | The forked Paseo daemon (AgentManager, MCP server, timeline) | Execute agent sessions, emit stream events, handle permissions, manage worktrees |
| Lead Agent | The AI agent spawned by the control plane to execute a run | Declare phase transitions, produce artifacts, request approvals via MCP tools |

---

## Feature 1: Database Foundation

### User story

> As the control plane, I need a Postgres-backed schema with migrations, so that all product objects are durable, queryable, and schema-versioned.

### Specification

Set up Drizzle ORM with a migration framework. Define tables for: `playbooks`, `harnesses`, `runs`, `run_plans`, `run_events`, `approval_tasks`, `artifacts`, `run_sessions`, `policy_snapshots`. The `run_events` table is append-only. All tables include `id` (UUID), `created_at`, `updated_at`. Foreign keys enforce referential integrity (run → playbook, run → harness, approval → run, artifact → run, run_session → run).

The database connection is managed by the control-plane service layer, not by Paseo's daemon. Paseo continues using its own file-based storage for runtime state.

### Deliverable standard

1. `npm run db:migrate` applies all migrations to a clean Postgres instance
2. All product object tables exist with correct columns, types, and constraints
3. `run_events` table is append-only (no UPDATE/DELETE at application level)
4. Foreign key constraints prevent orphaned records
5. A test can create, read, and query every table type

### Test scenarios

#### Scenario 1.1: Migrations apply cleanly

- **Given:** an empty Postgres database
- **When:** migrations are run
- **Then:** all tables exist with correct schema, and `drizzle-kit` reports no pending changes

#### Scenario 1.2: Referential integrity enforced

- **Given:** no playbook with ID `nonexistent` exists
- **When:** a run is inserted referencing `playbook_id = nonexistent`
- **Then:** the insert fails with a foreign key violation

#### Scenario 1.3: Run events are append-only

- **Given:** a run event exists in the database
- **When:** an application-level update or delete is attempted
- **Then:** the operation is rejected (enforced by application-layer repository, not DB trigger)

#### Scenario 1.4: All tables round-trip correctly

- **Given:** test factories for each domain object
- **When:** each object is inserted and then queried
- **Then:** the returned record matches the inserted data

### Checklist

- [x] Drizzle ORM configured with Postgres connection
- [x] Migration files for all tables (drizzle-kit push)
- [x] Test factories for all domain objects
- [x] Test database setup/teardown in test harness
- [x] `db:migrate` and `db:generate` scripts in package.json

---

## Feature 2: Runtime Adapter

### User story

> As the control plane, I need to subscribe to Paseo agent events and translate them into durable RunEvents, so that run state is projected from live execution without making Paseo's runtime the source of truth.

### Specification

The Runtime Adapter subscribes to `agentManager.subscribe()` on the Paseo daemon. For each `AgentStreamEvent` belonging to a tracked run, the adapter maps it to a typed RunEvent and appends it to the `run_events` table.

Event mapping:

| Paseo Event | RunEvent Type | Notes |
|---|---|---|
| `thread_started` | `session.created` | Records runtimeSessionId linkage |
| `turn_started` | `stage.started` | Maps to current phase's active stage |
| `turn_completed` | `stage.completed` | |
| `turn_failed` | `run.failed` or `stage.failed` | Depends on severity |
| `permission_requested` | `approval.requested` | Elevates to ApprovalTask |
| `permission_resolved` | `approval.resolved` | |
| `attention_required(finished)` | `run.completed` | Triggers completion checks |
| `attention_required(error)` | `run.failed` | |
| Custom MCP: `declare_phase` | `phase.entered` | Lead agent declares transition |
| Custom MCP: `register_artifact` | `artifact.created` | Lead agent declares output |

The adapter is idempotent: replaying the same Paseo event produces no duplicate RunEvents (deduplication by `paseo_event_seq` + `paseo_epoch`).

### Deliverable standard

1. Adapter subscribes to Paseo AgentManager and receives stream events for tracked agents
2. Each mapped Paseo event produces exactly one RunEvent in Postgres
3. Unmapped Paseo events are ignored (not every tool call is a RunEvent)
4. Duplicate events (same seq + epoch) are deduplicated
5. Adapter only tracks agents that were spawned by the control plane (not standalone Paseo agents)
6. Event mapping is tested with a fake AgentManager emitting canned events

### Test scenarios

#### Scenario 2.1: Map thread_started to session.created

- **Given:** the adapter is tracking a run with agent ID `agent-1`
- **When:** Paseo emits `thread_started` for `agent-1`
- **Then:** a RunEvent of type `session.created` is appended with the runtimeSessionId, and a RunSession record is upserted

#### Scenario 2.2: Map permission_requested to approval.requested

- **Given:** the adapter is tracking a run with agent ID `agent-1`
- **When:** Paseo emits `permission_requested` with kind `tool`, name `bash`, and description "delete production branch"
- **Then:** a RunEvent of type `approval.requested` is appended, and an ApprovalTask record is created in `pending` state linked to the run

#### Scenario 2.3: Idempotent on duplicate events

- **Given:** a RunEvent for seq=5, epoch=`abc` already exists
- **When:** the adapter receives the same Paseo event (seq=5, epoch=`abc`) again
- **Then:** no new RunEvent is created; the operation is a no-op

#### Scenario 2.4: Ignore untracked agents

- **Given:** a standalone Paseo agent `agent-standalone` not created by the control plane
- **When:** Paseo emits events for `agent-standalone`
- **Then:** the adapter ignores them; no RunEvents are created

#### Scenario 2.5: Custom MCP phase declaration

- **Given:** the lead agent calls the `declare_phase` MCP tool with phase `analyze`
- **When:** the adapter receives the corresponding tool call event
- **Then:** a RunEvent of type `phase.entered` is appended with phase name `analyze`, and the run's current phase is updated

### Checklist

- [x] Adapter subscribes to AgentManager events
- [x] Event mapping for all listed Paseo event types
- [x] Deduplication by seq + epoch
- [x] Agent tracking registry (control-plane-spawned only)
- [x] Fake AgentManager for testing
- [x] Custom MCP tool definitions for phase/artifact declaration (declare_phase, register_artifact with JSON Schema + handlers)

---

## Feature 3: Run Compiler

### User story

> As the control plane, I need to compile a run from playbook + harness + inputs into a live Paseo agent session, so that governed execution actually happens rather than just existing as database records.

### Specification

The Run Compiler executes when an operator creates a run (from 002 Feature 3). It performs these steps in order:

1. Validate playbook + harness + inputs
2. Insert Run record in Postgres with status `queued`
3. Compute effective policy snapshot and persist it
4. Compile initial Run Plan from harness phases
5. Transition run to `initializing`
6. Construct agent system prompt from playbook (goal, instructions, context) + harness (phase names, approval rules) + control-plane MCP tool descriptions
7. Call Paseo `agentManager.createAgent()` with the system prompt, provider, mode, and working directory from EnvironmentSpec
8. Register the agent ID in the Runtime Adapter's tracking registry
9. Register RunSession linking run ID to Paseo agent ID
10. Call `agentManager.runAgent()` with the initial prompt
11. Transition run to `running`

If any step fails, the run transitions to `failed` with the step and error recorded.

### Deliverable standard

1. A run creation request produces a live Paseo agent executing the playbook's task
2. The agent's system prompt includes playbook intent, harness rules, and available MCP tools for declaring phases and artifacts
3. Run, RunPlan, PolicySnapshot, and RunSession records all exist in Postgres after successful compilation
4. Compilation failure at any step results in `failed` status with an explainable reason
5. The Paseo agent is tracked by the Runtime Adapter from the moment it is created

### Test scenarios

#### Scenario 3.1: Successful run compilation

- **Given:** a playbook "Sprint Retro" with harness "Standard 3-Phase" (collect, analyze, review) and valid inputs
- **When:** a run is created
- **Then:** a Paseo agent exists and is running, a RunSession links the run to the agent ID, a RunPlan has 3 phases, a PolicySnapshot is recorded, and run status is `running`

#### Scenario 3.2: System prompt contains governance context

- **Given:** a harness with phases `[collect, analyze, review]` and an approval rule on `review`
- **When:** the run compiler constructs the agent system prompt
- **Then:** the prompt includes the phase names, states that `review` requires approval, and documents the `declare_phase` and `register_artifact` MCP tools

#### Scenario 3.3: Compilation failure is recorded

- **Given:** a run has already spawned a Paseo agent but persisting the `RunSession` fails
- **When:** the compiler handles the partial failure
- **Then:** the spawned agent is cleaned up, the run status is `failed`, and `failureReason` explains the rollback cause

#### Scenario 3.4: Agent is tracked immediately

- **Given:** a run is being compiled
- **When:** the Paseo agent is created (step 7)
- **Then:** the Runtime Adapter begins receiving events for the agent before `runAgent()` is called

### Checklist

- [x] 11-step compilation sequence implemented (compile method with FakeAgentManager)
- [x] System prompt builder with playbook + harness + MCP tool context
- [x] EnvironmentSpec resolution (working directory, prompt repo context, resolved run environment)
- [x] Rollback on partial failure (cleanup Paseo agent if DB write fails)
- [ ] Integration test with real Paseo daemon (or realistic mock)

---

## Feature 4: Phase Controller

### User story

> As the control plane, I need to enforce harness governance during a live run, so that approval gates, phase ordering, and artifact requirements are not just suggestions but actual constraints.

### Specification

The Phase Controller subscribes to new RunEvents (from the Runtime Adapter) and enforces harness rules in real time:

1. **Phase ordering:** When the lead agent declares a phase via `declare_phase`, the controller checks whether the transition is allowed by the harness. Out-of-order transitions are rejected (the MCP tool returns an error to the agent).
2. **Approval gates:** When the lead agent enters a phase that has an approval rule, the controller transitions the run to `waiting_approval` and creates an ApprovalTask. The agent is informed that it must wait.
3. **Approval resolution:** When an operator resolves an approval (from 002 Feature 4), the controller resumes the run by sending a continuation prompt to the Paseo agent via `agentManager.runAgent()`.
4. **Artifact check at completion:** When the lead agent signals completion (or Paseo emits `attention_required(finished)`), the controller checks that all required artifacts from the playbook have been registered. If not, the run transitions to `failed` instead of `succeeded`.
5. **Timeout enforcement:** If a phase exceeds the harness timeout, the controller transitions the run to `blocked` with a timeout blocker reason.

### Deliverable standard

1. Out-of-order phase transitions are rejected by the MCP tool
2. Approval gates pause the run and create durable ApprovalTasks
3. Approval resolution resumes the Paseo agent with a continuation prompt
4. Missing required artifacts block the `succeeded` transition
5. Phase timeout transitions the run to `blocked`
6. All controller decisions are recorded as RunEvents

### Test scenarios

#### Scenario 4.1: Enforce phase ordering

- **Given:** a harness with phases `[collect, analyze, review]` and a run currently in phase `collect`
- **When:** the lead agent calls `declare_phase("review")`, skipping `analyze`
- **Then:** the MCP tool returns an error: "cannot enter 'review' before completing 'analyze'"

#### Scenario 4.2: Approval gate pauses run

- **Given:** a harness with an approval rule on phase `review`, and the run enters `review`
- **When:** the phase controller processes the `phase.entered(review)` event
- **Then:** run status is `waiting_approval`, an ApprovalTask is created, and the Paseo agent receives a message saying "awaiting approval before proceeding"

#### Scenario 4.3: Approval resolution resumes agent

- **Given:** a run in `waiting_approval` with a pending approval for the `review` phase
- **When:** the operator approves
- **Then:** the Paseo agent receives a continuation prompt "approval granted for review phase, proceed", and run status returns to `running`

#### Scenario 4.4: Missing artifact blocks completion

- **Given:** a playbook requires artifact type `retro_document`, and the lead agent signals completion without having called `register_artifact`
- **When:** the phase controller handles the completion signal
- **Then:** run status is `failed` with reason "required artifact missing: retro_document"

#### Scenario 4.5: Phase timeout

- **Given:** a harness with a 30-minute timeout on the `analyze` phase, and the run has been in `analyze` for 31 minutes
- **When:** the timeout check fires
- **Then:** run status is `blocked` with `blockerReason` "phase 'analyze' exceeded timeout (30 minutes)"

### Checklist

- [x] Phase ordering validation against harness
- [x] Approval gate detection and ApprovalTask creation
- [x] Approval resolution → Paseo agent continuation in the current server scaffold
- [x] Artifact requirement check at completion
- [x] Timeout monitoring (polling or scheduled check)
- [x] All controller actions emit RunEvents

---

## Feature 5: RunSession Binding

### User story

> As an operator, I want to see which Paseo agent session is executing my run, so that I can inspect runtime details and understand recovery options when something goes wrong.

### Specification

A RunSession record links a durable run (Postgres) to a Paseo `ManagedAgent` (in-memory). The RunSession stores:

- `run_id` — FK to runs table
- `paseo_agent_id` — the Paseo agent's in-memory ID
- `provider` — agent provider (claude, codex, etc.)
- `status` — `active`, `interrupted`, `completed`, `failed`
- `started_at`, `ended_at`
- `persistence_handle` — Paseo's `AgentPersistenceHandle` (provider session ID for resuming)

The Runtime Adapter updates RunSession status as Paseo agent lifecycle events arrive. The operator UI reads RunSession to display runtime context in the run detail's operator section.

### Deliverable standard

1. RunSession is created when the Run Compiler spawns a Paseo agent
2. RunSession status reflects the Paseo agent's lifecycle (`active` while running, `completed` on finish, `failed` on error)
3. RunSession stores the persistence handle for potential resume
4. Operator can see the linked agent's provider, status, and timestamps in the run detail
5. Multiple RunSessions per run are supported (for retry or resume scenarios)

### Test scenarios

#### Scenario 5.1: Session created on agent spawn

- **Given:** the Run Compiler creates a Paseo agent for a run
- **When:** the agent starts
- **Then:** a RunSession record exists with status `active`, the correct `paseo_agent_id`, and `started_at` set

#### Scenario 5.2: Session status tracks agent lifecycle

- **Given:** a RunSession in `active` status
- **When:** the Paseo agent finishes (emits `attention_required(finished)`)
- **Then:** RunSession status is `completed` and `ended_at` is set

#### Scenario 5.3: Session records persistence handle

- **Given:** a Paseo agent with provider `claude` that supports session persistence
- **When:** the agent's runtime info is available
- **Then:** the RunSession's `persistence_handle` contains the provider's session ID

#### Scenario 5.4: Multiple sessions for one run

- **Given:** a run whose first agent session failed
- **When:** the run is retried with a new agent session
- **Then:** two RunSession records exist for the same run: one `failed`, one `active`

### Checklist

- [x] RunSession table and repository
- [x] Creation during Run Compiler step 9
- [x] Status updates from Runtime Adapter
- [x] Persistence handle capture
- [x] Query by run ID for operator view

---

## Feature 6: Recovery

### User story

> As an operator, I want a run to survive daemon restarts, so that long-running governed execution is not lost when infrastructure bounces.

### Specification

On control-plane startup, the Recovery service:

1. Queries all runs in non-terminal status (`queued`, `initializing`, `running`, `waiting_approval`, `blocked`)
2. For each run, reconstructs current state by projecting all RunEvents from the event log
3. Checks whether the Paseo agent still exists (via `agentManager` listing)
4. If the agent exists and is alive: rebinds the Runtime Adapter to track it, updates RunSession
5. If the agent is gone: attempts to resume using the persistence handle from RunSession
6. If resume fails: transitions the run to `blocked` with reason "runtime session lost, awaiting operator intervention"
7. Re-registers all active runs with the Phase Controller for continued governance

Runs in `waiting_approval` do not need a live agent — they simply remain paused until the operator resolves the approval.

### Deliverable standard

1. State can be fully reconstructed from RunEvents alone (no in-memory-only state required)
2. Active runs are re-tracked by the Runtime Adapter after restart
3. Runs whose agents survived restart continue seamlessly
4. Runs whose agents were lost are marked `blocked` with an actionable reason
5. Runs in `waiting_approval` remain valid across restart without agent rebinding

### Test scenarios

#### Scenario 6.1: Reconstruct state from events

- **Given:** a run with 10 RunEvents covering creation, phase transitions, and an approval
- **When:** the projector rebuilds state from events only (no cached state)
- **Then:** the projected run state matches: correct current phase, correct status, correct approval status, correct registered artifacts

#### Scenario 6.2: Rebind surviving agent

- **Given:** a run in `running` state, and the Paseo agent still exists after a simulated restart
- **When:** recovery runs
- **Then:** the Runtime Adapter tracks the agent, the Phase Controller governs the run, and new events flow normally

#### Scenario 6.3: Handle lost agent

- **Given:** a run in `running` state, and the Paseo agent no longer exists after restart
- **When:** recovery runs and resume via persistence handle fails
- **Then:** run status is `blocked`, `blockerReason` is "runtime session lost, awaiting operator intervention", and the operator sees this in the UI

#### Scenario 6.4: Waiting-approval survives restart

- **Given:** a run in `waiting_approval` with a pending ApprovalTask
- **When:** recovery runs
- **Then:** the run remains in `waiting_approval`, the ApprovalTask is still `pending`, and operator can resolve it normally

#### Scenario 6.5: Idempotent recovery

- **Given:** recovery has already run once and re-tracked all agents
- **When:** recovery runs a second time
- **Then:** no duplicate RunSessions, no duplicate event subscriptions, no state changes

### Checklist

- [x] Event-based state projector (RunEvents → current Run state)
- [x] Startup recovery scan for non-terminal runs (Plan 005 F3)
- [x] Agent existence check via Paseo AgentManager
- [x] Resume attempt via persistence handle (Plan 005 F3)
- [x] Graceful degradation to `blocked` on unrecoverable loss for targeted recovery
- [x] Idempotent full recovery (safe startup sweep across all active runs) (Plan 005 F3)

---

## Implementation sequence

1. **Feature 1: Database Foundation** — no dependencies; everything else needs tables
2. **Feature 2: Runtime Adapter** — depends on Feature 1 (writes RunEvents to Postgres); can start with fake AgentManager
3. **Feature 3: Run Compiler** — depends on Features 1, 2 (creates records and spawns agents that the adapter tracks)
4. **Feature 5: RunSession Binding** — depends on Features 1, 2, 3 (created during compilation, updated by adapter)
5. **Feature 4: Phase Controller** — depends on Features 2, 3 (reacts to RunEvents from adapter, sends prompts to agents created by compiler)
6. **Feature 6: Recovery** — depends on all above (recovery re-establishes every integration)

Features 2 and 3 can be developed in parallel if Feature 2 uses a fake AgentManager. Feature 5 is a thin layer that mostly follows from 3 and 2.

## Evaluation gates

### Gate 1: Storage operational

- Feature 1 passes all test scenarios
- Migrations apply cleanly, all tables exist, referential integrity holds
- Test factories produce valid records for every domain object

### Gate 2: Event pipeline functional

- Feature 2 passes all test scenarios
- Paseo events flow through the adapter into durable RunEvents
- Deduplication and agent tracking work correctly
- Custom MCP tool definitions exist; live MCP transport to agents remains incomplete

### Gate 3: Governed run executes

- Features 3, 4, 5 pass all test scenarios
- A run created from playbook + harness spawns a real Paseo agent
- Phase ordering is enforced
- Approval gates pause and resume execution
- Artifact requirements block premature completion
- RunSession accurately reflects agent lifecycle

### Gate 4: Survives restart

- Feature 6 complete (implemented in Plan 005 F3)
- Startup sweep scans all non-terminal runs and recovers or blocks each
- Persistence handle resume creates new agent with `resumeFrom` option
- Idempotent guard prevents duplicate recovery runs
- A run in `waiting_approval` remains durably visible without needing a live agent
- No durable state is lost

## Completion criteria

The plan is complete when all of the following are true:

- all six features pass their deliverable standard and test scenarios
- the minimum reference scenario from `product-and-scope.md` works with a live Paseo agent (not just mock)
- operator creates a run → Paseo agent executes → phases progress → approval pauses and resumes → artifact is registered → run succeeds
- a restart mid-run does not lose the run
- `ARCHITECTURE.md` source-of-truth rules are enforced: Postgres is authority for business state, Paseo is authority for runtime-local state
- all contracts and product specs remain consistent
