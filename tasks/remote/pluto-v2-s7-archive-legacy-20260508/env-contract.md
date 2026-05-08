# Environment Contract — pluto-v2-s7-archive-legacy-20260508

## Remote image

- Snapshot: `personal-dev-env-vps-5c10g150g`
- Daytona sandbox ID: `c8ef5890-f1d2-4f53-a76d-b6ec6ae38549`
- OS: Linux 6.8.0 x86_64
- Workspace path: `/workspace`
- User: `dev`

## Required tools

- node v22.22.2.
- pnpm 9.12.3 (corepack-pinned; do NOT change `packageManager`).
- git, gh.
- claude / opencode / paseo CLI all already present (S5–S6
  verified).

## Required env names

- `OPENAI_API_KEY` for OpenCode `openai/gpt-5.4` orchestrator.
- `ANTHROPIC_API_KEY` or `CLAUDE_CODE_OAUTH_TOKEN` (for Claude
  Code if used).

## Reference branch (binding pre-flight + post-merge check)

- `legacy-v1.6-harness-prototype` — frozen S0 reference snapshot
  on origin. NEVER push, NEVER delete, NEVER mutate.
- Pre-flight: `git ls-remote origin
  refs/heads/legacy-v1.6-harness-prototype` MUST return a SHA
  before any deletion lands.
- Post-merge: same command MUST return the SAME SHA.

## Runtime selection (post-S7 binding)

`pnpm pluto:run` accepts ONLY:

- `--spec <path>` (required) or `--spec=<path>` (inline).
- `--runtime=v2` (silently accepted, deprecated, one transition
  window).

Anything else exits 1 with the archived-message stderr (verbatim,
single line):

```
v1.6 runtime was archived in S7. Reference copy lives on the legacy-v1.6-harness-prototype branch. v2 takes pluto:run --spec <path> only.
```

`PLUTO_RUNTIME=v1` env var triggers the same archived message
(no silent fallback).

## Synthetic paseo agent spec defaults (carries from S6 — UNCHANGED)

- `provider`: `process.env.PASEO_PROVIDER ?? 'opencode'`.
- `model`: `process.env.PASEO_MODEL ?? 'openai/gpt-5.4-mini'`.
- `mode`: `process.env.PASEO_MODE ?? 'build'`.
- `thinking`: `process.env.PASEO_THINKING` (optional).
- `title`: `pluto-${actorKey}`.
- `labels`: `["slice=v2-cli"]`.
- `initialPrompt`: synthesized from actor role.
- `cwd`: `input.workspaceCwd`.

## Identity

Per-command `pluto <pluto@local>` via `git -c user.name=pluto
-c user.email=pluto@local`. Do NOT mutate global git config.

## Network

- Outbound HTTPS allowed (LLM providers via Paseo, GitHub).
- Inbound: only via Daytona preview-url proxy.

## Live-smoke

NOT REQUIRED in S7. S5 captured the binding fixture; S7 is a
delete-only slice with NO live LLM calls.

## Secrets posture

- Do not print API keys / tokens to logs / artifacts.
- Commit author is `pluto <pluto@local>`.
