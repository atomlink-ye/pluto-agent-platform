# Environment Contract — pluto-v2-t1-spec-prompt-view-runtdir-20260508

## Remote image

- Snapshot: `personal-dev-env-vps-5c10g150g`
- Daytona sandbox ID: `c8ef5890-f1d2-4f53-a76d-b6ec6ae38549`
- OS: Linux 6.8.0 x86_64
- Workspace: `/workspace`
- User: `dev`

## Required tools

- node v22.22.2
- pnpm 9.12.3 (corepack-pinned; do NOT change `packageManager`).
- git, gh
- claude / opencode / paseo CLI all present (verified by S5–S7).

## Required env names

- `OPENAI_API_KEY` for OpenCode `openai/gpt-5.4` orchestrator.
- `ANTHROPIC_API_KEY` or `CLAUDE_CODE_OAUTH_TOKEN` (for Claude
  Code if used).

## Identity

Per-command `pluto <pluto@local>` via `git -c user.name=pluto
-c user.email=pluto@local`. Do NOT mutate global git config.

## Network

- Outbound HTTPS allowed (LLM providers via paseo, GitHub).
- Inbound: only via Daytona preview-url proxy.

## Live-smoke

NOT REQUIRED in T1. T1 is pure data plumbing + CLI surface +
tests; no LLM calls. T3 will run live-smoke against the agentic
mode.

## Secrets posture

- Do not print API keys / tokens to logs / artifacts.
- Commit author is `pluto <pluto@local>`.
