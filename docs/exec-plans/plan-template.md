# Plan Template

## How to use

Copy this template when creating a new plan under `docs/exec-plans/active/`. Replace all `{placeholders}` and remove this instruction block.

---

# {NNN} — {Plan Title}

## Purpose

One paragraph. What does this plan deliver and why does it matter now.

## Scope

Bullet list of what is included.

## Non-goals

Bullet list of what is explicitly excluded from this plan.

## Authority references

List the authoritative docs this plan depends on. The plan must not contradict these.

- `ARCHITECTURE.md` — {which sections}
- `docs/product-specs/{file}` — {which sections}
- `docs/contracts/{file}` — {which sections}
- `docs/design-docs/{file}` — {which sections}

## Actors

Define who interacts with the system in this plan and their authority level.

| Actor | Description | Authority |
|---|---|---|
| {actor} | {who they are} | {what they can do} |

---

## Feature {N}: {Feature Name}

### User story

> As a {actor}, I want to {action}, so that {outcome}.

### Specification

Describe the expected behavior precisely. Reference authority docs. Include:

- input conditions
- expected system behavior
- output conditions
- error conditions

### Deliverable standard

What "done" looks like for this feature. Each item is pass/fail.

1. {observable outcome 1}
2. {observable outcome 2}
3. {observable outcome 3}

### Test scenarios

Each scenario follows: **Given** (precondition) → **When** (action) → **Then** (assertion).

#### Scenario {N.1}: {name}

- **Given:** {precondition}
- **When:** {action}
- **Then:** {expected result}

#### Scenario {N.2}: {name}

- **Given:** {precondition}
- **When:** {action}
- **Then:** {expected result}

### Checklist

- [ ] implementation complete
- [ ] test scenarios passing
- [ ] deliverable standard verified
- [ ] affected docs updated

---

_Repeat "Feature {N}" block for each feature._

---

## Implementation sequence

Ordered list of features and dependencies.

1. Feature {A} — no dependencies
2. Feature {B} — depends on {A}
3. Feature {C} — depends on {A}
4. Feature {D} — depends on {B}, {C}

## Evaluation gates

Milestone checkpoints. Each gate must pass before work proceeds past it.

### Gate 1: {name}

- {condition 1}
- {condition 2}

### Gate 2: {name}

- {condition 1}
- {condition 2}

## Completion criteria

The plan is complete when all of the following are true:

- all features pass their deliverable standard
- all test scenarios pass
- all affected authority docs remain consistent
- no terminology drift
