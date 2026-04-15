# FRONTEND.md

## Purpose

This document defines frontend information architecture and UI-facing constraints.

## Frontend stance

The UI should be **run-first and operator-oriented**, not terminal-first.

Paseo gives the repository a strong interaction shell, but the product surface here is different. The operator should primarily navigate through product objects, not runtime implementation details.

## Primary navigation bias

Preferred V1 navigation:

- Playbooks
- Runs
- Approvals

Artifacts, sessions, and operator/debug detail remain primarily surfaced inside **Run Detail**.

The operator surface now includes a dedicated **Approvals** queue for cross-run review and resolution. This route exists to keep pending governance work high-visibility without making lower-level runtime objects the primary navigation model.

Teams may exist in the model before they become a primary V1 navigation destination.

## Information hierarchy

### Business layer first

Users should first see:

- what the task is
- which run is active
- current phase and status
- approvals and blockers
- produced outputs

### Runtime layer second

Timeline internals, raw session detail, and terminal-like traces should remain available but secondary.

## Key screen expectations

### Playbook detail

- explains task intent
- shows expected inputs and outputs
- shows the attached harness summary
- allows creating a run

### Run list

- status
- current phase
- blocker state
- owning playbook
- recent activity

### Run detail

Must clearly separate:

1. business summary
2. governance state
3. operator/debug detail

The operator/debug section includes:

- **Team Activity** — multi-agent coordination visibility (agent status chips, coordination mode, handoff feed). Collapsed by default when idle, expands when handoffs are present.
- **Event Timeline** — chronological run events
- **Agent Chat** — compact preview of the active agent's conversation with a link to the full chat page

### Agent chat

Each run's agent session offers a full-page interactive chat view (`/runs/:id/agents/:agentId/chat`) backed by the Paseo WebSocket protocol. The chat surfaces:

- real-time messages, tool calls, and thinking
- interactive message input
- full conversation history with pagination
- connection state feedback (reconnecting, error)

The chat view is secondary to the run-first model — operators reach it through the Run Detail page, not through primary navigation.

### Approval surfaces

- pending approvals should be explicit and high visibility
- approval context should include run linkage, requested action, and consequences
- approval resolution should work from both Run Detail and the dedicated approvals queue

## V1 frontend constraints

- optimize first for one coherent operator surface
- avoid broad surface-area rewrites before the core run model is stable
- prefer incremental product routes over a full shell rewrite on day one
- keep product terminology consistent everywhere in the UI

## Frontend anti-patterns

- making raw agent sessions the primary object
- exposing workflow graph metaphors that imply rigid pre-authored DAGs
- collapsing approvals, artifacts, and status into low-signal activity streams
- hiding blocker state inside debug-only views
