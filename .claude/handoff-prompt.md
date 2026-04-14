# Continue Implementation: Pluto Agent Platform

## Current Status (as of 2026-04-14)

**131 tests passing, 21 test files, clean working tree on `main`.**

### What's Done

| Plan | Feature | Status |
|------|---------|--------|
| 002 F1-F5 | Domain layer (Playbook, Harness, Run, Approvals, Artifacts) | Done — in-memory repos + 23 unit tests |
| 002 F6 | Operator Views (REST API + React frontend) | Done — all V1 pages built |
| 003 F1 | Database Foundation (Drizzle ORM, Postgres schema, repos) | Done — 25 integration + 5 Postgres E2E |
| 003 F2 | Runtime Adapter (Paseo events → RunEvents) + MCP tools | Done — 7 unit + 8 MCP tests |
| 003 F3 | Run Compiler (playbook+harness → live agent) | Done — EnvironmentSpec + rollback |
| 003 F4 | Phase Controller (governance enforcement) | Done — 10 unit tests |
| 003 F5 | RunSession Binding + persistence handle | Done — 3 unit tests |
| 003 F6 | Recovery Service | Done — 6 unit tests |
| 004 F1 | RoleSpec Records (CRUD, validation, API) | Done — 5 tests |
| 004 F2 | TeamSpec Records (CRUD, validation, API) | Done — 7 tests |
| API | API integration test for minimum reference scenario | Done — 002 Gate 3 |
| Infra | Dev server with seed data (4 runs, 3 playbooks) | Done |

| 004 F3 | Supervisor-led Team Run Compilation | Done — 7 tests, team-aware RunCompiler |
| 004 F4 | Handoff Events + MCP tools | Done — 7 tests, HandoffService + create/reject MCP |
| 004 F5 | Operator Views for Team Runs | Done — API team resolution + existing frontend |
| 004 Gates | Gate 3 governance tests + seed data | Done — 3 tests, team run seed |
| Infra | Dev server with seed data (5 runs, 3 playbooks, 3 roles, 1 team) | Done |

### What Remains

1. **Claude Code provider integration** — use glm auth from `~/.zshrc` when integrating Claude Code as a provider
2. **Future plans** — see `docs/exec-plans/tech-debt-tracker.md` for deferred scope

### Infrastructure

- Test Postgres: `docker compose up -d postgres-test` (port 5434, user/pass: `pluto_test`)
- Reset + push schema: `PGPASSWORD=pluto_test psql -h localhost -p 5434 -U pluto_test -d pluto_test -c "DROP SCHEMA public CASCADE; CREATE SCHEMA public;" && cd packages/control-plane && DATABASE_URL="postgres://pluto_test:pluto_test@localhost:5434/pluto_test" npx drizzle-kit push`
- Run tests: `npx vitest run` (from project root)
- Dev server: `pnpm dev` (starts API on 4000 + frontend on 3000)

---

## Implementation Directive

Implement the product described by the **Active Plan**, aligned with the existing specs and the [reference design docs](.local/refDoc/product-redesign/reference).

This is an **iterative implementation loop**. Do not stop at planning only. Each iteration should make concrete progress toward a working product, verified by tests and experiments.

### Source-of-Truth Order
1. **Active Plan** (`docs/exec-plans/active/` and `docs/exec-plans/drafts/`)
2. **Specs** (`docs/product-specs/`, `docs/contracts/`)
3. **Reference design docs** (`.local/refDoc/product-redesign/reference`)

### Decision Hierarchy
1. If the feature is described but not yet fully planned → **propose and add the missing plan**
2. If the specs are incomplete relative to the reference design docs → **fill in the missing specs**
3. If the reference design docs are unreasonable → **revise them with justification**

### Change Management
When proposing spec changes, design changes, plan changes, or important architectural decisions → **delegate to OpenCode for discussion**. In the OpenCode prompt, include: `MUST let @oracle and @council review.` Only for decisions, NOT routine coding.

### Execution Loop
For each iteration:
1. Identify the highest-leverage unfinished item
2. Check whether required spec/plan exists — if missing, create it
3. Implement the smallest meaningful vertical slice
4. Verify with tests
5. Update affected plans/specs/docs
6. **Commit when a stage is done** — don't accumulate
7. Continue until all completion criteria are satisfied

---

## Operational Lessons (from previous sessions)

1. **Worktrees don't contain `.local/`** — run OpenCode tasks needing reference docs from main dir, not worktrees
2. **Schema push required** after any `schema.ts` change — "column X does not exist" means stale test DB
3. **RunService constructor** takes `artifactService` (not the old `checkRequiredArtifacts` function)
4. **Oracle/Council review** only for design/scope decisions, not routine coding
5. **Commit per stage** — don't accumulate multi-feature changes
6. **OpenCode parallel tasks** may share a session and interfere — use worktrees for file isolation or accept serialization

## Key File Paths
- Plan 004 spec: `docs/exec-plans/drafts/004-team-orchestration.md`
- Run Compiler: `packages/control-plane/src/services/run-compiler.ts`
- MCP Tools: `packages/control-plane/src/mcp-tools/index.ts`
- Phase Controller: `packages/control-plane/src/services/phase-controller.ts`
- Repositories: `packages/control-plane/src/repositories.ts`
- In-memory repos: `packages/control-plane/src/repositories/in-memory.ts`
- FakeAgentManager: `packages/control-plane/src/paseo/fake-agent-manager.ts`
- Test factories: `packages/control-plane/src/__tests__/helpers/factories.ts`
- API app: `packages/server/src/api/app.ts`
- Dev server: `packages/server/src/dev-server.ts`
- Frontend pages: `packages/app/src/pages/`

---

## Strategy & Operational Tips

### OpenCode Delegation
- Run `node opencode-companion.mjs task --directory <dir> -- "PROMPT"` via Bash with `run_in_background: true`
- **On timeout/failed notification**: reattach with `node opencode-companion.mjs attach <session-id> --directory <dir>` (also `run_in_background: true`). Session ID is on first line of the original output. Do NOT re-run the task.
- Use `<task>`, `<output_contract>`, `<follow_through>` XML structure for prompts
- Only add `MUST let @oracle and @council review` for design/scope decisions, not routine coding

### Git Discipline
- Commit after each completed feature/stage
- Squash multi-iteration fixes for the same issue into one commit
- Follow existing commit message style (lowercase, imperative)

### Test DB Sync
- After any change to `packages/control-plane/src/infrastructure/database/schema.ts`, re-push schema to test DB before running tests
- `fileParallelism: false` is set in vitest config — required because Postgres test files share the same DB

----
You must do the Ralph loop to ultimately implement this project, as long as the spec is in the product scope.
You have to implement it in an EDD way.
Remember your role as a team lead: orchestration of the task. Delegate coding to OpenCode.
