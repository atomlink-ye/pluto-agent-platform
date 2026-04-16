# Operator Flows

## Purpose

This document defines the primary user-visible flows and page expectations for the minimum stable core.

## Flow 1: Start a run from a playbook

### Goal

The operator should be able to understand a playbook and launch a run without first dropping into a raw runtime view.

### Expected flow

1. operator opens the Playbooks view
2. operator selects a playbook
3. operator reviews playbook summary, required inputs, expected outputs, and harness summary
4. operator provides inputs and starts a run
5. operator is routed to the newly created run detail view

### Required UI signals

- playbook intent is clear
- harness is visible as governance, not confused with task semantics
- run creation feedback is immediate and durable

## Flow 2: Inspect active runs

### Goal

The operator should be able to scan active and recent runs quickly.

### Run list expectations

Each row or card should expose:

- run name or identifier
- playbook
- current status
- current phase
- blocker indicator when applicable
- recent activity signal

## Flow 3: Inspect a run in detail

### Goal

The operator should understand business context, governance context, and execution context without mixing them into one undifferentiated stream.

### Run detail sections

#### Business section

- playbook summary
- run goal
- key inputs

#### Governance section

- current phase
- pending approvals
- blocker reason
- required or produced artifacts

#### Operator / debug section

- event timeline
- linked runtime context
- lower-level details needed for investigation

## Flow 4: Resolve approvals

### Goal

Approval handling should be durable, explainable, and linked to the affected run.

### Expected flow

1. run enters `waiting_approval`
2. approval appears in the run detail and in the dedicated approvals queue
3. operator sees what action is being requested and why it matters
4. operator resolves the approval
5. run resumes or transitions accordingly

## Flow 5: Inspect artifacts

### Goal

Artifacts should be visible as formal outputs, not as incidental attachments hidden in logs.

### Expected artifact information

- artifact type
- title or label
- associated run
- producer role or source when available
- purpose or summary

## Flow 6: Understand blocked or failed runs

### Goal

The operator should be able to understand the difference between:

- waiting on approval
- blocked by missing input or constraint
- failed execution
- successfully completed execution

### Minimum requirement

The UI should make those states visually and semantically distinct.

## Flow 7: Enter agent chat from a run

### Goal

The operator should enter agent chat from Run Detail without losing run context, while deep links remain usable when navigation state is absent.

### Chat entry model

1. operator opens Run Detail
2. Run Detail selects the default chat target by preferring a currently running session; if none is running it falls back to another available session
3. chat navigation uses the runtime session identity (`session.session_id` with fallback `session.id`)
4. Team Activity still lets the operator open any other available agent chat from the same run
5. navigation to `/runs/:id/agents/:agentId/chat` carries router state with the selected agent label and run name

### Chat page expectations

- breadcrumbs show `Runs -> {runName} -> Agent Chat`
- the header shows both the agent label and the run reference
- the back action returns to `/runs/:id`

### Deep-link behavior

If the operator lands directly on the chat URL without router state:

- the run reference falls back to the run id from the URL
- the agent label falls back to the streamed agent state name when available, otherwise the `agentId` URL segment
- the page remains usable without requiring a prior click from Run Detail

## V1 page set

Minimum expected pages or equivalent surfaces:

- Playbooks
- Playbook Detail
- Runs
- Run Detail
- dedicated approvals queue plus approval handling inside Run Detail
- artifact sections inside Run Detail; dedicated artifact index deferred

## V1 flow success criteria

The operator can:

- launch a run from a playbook
- observe the run's current phase
- understand whether it is blocked or waiting approval
- resolve approvals from Run Detail or the dedicated approvals queue
- inspect produced artifacts from Run Detail
- distinguish business summary from raw debug detail
