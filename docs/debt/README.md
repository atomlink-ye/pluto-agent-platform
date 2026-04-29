# docs/debt/README.md — Technical Debt Tracking

This directory tracks known technical debt in Pluto MVP-alpha.

## Purpose

- Make debt visible and actionable
- Prevent debt from being forgotten
- Prioritize remediation

## Debt Categories

| Category | Description |
|----------|-------------|
| **Missing tests** | Coverage gaps |
| **Hardcoded values** | Should be configurable |
| **Duplicated code** | DRY violations |
| **Outdated docs** | Doc drift |
| **Workarounds** | Temporary hacks |

## Format

```markdown
# Debt: <title>

## Impact
<What happens if we don't fix this>

## Root Cause
<Why it exists>

## Remediation
<How to fix it>

## Priority
P0 / P1 / P2 / P3

## Status
- [ ] Open
- [ ] In progress
- [ ] Resolved

## Notes
<Misc>
```

## Known Debt

List known debt items:

- (none yet — MVP is greenfield)

## Related

- `docs/plans/README.md` — Active work plans
- `docs/mvp-alpha.md` — MVP object contracts