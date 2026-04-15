# UI/UX Polish Plan — Iteration 2

## Purpose

Visual consistency and operational polish pass for the Pluto Agent Platform web UI. No new features — only styling, spacing, contrast, and visual hierarchy improvements.

## Audit Summary

### What works well
- Shared component library (Card, Button, Badge, Input, Modal, EmptyState, Skeleton, Pagination, Toast)
- Table styling is consistent across all pages (px-4 py-3 cells, bg-slate-50 thead, divide-y)
- Badge color semantics are correct (blue=active, amber=needs attention, green=success, red=failure)
- Navigation layout and breadcrumbs are clean
- Three-section RunDetail layout (Business / Governance / Operator-Debug) is correct

### Inconsistencies found

#### 1. Design tokens defined but unused
`index.css` defines CSS variables (`--color-surface`, `--color-accent`, etc.) but every component hardcodes Tailwind utilities. The tokens are dead code. All components should reference these tokens via Tailwind's `theme()` or custom utility classes.

#### 2. Border radius inconsistency
| Component | Radius |
|-----------|--------|
| Card | `rounded-lg` |
| Modal | `rounded-xl` |
| RunDetail header | `rounded-xl` |
| TeamActivityFeed | `rounded-xl` |
| ChatSession compact | `rounded-xl` |
| Toast | `rounded-lg` |
| Badge | `rounded-full` |
| Phase progress boxes | `rounded-lg` |

**Rule:** Cards and containers → `rounded-xl`. Inline elements (badges, chips) → `rounded-full`. Form controls → `rounded-lg`.

#### 3. Padding rhythm broken
Cards use `p-4`, `p-5`, `p-6` interchangeably with no pattern. Page spacing alternates between `space-y-6` and `space-y-8`.

**Rule:** Card content padding → `p-5` (standard) or `p-6` (detail pages). Page sections → `space-y-6`. Inter-section gaps → `space-y-8`.

#### 4. Dark section color bleed (critical)
The Operator/Debug section uses `bg-slate-950` background, but child components render with light-mode colors:
- EventTimeline event labels: `text-slate-800` → unreadable on dark bg
- EventTimeline separator: `bg-slate-200` → too bright
- EventTimeline raw JSON: `bg-slate-50` → jarring white box
- Event message text: `text-slate-600` → low contrast

**Fix:** EventTimeline needs a `dark` prop or context-aware styling. When inside dark section, use `text-slate-200`, `bg-slate-800`, `text-slate-400` for muted text.

#### 5. Phase progress lacks pipeline feel
Currently disconnected colored boxes. Needs:
- Horizontal layout with connecting lines between phases (on desktop)
- Step numbers or checkmarks
- Active phase has a subtle pulse or ring
- Completed phases show checkmark

#### 6. Dashboard lacks operational urgency
- StatCards are flat — the accent border helps but needs stronger visual weight
- "Requires Attention" section blends with the rest — needs prominence
- No visual pulse or emphasis for urgent items

**Fix:** Give pending approvals stat card an amber background tint when count > 0. Add a subtle left-side urgency indicator on attention items.

#### 7. Inconsistent empty states
Some places use `<EmptyState>` component, others use inline `<p>` elements:
- "No artifacts produced yet" → inline `<p>`
- "No quality bar attached" → inline `<p>`
- "No pending approvals" → inline `<p>`
- "No events yet" → inline `<p>` in EventTimeline

**Fix:** Use EmptyState for section-level empty states. For inline field-level "none" indicators, use a consistent muted style.

#### 8. Raw HTML buttons in ChatInputArea
The send button and jump-to-bottom button use raw `<button>` elements with custom classes instead of the `Button` component. This creates visual inconsistency.

#### 9. TeamActivityFeed white card inside dark section
TeamActivityFeed renders with `bg-white` when placed inside the dark Operator/Debug section. This is visually jarring — it should adapt to the dark container.

#### 10. Typography scale inconsistency
- Body text alternates between `text-slate-600` and `text-slate-700`
- Section descriptions sometimes omitted

**Rule:** Body text → `text-sm text-slate-600`. Emphasized body → `text-sm text-slate-700 font-medium`.

## Unified Style Rules

### Design Tokens (index.css)
Keep existing tokens and add missing ones:
```css
--radius-container: 0.75rem;   /* 12px, rounded-xl */
--radius-control: 0.5rem;      /* 8px, rounded-lg */
--radius-pill: 9999px;         /* rounded-full */
--spacing-card: 1.25rem;       /* p-5 */
--spacing-card-lg: 1.5rem;     /* p-6 */
--spacing-section: 1.5rem;     /* space-y-6 */
--spacing-page: 2rem;          /* space-y-8 */
```

### Typography Scale
| Role | Classes |
|------|---------|
| Page title | `text-2xl font-semibold tracking-tight text-slate-900` |
| Page description | `mt-1 text-sm text-slate-500` |
| Section header | `text-lg font-semibold text-slate-900` |
| Category label | `text-xs font-medium uppercase tracking-wide text-slate-500` |
| Body text | `text-sm text-slate-600` |
| Emphasized body | `text-sm font-medium text-slate-700` |
| Muted/caption | `text-xs text-slate-500` |
| Mono/ID | `font-mono text-xs text-slate-500` |

### Card Rules
- All cards: `rounded-xl border border-slate-200 bg-white`
- Card padding: `p-5` standard, `p-6` for detail pages
- Highlighted variant: `border-amber-200 bg-amber-50/50`
- Interactive: `hover:border-slate-300 hover:shadow-sm transition-all`

### Button Consistency
Use the `Button` component everywhere. No raw `<button>` elements with custom styling.

### Status Colors (already correct, codified here)
| Semantic | Color |
|----------|-------|
| Active/Running | Blue (blue-600) |
| Needs Attention | Amber (amber-500/600) |
| Success | Emerald (emerald-600) |
| Failure/Error | Red (red-600) |
| Neutral/Inactive | Slate (slate-400/500) |

### Dark Section Rules (Operator/Debug)
- Container: `bg-slate-950 rounded-2xl p-6`
- Section headers: `text-white` / `text-slate-400` for labels
- Cards inside: `border-slate-800 bg-slate-900`
- Body text inside: `text-slate-300`
- Muted text inside: `text-slate-500`
- Separators: `border-slate-800`

## Implementation Scope

### Files to modify

#### Components (style changes only)
1. `Card.tsx` — update radius to `rounded-xl`
2. `EventTimeline.tsx` — add dark mode support via prop
3. `TeamActivityFeed.tsx` — add dark mode support
4. `ChatSession.tsx` — adapt compact mode for dark container
5. `EmptyState.tsx` — minor style tuning
6. `ChatInputArea.tsx` — use Button component for send button
7. `ChatMessageList.tsx` — use Button for jump-to-bottom
8. `Toast.tsx` — update radius to `rounded-xl`

#### Pages (class adjustments)
1. `DashboardPage.tsx` — stat card urgency, attention section prominence, card padding
2. `RunDetailPage.tsx` — phase progress pipeline, card padding, dark section fixes
3. `RunListPage.tsx` — card padding consistency
4. `PlaybookListPage.tsx` — card padding consistency
5. `PlaybookDetailPage.tsx` — card padding consistency
6. `PlaybookFormPage.tsx` — card padding consistency
7. `ApprovalsPage.tsx` — card padding consistency
8. `ChatPage.tsx` — minor spacing

#### Styles
1. `index.css` — add radius/spacing tokens, update body text

### Files NOT modified
- `api.ts` — no changes
- `types/paseo.ts` — no changes
- All hooks — no changes
- `App.tsx` — no changes
- `main.tsx` — no changes

## Priority tiers

### P0 — Must fix
- Dark section color bleed (EventTimeline, TeamActivityFeed, ChatSession in dark)
- Card border radius consistency → `rounded-xl`
- Card padding consistency → `p-5`/`p-6`
- Typography scale enforcement (body text `text-slate-600` everywhere)

### P1 — Should fix
- Phase progress pipeline visual
- Dashboard operational urgency (stat card tint, attention prominence)
- Raw buttons → Button component in chat components

### P2 — Nice to have
- Design token CSS variables actually used by components
- Additional spacing/radius CSS custom properties
- Loading skeleton refinement

## Acceptance bar

1. Every card uses `rounded-xl`
2. Every card uses `p-5` or `p-6` (no `p-4` on cards)
3. EventTimeline is readable inside the dark Operator/Debug section
4. TeamActivityFeed adapts to dark container
5. Phase progress shows a connected pipeline with checkmarks
6. Dashboard stat cards show urgency tinting for non-zero alert counts
7. No raw `<button>` elements — all use `Button` component
8. Body text consistently uses `text-slate-600`
9. `tsc --noEmit` passes
10. All pages render correctly (visual verification)
