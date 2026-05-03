# Pluto / Paseo Runtime Boundary

Status: **Drafted for the docs-as-config MVP** on `pluto/paseo-docs-config-mvp`.

## Thesis

Pluto is the **authored docs/config control-plane and evidence layer** over Paseo.

- **Paseo owns runtime transport and session control**: chat/mailbox transport, live agent sessions, and adapter-facing execution lifecycle.
- **Pluto owns authored config, compile/validate, control semantics, audit, and evidence**: the four-layer YAML model, prompt compilation, task/control policy, validation, and durable run evidence.

The boundary is intentionally asymmetric: Pluto may compile down into a normalized runtime package for inspection or execution, but authored Pluto config must not become a thin alias for Paseo transport knobs.

## Pluto vs Paseo ownership matrix

| Concern | Pluto owns | Paseo owns | Boundary note |
|---|---|---|---|
| Authored team/task config | Agents, Playbooks, Scenarios, RunProfiles | None | Four-layer YAML remains Pluto-authored and Pluto-validated. |
| Compile + normalization | Reference resolution, overlay merge, prompt render, workspace policy materialization, compiled `RunPackage` | None | Paseo should receive compiled runtime inputs, not raw authored YAML. |
| Runtime transport | Mailbox mirror contract, typed envelope validation, evidence lineage requirements | Chat room / mailbox transport implementation | Pluto defines the contract; Paseo carries the traffic. |
| Session lifecycle | Required role coverage, orchestration policy, audit expectations | Agent/session creation, follow-up messaging, idle/wait behavior, teardown | Pluto states what must happen; Paseo performs the live session work. |
| Control semantics | Task text resolution, revision-loop policy, approval policy, acceptance/audit gates | None | Keep control semantics in Pluto even when transport stays in Paseo. |
| Workspace policy | Authored workspace intent and materialized compiled path | Live execution inside the provided workspace | Worktree/session mechanics stay adapter/runtime-side unless already authored in Pluto. |
| Evidence + audit | Mailbox/task mirrors, artifact checks, command results, final evidence packet | None | Pluto remains fail-closed on missing evidence. |
| Transport-specific knobs | Only existing outer operator surfaces (`--adapter`, env) | Runtime-specific details | Do not leak new Paseo-specific knobs upward into the authored schema for this MVP. |

## Boundary rules

1. **Authored schema stays Pluto-native.**
   - Agent / Playbook / Scenario / RunProfile describe Pluto intent.
   - Do not add new authored fields whose only purpose is to steer Paseo transport internals.

2. **The compile seam is the handoff seam.**
   - Pluto compiles authored inputs into a normalized `RunPackage`.
   - `pluto:package` exists to inspect that compiled shape locally.
   - `pluto:run` may reuse that compiled shape, but this MVP does not require a full harness rewrite.

3. **Paseo owns live transport/session execution.**
   - Chat room creation, message transport, session lifetime, and runtime-side cleanup remain Paseo/adapter concerns.
   - Pluto should not absorb those responsibilities just because it now has a compiled package layer.

4. **Pluto owns control and audit semantics.**
   - Task resolution, role requirements, revision boundaries, acceptance commands, artifact contracts, and evidence emission remain Pluto behavior.
   - The runtime may execute these semantics through adapters, but the contract lives in Pluto.

5. **Static-loop remains in place during the MVP.**
   - `PLUTO_DISPATCH_MODE=static_loop` is preserved as a compatibility path.
   - Boundary cleanup must not depend on deleting that path in this branch.

6. **Every new cross-boundary field needs an ADR decision first.**
   - If a proposed field changes who owns transport, session, or evidence responsibilities, stop and record the decision before implementation.

## MVP implication for this branch

The smallest useful implementation is:

1. add boundary documentation and migration intent,
2. compile the current four-layer authored inputs into an inspectable normalized `RunPackage`,
3. add `pluto:package` for local inspection, and
4. let `pluto:run` reuse the compiled package path where doing so is cheap and safe.

That is enough to prove the docs-as-config direction without changing the live runtime architecture.

## ADR triggers for follow-on refactor work

Create a boundary ADR before any of the following:

- exposing new Paseo runtime/transport knobs in authored YAML,
- moving evidence ownership out of Pluto,
- replacing Pluto task/control semantics with adapter-owned semantics,
- rewriting the harness around a new runtime abstraction instead of the compiled package seam,
- removing `static_loop`, or
- supporting multiple runtime backends through authored-schema branching.
