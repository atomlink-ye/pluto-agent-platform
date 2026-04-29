# SECURITY.md — Pluto MVP-alpha Security Policy

## Secret Handling

**Never commit secrets.** This includes:

- API keys, tokens, credentials
- .env files (use .env.example with placeholders)
- Feishu/Lark/Base/Paseo/OpenCode IDs or tokens
- Connection strings

## Redaction Policy

- Use `.env.example` with placeholder values
- Use `git diff --stat` to check for new sensitive files
- Use `grep -R "sk-" -- src docker docs` as heuristic check

## Forbidden Committed Materials

Do **not** commit:

- `*.token`, `*auth*.json`, `*.key`
- `.env` with real values
- Feishu doc tokens / Base table IDs
- Paseo agent IDs
- OpenCode auth files

## Sensitive Files (Gitignored)

```
.env
.pluto/
.tmp/
node_modules/
dist/
.opencode-serve.json
```

`.paseo-pluto-mvp/root/*.md` may contain redacted execution evidence and is not a place for raw agent IDs, tokens, or credentials.

## Protocol Leak Guard

Live artifacts must not contain:

- `TEAM LEAD ASSIGNMENT`
- `WORKER ASSIGNMENT`
- `SUMMARIZE`
- `[User]`, `[Thought]`, `[Tool]`
- `# System`
- `Instructions from the Team Lead`
- `Reply with your contribution only`

`docker/live-smoke.ts` asserts against these.

## Feishu/Base/Paseo/OpenCode IDs

- IDs are tenant-specific and not secret, but do not commit them in code.
- Use environment variables for configuration.
- Document preconditions in `.paseo-pluto-mvp/root/integration-plan.md`, not in code.

## Security Quick Check

```bash
# Before commit
git diff --stat      # Should not show .env, *.token
grep -R "sk-" src docker docs   # Should return empty
```

## Paid Model Authorization

- Free model: `opencode/minimax-m2.5-free` (default)
- Paid models require explicit authorization in writing (see QUALITY_SCORE.md)