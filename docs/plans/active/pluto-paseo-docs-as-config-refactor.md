# Plan: Pluto / Paseo docs-as-config refactor

> **Status (2026-05-07):** this plan targets the v1.6 runtime / docs-as-config surface,
> which is now frozen as legacy. The active replacement is
> [`docs/plans/active/v2-rewrite.md`](v2-rewrite.md). Items here should not be re-opened
> against `main` until the v2 acceptance gates land.

## Status

Status: Active

Current branch slice: `pluto/paseo-docs-config-mvp`

Current MVP target in this branch:

- **A.** Add the migration table and boundary-driven revisions to the active refactor docs.
- **B.** Implement the smallest useful docs-as-config path: compile the current four-layer authored inputs into an inspectable normalized package object and expose it locally.

## Corrected thesis

Pluto is the **docs/config control-plane plus evidence layer over Paseo**.

- **Paseo owns runtime transport and session control.**
- **Pluto owns authored config, compile/validate, control semantics, audit, and evidence.**

The refactor goal is not to turn Pluto into a generic Paseo wrapper. The goal is to make Pluto's authored model compile into a stable package seam that Pluto can inspect, validate, and hand to the runtime without leaking transport-specific concerns upward.

## Scope

### Included in this MVP

- Add an explicit Pluto-vs-Paseo ownership matrix and boundary rules.
- Add a boundary ADR phase to the plan before any broader refactor work.
- Introduce a minimal compiled `RunPackage` seam for the existing four-layer model.
- Add a local inspect command (`pluto:package`).
- Reuse the compiled package path from `pluto:run` only where cheap and safe.
- Fix the current `manager-run-harness.ts` typecheck break around missing `auditEvents` on `finishFailure` call sites.

### Explicitly out of scope

- Full harness rewrite.
- Removing `static_loop`.
- Redesigning runtime semantics beyond what the package/compiler seam needs.
- Moving transport/session lifecycle ownership from Paseo into Pluto.
- Expanding authored schema with new Paseo-specific knobs.

## Ownership-matrix requirement

Before follow-on implementation beyond this MVP, the repo must keep an explicit ownership matrix answering at least:

1. what Pluto authors,
2. what Pluto compiles and validates,
3. what Pluto audits and records as evidence,
4. what Paseo executes as transport/session runtime behavior, and
5. which concerns are intentionally not allowed to cross the boundary.

The authoritative matrix for this slice lives in:

- `docs/design-docs/pluto-paseo-runtime-boundary.md`

## Boundary ADR phase

The broader refactor must start with a short ADR checkpoint before widening scope.

### ADR-0 — boundary freeze for docs-as-config

Required decisions before larger changes:

- Pluto-authored schema remains transport-agnostic.
- `RunPackage` is the first-class compile seam.
- Evidence and audit remain Pluto-owned.
- Runtime transport/session lifecycle remains Paseo-owned.
- `static_loop` stays until a later, separately accepted retirement change.

If any later slice wants to change those decisions, it must update the boundary doc and record the reason before code moves further.

## Migration table

This table is the concrete map for the refactor seam. It is intentionally boundary-driven: the target modules describe where Pluto-owned compile/control responsibilities should settle before any larger runtime reorganization.

| Current file | Target module | Why move / normalize there | Retirement point |
|---|---|---|---|
| `src/four-layer/loader.ts` | `src/four-layer/run-package.ts` | Keep raw authored-object loading separate from compiled run-package assembly. | Retire direct harness/CLI `load + resolve + assemble` call chains once all entrypoints consume compiled package output. |
| `src/four-layer/render.ts` | `src/four-layer/run-package.ts` | Prompt render becomes part of Pluto's compile step, not ad hoc harness assembly. | Retire direct harness prompt assembly once compiled prompts are the only execution input. |
| `src/orchestrator/manager-run-harness.ts` helper assembly (`task`, `team`, workspace resolution, adapter playbook projection) | `src/four-layer/run-package.ts` | These are Pluto-owned compile/control projections and should stop being rebuilt inside the runtime harness. | Retire duplicated helper logic after the harness only consumes compiled package fields. |
| `src/cli/run.ts` selection-to-runtime assembly | `src/cli/package.ts` + shared compiled package path | Both CLIs should resolve the same authored selection into the same normalized package shape. | Retire any divergent selection/assembly behavior between inspect and run commands. |
| Design-doc-only runtime/control framing spread across existing docs | `docs/design-docs/pluto-paseo-runtime-boundary.md` | Boundary language needs one canonical home before code refactor grows. | Retire contradictory Pluto-vs-Paseo ownership wording elsewhere as docs are refreshed. |

## Acceptance criteria

This MVP is accepted only if all of the following are true:

1. `docs/design-docs/pluto-paseo-runtime-boundary.md` exists and states the corrected Pluto-vs-Paseo ownership boundary.
2. This plan records the corrected thesis, ownership-matrix requirement, boundary ADR phase, and migration table.
3. The repo exposes a minimal compiled package path that:
   - loads the current four-layer authored inputs,
   - validates references as today,
   - resolves task/prompt/team/workspace projections into a normalized inspectable object, and
   - does not require a runtime architecture rewrite.
4. A local inspect surface exists (`pluto:package` or equivalent) and prints useful compiled package JSON for a selected scenario/run-profile/playbook/task/workspace.
5. `pluto:run` reuses the compiled package path where that reuse is cheap and safe.
6. `manager-run-harness.ts` typechecks again, including the current `finishFailure` call sites.
7. `static_loop` remains present.
8. Verification passes at the intended MVP level:
   - `pnpm typecheck`
   - targeted tests for the package/compiler path
   - manual local inspection command prints useful output

## Verification target for this branch slice

- `pnpm typecheck`
- targeted tests covering the compiler/package path and the inspect CLI
- `pnpm pluto:package -- --scenario <name> --run-profile <name>`

## Follow-up intentionally deferred

- Full harness decomposition around the compiled package seam.
- Retirement of duplicated runtime helper code beyond the minimal cheap/safe reuse done here.
- Broader doc refresh across all design/reference docs.
- Any authored-schema evolution for multi-runtime support.
