# 005 — Paseo Core Fork and Runtime Integration

## Purpose

Fork the minimal Paseo kernel into this repository and wire it to the control plane, replacing the FakeAgentManager with a real agent runtime. After this plan, governed runs create real AI agent sessions that execute playbooks, emit events, and respond to phase/approval/artifact governance. This is the bridge between the durable product layer (Plans 002–004) and live agent execution.

## Current status note

Features 1–3 complete. Features 4–5 in progress.

- **F1 (Paseo Core Package):** All excluded files integrated, provider-registry stripped to Claude-only, typecheck clean, 132 tests passing.
- **F2 (Control-Plane Wiring):** PaseoAgentManager adapter created, dev-server bootstrap wired with `PASEO_MODE` env selection.
- **F3 (Recovery Completion):** Startup scan, persistence handle resume, and idempotent guard all implemented and tested.
- **F4 (E2E Test Infrastructure):** In progress — Docker + OpenCode provider.
- **F5 (Web UI Tests):** In progress — midscenejs browser automation.

## Scope

- Fork minimal Paseo server core into `packages/paseo/` (agent manager, Claude provider, MCP, WebSocket, session, bootstrap)
- Adapt forked code to export a `PaseoAgentManager` implementing the control-plane's `AgentManager` interface
- Wire the real `PaseoAgentManager` into the server bootstrap alongside existing control-plane services
- MCP tool transport: ensure control-plane tools (declare_phase, register_artifact, create_handoff, reject_handoff) are callable by agents
- Complete Plan 003 Feature 6: startup recovery scan, persistence handle resume, idempotent recovery
- E2E integration test: minimum reference scenario with a real Paseo agent against Postgres
- Docker-based E2E test infrastructure following the opencode-runtime pattern
- Web UI integration tests using midscenejs for operator flows

## Non-goals

- Forking Paseo relay, speech, chat, file explorer, schedule, push notifications, or terminal management
- Supporting providers beyond Claude in this plan (Codex/OpenCode/ACP deferred)
- Modifying Paseo's internal agent lifecycle or provider architecture
- Building a new UI beyond what Plan 002 Feature 6 already delivered
- Rich policy engine or org/project overlay hierarchy

## Authority references

- `ARCHITECTURE.md` — fork architecture, dependency direction, execution authority boundary
- `docs/product-specs/product-and-scope.md` — relationship to Paseo, minimum reference scenario
- `docs/product-specs/core-domain-model.md` — all object definitions
- `docs/design-docs/system-architecture.md` — fork architecture, runtime-kernel vs product-layer
- `packages/control-plane/src/paseo/types.ts` — the AgentManager interface contract
- `docs/exec-plans/active/003-control-plane-on-paseo.md` — Feature 6 (Recovery) remaining items
- `docs/exec-plans/active/002-minimum-stable-core.md` — Feature 6 (Operator Views) E2E tests
- `.local/refCode/paseo/packages/server/` — Paseo source to fork from
- `.local/refCode/agent-cowork/` — E2E test patterns (Docker opencode-runtime)
- `.local/refDoc/product-redesign/reference/test-design-04.md` — test strategy reference

## Actors

| Actor | Description | Authority |
|---|---|---|
| Operator | Engineer who starts runs and resolves approvals via UI | Trigger run creation, resolve approvals, inspect state |
| Control Plane | Product-layer services (Plans 002–004) | Compile runs, enforce governance, project events, manage recovery |
| Paseo Kernel | Forked Paseo core in `packages/paseo/` | Execute agent sessions, emit stream events, handle MCP tools, manage worktrees |
| Lead Agent | AI agent spawned by the control plane | Execute playbook tasks, declare phases, register artifacts |

---

## Feature 1: Paseo Core Package

### User story

> As the platform, I need the Paseo agent runtime forked into this repository, so that the control plane can spawn and manage real AI agent sessions without depending on an external daemon.

### Specification

Create `packages/paseo/` containing the minimal Paseo server core:

1. **AgentManager** — agent lifecycle management, event subscription, storage
2. **Claude provider** — the primary agent provider using `@anthropic-ai/claude-agent-sdk`
3. **MCP server** — Model Context Protocol tool execution
4. **WebSocket server** — binary-multiplexed client connections for the UI
5. **Session management** — per-client state tracking
6. **Bootstrap** — daemon initialization tying components together
7. **Shared types** — protocol messages, agent lifecycle definitions

Skip: relay, speech/dictation, file explorer, chat, git checkout, schedule, push, terminal (beyond stubs), and all providers except Claude.

The package exports at minimum:
- `AgentManager` class (or factory)
- `AgentSessionConfig`, `ManagedAgent`, `AgentStreamEvent` types (re-exported for convenience, but control-plane continues using its own stable interface)
- A `createPaseoDaemon(config)` bootstrap function

### Deliverable standard

1. `packages/paseo/` compiles without errors as part of the monorepo
2. `AgentManager` can create a Claude agent session with a system prompt
3. `AgentManager` emits `agent_state` and `agent_stream` events for tracked agents
4. Agent sessions execute prompts and return results
5. MCP tools defined in the system prompt are callable by agents
6. No relay, speech, chat, or other excluded modules are present

### Test scenarios

#### Scenario 1.1: Create and run a Claude agent

- **Given:** a valid Anthropic API key in the environment
- **When:** AgentManager creates a Claude agent with a simple system prompt and runs it with "say hello"
- **Then:** the agent returns a response containing a greeting, and at least `thread_started`, `turn_started`, `turn_completed`, and `attention_required(finished)` events are emitted

#### Scenario 1.2: Event subscription receives all lifecycle events

- **Given:** a subscriber registered via `agentManager.subscribe()`
- **When:** an agent is created, run, and completes
- **Then:** the subscriber receives `agent_state` events for lifecycle transitions and `agent_stream` events for turn progression

#### Scenario 1.3: Kill agent cleans up

- **Given:** a running agent
- **When:** `agentManager.killAgent(agentId)` is called
- **Then:** the agent is terminated, lifecycle transitions to `closed`, and subscriber receives the state change

### Checklist

- [x] `packages/paseo/` created with package.json and tsconfig
- [x] AgentManager forked and adapted
- [x] Claude provider forked (minimal, no other providers)
- [x] MCP server forked (stripped of terminal, schedule, voice, worktree-bootstrap)
- [x] Bootstrap/daemon initialization
- [x] WebSocket server (for UI client connections)
- [x] Shared types and protocol
- [x] Monorepo builds cleanly with new package
- [ ] Smoke test: create agent, run prompt, receive events (deferred to F4 E2E)

---

## Feature 2: Control-Plane Wiring

### User story

> As the control plane, I need the real PaseoAgentManager wired in place of FakeAgentManager, so that run compilation, event projection, phase governance, and approval resolution work against real agent sessions.

### Specification

Create a `PaseoAgentManager` adapter in `packages/control-plane/src/paseo/paseo-agent-manager.ts` that wraps the forked Paseo `AgentManager` and implements the control-plane's `AgentManager` interface. Update the server bootstrap to use the real implementation when `PASEO_MODE=live` (keep `FakeAgentManager` for `PASEO_MODE=fake` or when no Paseo config is present).

The adapter maps between Paseo's internal types and the control-plane's stable interface types. Both sides already mirror each other closely since the interface was designed from Paseo's API.

### Deliverable standard

1. `PaseoAgentManager` implements `AgentManager` from `packages/control-plane/src/paseo/types.ts`
2. Server bootstrap selects real vs fake based on environment variable
3. `RuntimeAdapter.start()` receives real events from the Paseo kernel
4. `RunCompiler.compile()` spawns a real Claude agent
5. `PhaseController.handleApprovalResolution()` resumes a real agent
6. All existing 131+ tests continue passing (FakeAgentManager still used in test mode)

### Test scenarios

#### Scenario 2.1: Run compiler creates real agent

- **Given:** `PASEO_MODE=live` and a valid API key
- **When:** a run is created from a playbook + harness
- **Then:** a real Claude agent session exists, RunSession links to the agent, and events flow through RuntimeAdapter

#### Scenario 2.2: Phase declaration via system prompt tool

- **Given:** a running agent with the control-plane system prompt including `declare_phase` tool docs
- **When:** the agent calls the `declare_phase` tool
- **Then:** the RuntimeAdapter catches the timeline event, the PhaseController validates the transition, and a `phase.entered` RunEvent is recorded

#### Scenario 2.3: Approval gate pauses and resumes real agent

- **Given:** a run entering a phase with an approval gate
- **When:** the phase controller detects the gate and later the operator approves
- **Then:** the agent receives a continuation prompt via `agentManager.runAgent()`

### Checklist

- [x] `PaseoAgentManager` adapter created (`packages/control-plane/src/paseo/paseo-agent-manager.ts`)
- [x] Server bootstrap updated with environment-based selection (`PASEO_MODE=live|fake`)
- [x] RuntimeAdapter receives real Paseo events (via adapter type mapping)
- [x] RunCompiler spawns real agents (through PaseoAgentManager)
- [x] PhaseController interacts with real agents (through PaseoAgentManager)
- [x] Existing tests unaffected (FakeAgentManager preserved for testing) — 132 tests passing

---

## Feature 3: Recovery Completion (Plan 003 F6)

### User story

> As an operator, I want runs to survive daemon restarts, so that long-running governed execution is not lost when infrastructure bounces.

### Specification

Complete the remaining items from Plan 003 Feature 6:

1. **Startup recovery scan** — on control-plane startup, query all non-terminal runs and attempt to rebind their agents
2. **Resume via persistence handle** — if the Paseo agent is gone but a persistence handle exists, attempt to resume using the provider's session resumption
3. **Idempotent full recovery** — the startup scan is safe to run multiple times without creating duplicate subscriptions, sessions, or events

### Deliverable standard

1. On startup, all non-terminal runs are scanned and recovery attempted
2. Runs with live agents are re-tracked seamlessly
3. Runs with lost agents are resumed via persistence handle when available
4. Runs that cannot be recovered are marked `blocked` with actionable reason
5. Recovery is idempotent (running twice produces no side effects)

### Test scenarios

(Scenarios 6.1–6.5 from Plan 003 Feature 6 apply here unchanged)

### Checklist

- [x] Startup recovery scan for non-terminal runs (`recover()` queries all runs, filters non-terminal)
- [x] Resume attempt via persistence handle (`recoverRun()` Step 5 creates new agent with `resumeFrom`)
- [x] Idempotent full recovery (`hasRun` flag prevents re-entry)
- [x] All Plan 003 F6 test scenarios passing (132 tests, including new startup scan test)

---

## Feature 4: E2E Test Infrastructure

### User story

> As a developer, I need automated end-to-end tests that validate the minimum reference scenario against real infrastructure, so that regressions in the integration are caught before they reach production.

### Specification

Create Docker-based E2E test infrastructure following the opencode-runtime pattern from `.local/refCode/agent-cowork/`. The E2E tests validate the minimum reference scenario from `product-and-scope.md`:

1. Operator creates a playbook and harness
2. Operator starts a run with inputs
3. Run spawns a real agent that executes the playbook
4. Agent declares phases, governance enforced
5. Approval gate pauses and resumes the run
6. Agent registers required artifacts
7. Run succeeds with all artifacts present
8. Operator can inspect the outcome

### Deliverable standard

1. Docker Compose configuration starts Postgres + control plane + Paseo kernel
2. E2E test creates a run and validates the full lifecycle
3. Tests run in CI (or via `docker compose -f docker-compose.e2e.yml up --abort-on-container-exit`)
4. Minimum reference scenario passes end-to-end

### Test scenarios

#### Scenario 4.1: Minimum reference scenario

- **Given:** Docker services running (Postgres + server with real Paseo)
- **When:** a playbook + harness are created, a run is started, and the agent executes
- **Then:** the run progresses through phases, handles an approval gate, registers artifacts, and completes with `succeeded` status

#### Scenario 4.2: Run failure on missing artifact

- **Given:** a playbook requiring an artifact, and an agent that completes without registering it
- **When:** the completion check runs
- **Then:** the run transitions to `failed` with "required artifact missing" reason

### Checklist

- [ ] Docker Compose E2E configuration with real Paseo
- [ ] E2E test for minimum reference scenario
- [ ] E2E test for failure paths
- [ ] CI-runnable test pipeline

---

## Feature 5: Web UI Integration Tests

### User story

> As a developer, I need automated browser tests for the operator UI, so that UI regressions are caught and Plan 002 Feature 6 test scenarios are formally verified.

### Specification

Use midscenejs for browser automation. Tests validate the operator flows defined in `operator-flows.md`:

1. Playbook list and detail navigation
2. "Start Run" from playbook detail
3. Run list with status filtering
4. Run detail three-section view
5. Approval resolution from run detail
6. Artifact visibility

### Deliverable standard

1. midscenejs configured as a dev dependency
2. Browser tests cover all 4 scenarios from Plan 002 Feature 6
3. Tests run against the dev server (or Docker-based setup)
4. Tests pass in headless mode

### Test scenarios

(Scenarios 6.1–6.4 from Plan 002 Feature 6 apply here)

### Checklist

- [ ] midscenejs configured
- [ ] Playbook browsing test
- [ ] Run creation from playbook test
- [ ] Approval resolution test
- [ ] Run detail three-section view test

---

## Implementation sequence

1. **Feature 1: Paseo Core Package** — no dependencies; everything else needs the real runtime
2. **Feature 2: Control-Plane Wiring** — depends on Feature 1
3. **Feature 3: Recovery Completion** — depends on Feature 2 (needs real AgentManager for persistence handle resume)
4. **Feature 4: E2E Test Infrastructure** — depends on Features 1, 2 (needs real runtime for E2E)
5. **Feature 5: Web UI Integration Tests** — can start in parallel with Features 3, 4 (tests the UI, not the runtime directly)

Features 3, 4, and 5 can be developed in parallel once Feature 2 is complete.

## Evaluation gates

### Gate 1: Paseo core operational

- Feature 1 passes all test scenarios
- A Claude agent can be created, run, and produces events
- Monorepo builds cleanly with the new package

### Gate 2: Live integration functional

- Feature 2 passes all test scenarios
- A run created via the API spawns a real agent and events flow through the system
- Phase governance works against real agents
- Existing 131+ tests still pass

### Gate 3: Recovery complete

- Feature 3 passes all test scenarios
- Plan 003 Feature 6 checklist fully satisfied
- Startup scan is idempotent

### Gate 4: Full E2E validated

- Features 4 and 5 pass all test scenarios
- Minimum reference scenario works end-to-end in Docker
- Operator UI tests pass in headless browser
- Plan 002 Gate 3 and Plan 003 Gate 3 fully satisfied

## Completion criteria

The plan is complete when all of the following are true:

- the forked Paseo core builds and runs within the monorepo
- the control plane creates real agent sessions that execute playbooks
- phase governance, approval gates, and artifact requirements work against real agents
- recovery survives daemon restart with idempotent startup scan
- E2E tests validate the minimum reference scenario
- browser tests validate operator flows
- Plan 002 Gate 3 and Plan 003 Gates 3–4 are fully satisfied
- all contracts, specs, and architecture docs remain consistent
