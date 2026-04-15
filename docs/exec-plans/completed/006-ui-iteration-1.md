# UI Improvement Plan — Pluto Agent Platform

## Overview

This document specifies the complete UI redesign for the Pluto Agent Platform web application. The app uses React 19 + Vite + Tailwind CSS v4 (no component library). The backend API is fully built. The current UI has 5 read-only pages with no creation flows, no search, no real-time updates, and bare-bones styling.

**Design principles:**
- Run-first, operator-oriented
- Business layer first (task intent, phase, blockers, outputs before debug)
- Three-layer separation in Run Detail (business / governance / operator-debug)
- Approvals are durable first-class objects
- Operator must quickly see: what is running, what phase, why blocked, what is pending, what was produced

---

## 1. Design System Foundation

### 1.1 CSS Custom Properties (in packages/app/src/index.css)

Since the project uses Tailwind v4 via `@import "tailwindcss"` without a config file, all semantic tokens are defined as CSS variables in `index.css`:

```css
@layer base {
  :root {
    --color-surface: theme(colors.white);
    --color-surface-subtle: theme(colors.slate.50);
    --color-surface-muted: theme(colors.slate.100);
    --color-border: theme(colors.slate.200);
    --color-border-strong: theme(colors.slate.300);
    --color-text-primary: theme(colors.slate.900);
    --color-text-secondary: theme(colors.slate.600);
    --color-text-muted: theme(colors.slate.400);
    --color-accent: theme(colors.blue.600);
    --color-accent-hover: theme(colors.blue.700);
    --color-success: theme(colors.emerald.600);
    --color-warning: theme(colors.amber.600);
    --color-danger: theme(colors.red.600);
    --color-info: theme(colors.blue.500);
  }
}
```

### 1.2 Typography Scale

| Role | Tailwind Classes |
|---|---|
| page-title | `text-2xl font-semibold text-slate-900 tracking-tight` |
| section-heading | `text-lg font-semibold text-slate-800` |
| card-title | `text-base font-medium text-slate-900` |
| body | `text-sm text-slate-700 leading-relaxed` |
| label | `text-xs font-medium text-slate-500 uppercase tracking-wide` |
| caption | `text-xs text-slate-400` |
| mono | `font-mono text-xs text-slate-600` |
| mono-heading | `font-mono text-sm font-semibold text-slate-800` |

Business-layer content: `font-sans`. Operator/debug content: `font-mono` to create immediate visual distinction.

### 1.3 Spacing Conventions

- Component internal padding: `p-4` (cards), `p-6` (page sections)
- Card gap in grids: `gap-4` (dense) / `gap-6` (relaxed)
- Section vertical spacing: `space-y-6` between major sections
- Form field spacing: `space-y-4`
- Page top padding: `pt-6` below header
- Page horizontal padding: `px-4 sm:px-6 lg:px-8`
- Max content width: `max-w-7xl mx-auto`

### 1.4 Component Inventory

#### Button

```
<Button variant="primary|secondary|ghost|danger" size="sm|md|lg" loading={bool}>
```

Tailwind patterns:

- **primary**: `inline-flex items-center gap-2 rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors`
- **secondary**: `inline-flex items-center gap-2 rounded-md bg-white px-4 py-2 text-sm font-medium text-slate-700 border border-slate-300 hover:bg-slate-50 disabled:opacity-50 transition-colors`
- **ghost**: `inline-flex items-center gap-2 rounded-md px-3 py-1.5 text-sm font-medium text-slate-600 hover:bg-slate-100 hover:text-slate-900 transition-colors`
- **danger**: `inline-flex items-center gap-2 rounded-md bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-700 disabled:opacity-50 transition-colors`
- **loading state**: append `opacity-75 cursor-wait` and replace icon with a spinning SVG: `<svg class="animate-spin h-4 w-4" ...>`

Size modifiers: `sm` → `px-3 py-1.5 text-xs`, `lg` → `px-5 py-2.5 text-base`

#### Card

```
<Card variant="default|highlighted|interactive">
```

- **default**: `bg-white rounded-lg border border-slate-200 p-4`
- **highlighted**: `bg-amber-50 rounded-lg border border-amber-200 p-4` (for pending approvals)
- **interactive**: `bg-white rounded-lg border border-slate-200 p-4 hover:border-slate-300 hover:shadow-sm transition-all cursor-pointer`

#### Badge (status variants)

Extends the existing `StatusBadge.tsx`. All variants use: `inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium`

| Status | Classes |
|---|---|
| pending | `bg-slate-100 text-slate-600` |
| running | `bg-blue-50 text-blue-700` with `animate-pulse` dot: `<span class="w-1.5 h-1.5 rounded-full bg-blue-500 animate-pulse">` |
| pending_approval | `bg-amber-50 text-amber-700 border border-amber-200` |
| succeeded | `bg-emerald-50 text-emerald-700` |
| failed | `bg-red-50 text-red-700` |
| cancelled | `bg-slate-100 text-slate-500` |

#### Modal / Dialog

```
<Modal open={bool} onClose={fn} title="string" size="sm|md|lg">
  <Modal.Body>...</Modal.Body>
  <Modal.Footer>...</Modal.Footer>
</Modal>
```

Structure:
```
<!-- Backdrop -->
<div class="fixed inset-0 bg-slate-900/50 backdrop-blur-sm z-40 transition-opacity">
  <!-- Panel -->
  <div class="fixed inset-0 z-50 flex items-center justify-center p-4">
    <div class="bg-white rounded-xl shadow-xl w-full max-w-md max-h-[90vh] flex flex-col">
      <!-- Header -->
      <div class="flex items-center justify-between px-6 py-4 border-b border-slate-200">
        <h2 class="text-lg font-semibold text-slate-900">{title}</h2>
        <button class="text-slate-400 hover:text-slate-600">✕</button>
      </div>
      <!-- Body (scrollable) -->
      <div class="flex-1 overflow-y-auto px-6 py-4">{children}</div>
      <!-- Footer -->
      <div class="flex items-center justify-end gap-3 px-6 py-4 border-t border-slate-200 bg-slate-50">
        {actions}
      </div>
    </div>
  </div>
</div>
```

Size variants: `sm` → `max-w-sm`, `md` → `max-w-md`, `lg` → `max-w-2xl`

#### Form Inputs

```
<Input label="string" error="string|null" placeholder="string" />
<Textarea label="string" error="string|null" rows={4} />
<Select label="string" options={[{value, label}]} error="string|null" />
```

Base input classes: `w-full rounded-md border border-slate-300 px-3 py-2 text-sm text-slate-900 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-colors`

Error state: replace border class with `border-red-400 focus:ring-red-400`

Label: `<label class="block text-xs font-medium text-slate-600 mb-1">`

Error message: `<p class="mt-1 text-xs text-red-600">{error}</p>`

Field wrapper: `<div class="space-y-1">`

#### LoadingSkeleton

```
<Skeleton width="full|half|quarter" height="sm|md|lg" rounded="sm|md|full" />
```

Base: `animate-pulse bg-slate-200 rounded`

Heights: `sm` → `h-4`, `md` → `h-6`, `lg` → `h-10`

For card skeletons, compose multiple Skeletons:
```
<div class="bg-white rounded-lg border border-slate-200 p-4 space-y-3">
  <Skeleton height="md" width="half" />
  <Skeleton height="sm" width="full" />
  <Skeleton height="sm" width="three-quarter" />
</div>
```

#### EmptyState

```
<EmptyState
  icon={<SvgIcon />}
  title="No runs yet"
  description="Start a run from a Playbook to see results here."
  action={<Button variant="primary">Go to Playbooks</Button>}
/>
```

Structure: `flex flex-col items-center justify-center py-16 text-center`
Icon wrapper: `w-12 h-12 rounded-full bg-slate-100 flex items-center justify-center mb-4 text-slate-400`
Title: `text-base font-medium text-slate-900 mb-1`
Description: `text-sm text-slate-500 max-w-sm mb-4`

#### Breadcrumb

```
<Breadcrumb items={[{label, href?}]} />
```

Structure:
```
<nav class="flex items-center gap-1 text-sm">
  {items.map((item, i) => (
    <>
      {i > 0 && <span class="text-slate-300">/</span>}
      {item.href
        ? <a class="text-slate-500 hover:text-slate-900 transition-colors">{item.label}</a>
        : <span class="text-slate-900 font-medium">{item.label}</span>
      }
    </>
  ))}
</nav>
```

#### Pagination

```
<Pagination page={number} pageSize={number} total={number} onPageChange={fn} />
```

Structure: `flex items-center gap-1`
Button base: `inline-flex items-center justify-center w-8 h-8 rounded text-sm`
Active: `bg-blue-600 text-white font-medium`
Inactive: `text-slate-600 hover:bg-slate-100`
Prev/Next: ghost button with chevron icon, disabled when at boundary

---

## 2. Layout & Navigation Improvements

### 2.1 App Shell Structure

```
<div class="min-h-screen bg-slate-50 flex">
  <Sidebar />
  <div class="flex-1 flex flex-col min-w-0">
    <Header />               {/* sticky top bar with breadcrumb */}
    <main class="flex-1 px-4 sm:px-6 lg:px-8 py-6">
      {pageContent}
    </main>
  </div>
</div>
```

### 2.2 Sidebar Redesign

Current: fixed 256px, 3 plain links.
New design: collapsible sidebar with icon + label, active state, pending count badge.

```
<aside class="w-64 shrink-0 bg-white border-r border-slate-200 flex flex-col h-screen sticky top-0">
  {/* Logo area */}
  <div class="h-14 flex items-center px-4 border-b border-slate-200">
    <span class="text-base font-semibold text-slate-900">Pluto Platform</span>
  </div>

  {/* Nav items */}
  <nav class="flex-1 p-3 space-y-0.5">
    <NavItem href="/dashboard" icon={HomeIcon} label="Dashboard" />
    <NavItem href="/playbooks" icon={BookIcon} label="Playbooks" />
    <NavItem href="/runs" icon={PlayIcon} label="Runs" />
    <NavItem href="/approvals" icon={CheckIcon} label="Approvals" badge={pendingCount} />
  </nav>
</aside>
```

NavItem active state: `bg-blue-50 text-blue-700 font-medium`
NavItem base: `flex items-center gap-3 rounded-md px-3 py-2 text-sm text-slate-600 hover:bg-slate-100 hover:text-slate-900 transition-colors w-full`
Badge: `ml-auto inline-flex items-center justify-center rounded-full bg-amber-100 text-amber-700 text-xs font-medium px-2 py-0.5 min-w-[20px]`

**Collapsible behavior** (P1): Add a toggle button at bottom of sidebar. Collapsed state = 56px wide, icons only, tooltips on hover. Use `lg:w-64` / `lg:w-14` with a React context boolean `sidebarCollapsed`.

### 2.3 Header Bar

```
<header class="h-14 sticky top-0 z-10 bg-white/80 backdrop-blur-sm border-b border-slate-200 flex items-center px-4 sm:px-6 lg:px-8 gap-4">
  <Breadcrumb items={breadcrumbs} />
  <div class="ml-auto flex items-center gap-2">
    {pageActions}   {/* page-specific action buttons rendered via React context or prop */}
  </div>
</header>
```

`pageActions` slot: each page sets its own header actions (e.g., "New Playbook" button on the Playbook List). Use a `usePageActions` React context hook to register actions from within page components.

### 2.4 Responsive Strategy

- Sidebar: visible by default on `lg:` and above. On smaller screens, hidden by default with a hamburger toggle revealing it as an overlay drawer.
- Content grid: `grid-cols-1 md:grid-cols-2 lg:grid-cols-3` for card grids.
- Run Detail three-section layout: `flex flex-col lg:flex-row` — on large screens, governance panel sits to the right; on mobile, stacked below.

---

## 3. Page-by-Page Redesign Specifications

### 3.1 Dashboard / Home (NEW)

**Information Architecture**
1. Page title: "Dashboard"
2. Summary row: 4 stat cards (Active Runs, Pending Approvals, Succeeded Today, Failed Today)
3. Requires Attention section: failed runs + pending approvals combined, max 5 items, highest priority first
4. Recent Runs section: last 10 runs across all status, table layout

**Component Composition**
```
<DashboardPage>
  <PageHeader title="Dashboard" />

  {/* Stat cards */}
  <div class="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
    <StatCard label="Active Runs" value={activeCount} color="blue" />
    <StatCard label="Pending Approvals" value={pendingCount} color="amber" href="/approvals" />
    <StatCard label="Succeeded Today" value={succeededCount} color="emerald" />
    <StatCard label="Failed" value={failedCount} color="red" />
  </div>

  {/* Requires attention */}
  {attentionItems.length > 0 && (
    <section class="mb-8">
      <h2 class="text-lg font-semibold text-slate-800 mb-3">Requires Attention</h2>
      <div class="space-y-2">
        {attentionItems.map(item => <AttentionRow item={item} />)}
      </div>
    </section>
  )}

  {/* Recent runs */}
  <section>
    <div class="flex items-center justify-between mb-3">
      <h2 class="text-lg font-semibold text-slate-800">Recent Runs</h2>
      <Link href="/runs" class="text-sm text-blue-600 hover:underline">View all →</Link>
    </div>
    <RunTable runs={recentRuns} />
  </section>
</DashboardPage>
```

**StatCard** structure: `bg-white rounded-lg border border-slate-200 p-4`; value as `text-2xl font-semibold`; label as caption. Color accent applied to a left border: `border-l-4 border-l-blue-500`.

**States**: Loading → 4 skeleton stat cards + skeleton table rows. Empty → EmptyState with "No runs yet" and CTA to Playbooks.

**Interactions**: Stat cards are clickable links to filtered run lists. Attention items link to Run Detail or Approvals.

**Polling**: Refresh every 30 seconds when tab is visible (for stat counts and attention items).

---

### 3.2 Playbook List Page

**Information Architecture**
1. Page title: "Playbooks" + "New Playbook" button in header actions
2. Search input
3. Results count
4. Card grid (1 → 2 → 3 columns)

**Component Composition**
```
<PlaybookListPage>
  {/* Search + filter bar */}
  <div class="flex items-center gap-3 mb-6">
    <div class="relative flex-1 max-w-sm">
      <SearchIcon class="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
      <input
        class="w-full pl-9 pr-4 py-2 rounded-md border border-slate-300 text-sm ..."
        placeholder="Search playbooks..."
        value={search}
        onChange={setSearch}
      />
    </div>
    <span class="text-sm text-slate-500">{filtered.length} playbooks</span>
  </div>

  {/* Card grid */}
  {loading && <PlaybookGridSkeleton />}
  {!loading && filtered.length === 0 && (
    <EmptyState
      title={search ? "No matching playbooks" : "No playbooks yet"}
      description={search ? "Try a different search term." : "Create your first playbook to get started."}
      action={<Button variant="primary" onClick={openCreate}>New Playbook</Button>}
    />
  )}
  {!loading && filtered.length > 0 && (
    <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
      {filtered.map(p => <PlaybookCard key={p.id} playbook={p} />)}
    </div>
  )}
</PlaybookListPage>
```

**PlaybookCard**:
```
<Card variant="interactive" onClick={() => navigate(`/playbooks/${p.id}`)}>
  <div class="flex items-start justify-between mb-2">
    <h3 class="text-base font-medium text-slate-900 line-clamp-1">{p.name}</h3>
  </div>
  <p class="text-sm text-slate-500 line-clamp-2 mb-3">{p.description || p.task_intent?.goal}</p>
  <div class="flex items-center gap-3 text-xs text-slate-400">
    <span>{p.harness_count ?? 0} harnesses</span>
    <span>·</span>
    <span>{p.run_count ?? 0} runs</span>
  </div>
</Card>
```

**States**: Loading → 6 card skeletons. Empty (no playbooks) → EmptyState with "New Playbook" CTA. Empty (search) → EmptyState with clear-search option.

**Interactions**: 
- Search input filters client-side on `name` and `description` fields (no debounce needed for small lists; add 200ms debounce if list exceeds 50)
- "New Playbook" button in header navigates to `/playbooks/new`
- Clicking a card navigates to `/playbooks/:id`

---

### 3.3 Playbook Detail Page

**Information Architecture**
1. Breadcrumb: Playbooks / {name}
2. Page title + "Edit" button + "Start Run" button
3. Two-column layout (lg: and above):
   - Left (2/3): Intent block (goal, instructions, expected artifacts, quality bar)
   - Right (1/3): Technical metadata (inputs schema, attached harnesses, tags)
4. Recent Runs section (bottom, full width): last 5 runs for this playbook

**Component Composition**
```
<PlaybookDetailPage>
  <div class="flex items-start justify-between mb-6">
    <div>
      <h1 class="text-2xl font-semibold text-slate-900">{playbook.name}</h1>
      <p class="text-sm text-slate-500 mt-1">{playbook.description}</p>
    </div>
    <div class="flex items-center gap-2">
      <Button variant="secondary" onClick={() => navigate(`/playbooks/${id}/edit`)}>Edit</Button>
      <Button variant="primary" onClick={openStartRunModal}>Start Run</Button>
    </div>
  </div>

  <div class="grid grid-cols-1 lg:grid-cols-3 gap-6 mb-8">
    {/* Left: Intent */}
    <div class="lg:col-span-2 space-y-4">
      <Card>
        <h2 class="section-heading mb-3">Task Intent</h2>
        <div class="space-y-3">
          <Field label="Goal" value={intent.goal} />
          <Field label="Instructions" value={intent.instructions} multiline />
          {intent.expected_artifacts && <Field label="Expected Artifacts" value={intent.expected_artifacts} />}
          {intent.quality_bar && <Field label="Quality Bar" value={intent.quality_bar} />}
        </div>
      </Card>
    </div>

    {/* Right: Technical */}
    <div class="space-y-4">
      {playbook.inputs && Object.keys(playbook.inputs).length > 0 && (
        <Card>
          <h2 class="section-heading mb-3">Input Schema</h2>
          <pre class="font-mono text-xs text-slate-600 bg-slate-50 rounded p-3 overflow-x-auto">
            {JSON.stringify(playbook.inputs, null, 2)}
          </pre>
        </Card>
      )}
      <Card>
        <h2 class="section-heading mb-3">Attached Harnesses</h2>
        {harnesses.length === 0
          ? <p class="text-sm text-slate-400">No harnesses attached</p>
          : harnesses.map(h => <HarnessRow key={h.id} harness={h} />)
        }
      </Card>
    </div>
  </div>

  {/* Recent Runs */}
  <section>
    <h2 class="section-heading mb-3">Recent Runs</h2>
    <RunTable runs={recentRuns} emptyMessage="No runs yet for this playbook." />
  </section>

  {/* Start Run Modal */}
  <StartRunModal
    open={showStartRun}
    onClose={() => setShowStartRun(false)}
    playbook={playbook}
    onSuccess={(runId) => navigate(`/runs/${runId}`)}
  />
</PlaybookDetailPage>
```

**StartRunModal**: Modal size `lg`. Body contains a dynamic form generated from `playbook.inputs` schema. Each key in the schema renders an appropriate input (text, textarea, or JSON editor). Footer has "Cancel" (secondary) and "Start Run" (primary, loading state during submission). On success, navigate to the new Run Detail page and show a success toast.

**States**: Loading → skeleton for both columns. Error → error card with retry. 

**Interactions**: "Edit" navigates to `/playbooks/:id/edit`. "Start Run" opens StartRunModal. Harness row is clickable to harness detail (future).

---

### 3.4 Playbook Create / Edit Page (NEW)

**Route**: `/playbooks/new` and `/playbooks/:id/edit`

**Information Architecture**
1. Breadcrumb: Playbooks / New (or Playbooks / {name} / Edit)
2. Page title: "New Playbook" or "Edit Playbook"
3. Stacked form sections:
   - Basic Info (name, description)
   - Task Intent (goal, instructions, expected artifacts, quality bar)
   - Inputs Schema (key-value pairs for input definitions)
   - Tags (comma-separated text input)
4. Sticky bottom action bar: Cancel + Save

**Component Composition**
```
<PlaybookFormPage>
  <h1 class="page-title mb-6">{isEdit ? 'Edit Playbook' : 'New Playbook'}</h1>

  <div class="max-w-2xl space-y-6">
    <Card>
      <h2 class="section-heading mb-4">Basic Information</h2>
      <div class="space-y-4">
        <Input label="Name" name="name" required error={errors.name} />
        <Textarea label="Description" name="description" rows={2} />
      </div>
    </Card>

    <Card>
      <h2 class="section-heading mb-4">Task Intent</h2>
      <div class="space-y-4">
        <Textarea label="Goal" name="goal" rows={2} required error={errors.goal} />
        <Textarea label="Instructions" name="instructions" rows={5} />
        <Textarea label="Expected Artifacts" name="expected_artifacts" rows={2} />
        <Textarea label="Quality Bar" name="quality_bar" rows={2} />
      </div>
    </Card>

    <Card>
      <h2 class="section-heading mb-4">Input Schema</h2>
      <p class="text-sm text-slate-500 mb-3">Define the inputs this playbook requires when starting a run.</p>
      <InputSchemaEditor value={inputs} onChange={setInputs} />
    </Card>
  </div>

  {/* Sticky action bar */}
  <div class="sticky bottom-0 bg-white border-t border-slate-200 px-4 sm:px-6 lg:px-8 py-4 -mx-4 sm:-mx-6 lg:-mx-8 mt-8">
    <div class="max-w-2xl flex items-center justify-end gap-3">
      <Button variant="secondary" onClick={() => navigate(-1)}>Cancel</Button>
      <Button variant="primary" loading={submitting} onClick={handleSubmit}>
        {isEdit ? 'Save Changes' : 'Create Playbook'}
      </Button>
    </div>
  </div>
</PlaybookFormPage>
```

**InputSchemaEditor**: A list of key-value row pairs. Each row: text input for key + select for type (string/number/boolean) + delete button. "Add Input" button at bottom adds a new row. On change, serializes to object shape for API.

**Validation**: Name required; Goal required. Errors shown inline below fields. Submitted with POST `/api/playbooks` (new) or PUT `/api/playbooks/:id` (edit).

**States**: Edit mode → fetch existing playbook and populate form. Loading fetch → form inputs show skeletons. Submission → button loading state. Success → navigate to `/playbooks/:id` with success toast.

---

### 3.5 Harness Create / Edit (Modal approach)

Since harnesses are attached to playbooks and operators rarely edit them standalone, use a **modal** triggered from Playbook Detail rather than a separate page.

**Trigger**: "Attach Harness" button on Playbook Detail → opens HarnessModal in "create and attach" mode. Existing harness row → "Edit" action.

**Modal size**: `lg` (max-w-2xl)

**Information Architecture**
1. Name, description
2. Phase definitions (ordered list of phases; each phase has: name, description, optional approval gate boolean)
3. Max retries, timeout settings

**Component Composition (modal body)**
```
<HarnessModal>
  <div class="space-y-4">
    <Input label="Name" name="name" required error={errors.name} />
    <Textarea label="Description" name="description" rows={2} />

    <div>
      <div class="flex items-center justify-between mb-2">
        <label class="label-class">Phases</label>
        <Button variant="ghost" size="sm" onClick={addPhase}>+ Add Phase</Button>
      </div>
      <div class="space-y-2">
        {phases.map((phase, i) => (
          <div class="flex items-start gap-2 p-3 bg-slate-50 rounded-md border border-slate-200">
            <span class="text-xs font-mono text-slate-400 mt-2 w-4">{i+1}</span>
            <div class="flex-1 space-y-2">
              <Input placeholder="Phase name" value={phase.name} onChange={...} />
              <label class="flex items-center gap-2 text-sm text-slate-600">
                <input type="checkbox" checked={phase.requires_approval} onChange={...} />
                Requires approval gate
              </label>
            </div>
            <Button variant="ghost" size="sm" onClick={() => removePhase(i)}>✕</Button>
          </div>
        ))}
      </div>
    </div>
  </div>
</HarnessModal>
```

**States**: Submission → button loading. Success → close modal, refresh harness list on Playbook Detail, show toast "Harness created and attached."

---

### 3.6 Run List Page

**Information Architecture**
1. Page title: "Runs"
2. Status filter tabs: All | Running | Pending Approval | Succeeded | Failed | Cancelled
3. Search input (filter by playbook name or run ID)
4. Results count + pagination
5. Run table (not cards — table is more scannable for status-heavy data)

**Component Composition**
```
<RunListPage>
  {/* Status filter tabs */}
  <div class="flex items-center gap-1 border-b border-slate-200 mb-4 -mx-4 sm:-mx-6 lg:-mx-8 px-4 sm:px-6 lg:px-8">
    {STATUS_TABS.map(tab => (
      <button
        class={cx(
          "px-3 py-2.5 text-sm font-medium border-b-2 transition-colors",
          activeTab === tab.value
            ? "border-blue-600 text-blue-700"
            : "border-transparent text-slate-500 hover:text-slate-700 hover:border-slate-300"
        )}
        onClick={() => setActiveTab(tab.value)}
      >
        {tab.label}
        {tab.count > 0 && (
          <span class="ml-1.5 rounded-full bg-slate-100 text-slate-600 text-xs px-1.5 py-0.5">{tab.count}</span>
        )}
      </button>
    ))}
  </div>

  {/* Search */}
  <div class="relative mb-4 max-w-sm">
    <SearchIcon class="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
    <input class="w-full pl-9 pr-4 py-2 ..." placeholder="Search by playbook or run ID..." />
  </div>

  {/* Table */}
  {loading && <RunTableSkeleton rows={8} />}
  {!loading && runs.length === 0 && <EmptyState title="No runs found" />}
  {!loading && runs.length > 0 && (
    <div class="bg-white rounded-lg border border-slate-200 overflow-hidden">
      <table class="w-full text-sm">
        <thead class="bg-slate-50 border-b border-slate-200">
          <tr>
            <th class="text-left px-4 py-3 text-xs font-medium text-slate-500 uppercase">Playbook</th>
            <th class="text-left px-4 py-3 text-xs font-medium text-slate-500 uppercase">Status</th>
            <th class="text-left px-4 py-3 text-xs font-medium text-slate-500 uppercase">Phase</th>
            <th class="text-left px-4 py-3 text-xs font-medium text-slate-500 uppercase">Started</th>
            <th class="text-left px-4 py-3 text-xs font-medium text-slate-500 uppercase">Duration</th>
            <th class="px-4 py-3"></th>
          </tr>
        </thead>
        <tbody class="divide-y divide-slate-100">
          {runs.map(run => <RunRow key={run.id} run={run} />)}
        </tbody>
      </table>
    </div>
  )}

  <Pagination page={page} pageSize={20} total={total} onPageChange={setPage} />
</RunListPage>
```

**RunRow**: `<tr class="hover:bg-slate-50 cursor-pointer" onClick={() => navigate(...)}>` . Columns: playbook name (bold) + run ID (mono caption below); StatusBadge; current phase name (or em-dash if none); relative time ("2 min ago"); elapsed duration; arrow icon.

**STATUS_TABS**: `[{value: 'all', label: 'All'}, {value: 'running', label: 'Running'}, {value: 'pending_approval', label: 'Pending Approval'}, {value: 'succeeded', label: 'Succeeded'}, {value: 'failed', label: 'Failed'}]`

**States**: Loading → table skeleton (8 rows of animated grey bars). Empty (tab has no results) → inline empty message within table area. Error → error card with retry.

**Interactions**: Tab click filters `status` param. Search filters `playbook_name` param. Both reset page to 1. Row click navigates to `/runs/:id`. Tab counts fetched from the same API response or a summary endpoint.

**Polling**: When the "Running" or "All" tab is active and there are running runs, poll `GET /api/runs` every 10 seconds.

---

### 3.7 Run Detail Page

This is the most important page redesign. The three-layer separation (Business / Governance / Operator-Debug) must be visually unambiguous.

**Information Architecture**
1. Breadcrumb: Runs / {run.id}
2. Run header: playbook name, run ID (mono), status badge, start time, duration, Cancel Run button (if running)
3. Section 1 — Business Layer (always visible, full width):
   - Current phase name + progress indicator
   - Provided inputs (collapsible if large)
   - Current blockers (amber highlight if any)
   - Produced outputs / artifacts (links to download)
4. Section 2 — Governance Layer (right panel on lg, below business on mobile):
   - Attached harness name
   - Quality bar
   - Approvals: pending approvals shown as high-visibility cards; resolved approvals in a compact list
5. Section 3 — Operator/Debug Layer (bottom, visually distinct dark section or separate tab):
   - Event timeline as visual stepper (not raw text list)
   - Toggle to show raw event JSON
   - Raw log area

**Component Composition**
```
<RunDetailPage>
  {/* Run header */}
  <div class="flex items-start justify-between mb-6">
    <div>
      <h1 class="text-2xl font-semibold text-slate-900">{run.playbook_name}</h1>
      <div class="flex items-center gap-3 mt-1">
        <span class="font-mono text-sm text-slate-500">{run.id}</span>
        <StatusBadge status={run.status} />
      </div>
    </div>
    {run.status === 'running' && (
      <Button variant="danger" onClick={handleCancel}>Cancel Run</Button>
    )}
  </div>

  {/* Main layout: business (left) + governance (right) */}
  <div class="grid grid-cols-1 lg:grid-cols-3 gap-6 mb-8">

    {/* Business layer — 2/3 width */}
    <div class="lg:col-span-2 space-y-4">
      {/* Phase progress */}
      <Card>
        <h2 class="section-heading mb-3">
          <span class="text-xs font-medium text-slate-400 uppercase tracking-wide block mb-0.5">Business</span>
          Current Phase
        </h2>
        <PhaseProgress run={run} />
      </Card>

      {/* Blockers */}
      {run.blockers?.length > 0 && (
        <Card variant="highlighted">
          <div class="flex items-start gap-2">
            <WarningIcon class="w-5 h-5 text-amber-600 mt-0.5 shrink-0" />
            <div>
              <h3 class="text-sm font-semibold text-amber-800 mb-1">Blocked</h3>
              {run.blockers.map(b => <p class="text-sm text-amber-700">{b}</p>)}
            </div>
          </div>
        </Card>
      )}

      {/* Inputs */}
      <Card>
        <h2 class="section-heading mb-3">Provided Inputs</h2>
        {run.inputs && Object.keys(run.inputs).length > 0
          ? <InputDisplay inputs={run.inputs} />
          : <p class="text-sm text-slate-400">No inputs provided</p>
        }
      </Card>

      {/* Artifacts / Outputs */}
      <Card>
        <h2 class="section-heading mb-3">Outputs & Artifacts</h2>
        <ArtifactList runId={run.id} />
      </Card>
    </div>

    {/* Governance layer — 1/3 width */}
    <div class="space-y-4">
      {/* Harness info */}
      <Card>
        <h2 class="section-heading mb-1">
          <span class="text-xs font-medium text-slate-400 uppercase tracking-wide block mb-0.5">Governance</span>
          Harness
        </h2>
        <p class="text-sm font-medium text-slate-900">{run.harness_name ?? '—'}</p>
        {run.quality_bar && (
          <div class="mt-2 pt-2 border-t border-slate-100">
            <p class="text-xs text-slate-500 font-medium uppercase tracking-wide mb-1">Quality Bar</p>
            <p class="text-sm text-slate-700">{run.quality_bar}</p>
          </div>
        )}
      </Card>

      {/* Pending approvals — high visibility */}
      {pendingApprovals.map(approval => (
        <Card variant="highlighted" key={approval.id}>
          <div class="flex items-start gap-2 mb-3">
            <ClockIcon class="w-4 h-4 text-amber-600 mt-0.5 shrink-0" />
            <div>
              <p class="text-sm font-semibold text-amber-800">Approval Required</p>
              <p class="text-xs text-amber-700 mt-0.5">{approval.approval_type}</p>
            </div>
          </div>
          {approval.context && (
            <p class="text-sm text-slate-700 mb-3 line-clamp-3">{approval.context}</p>
          )}
          <div class="flex items-center gap-2">
            <Button variant="primary" size="sm" loading={resolving === approval.id} onClick={() => resolve(approval.id, 'approved')}>Approve</Button>
            <Button variant="danger" size="sm" onClick={() => resolve(approval.id, 'denied')}>Deny</Button>
          </div>
        </Card>
      ))}

      {/* Resolved approvals */}
      {resolvedApprovals.length > 0 && (
        <Card>
          <h2 class="section-heading mb-3">Approval History</h2>
          <div class="space-y-2">
            {resolvedApprovals.map(a => (
              <div class="flex items-center justify-between text-sm">
                <span class="text-slate-600">{a.approval_type}</span>
                <Badge status={a.status} />
              </div>
            ))}
          </div>
        </Card>
      )}
    </div>
  </div>

  {/* Operator/Debug layer — full width, visually distinct */}
  <div class="border-t border-slate-200 pt-6">
    <div class="flex items-center justify-between mb-4">
      <h2 class="text-sm font-semibold text-slate-500 uppercase tracking-wide">
        Operator / Debug
      </h2>
      <Button variant="ghost" size="sm" onClick={toggleRawEvents}>
        {showRaw ? 'Hide raw events' : 'Show raw events'}
      </Button>
    </div>

    {/* Event timeline stepper */}
    <EventTimeline events={events} showRaw={showRaw} />
  </div>
</RunDetailPage>
```

**EventTimeline (visual stepper)**:
```
<div class="space-y-0">
  {events.map((event, i) => (
    <div class="flex gap-3">
      {/* Vertical line + dot */}
      <div class="flex flex-col items-center">
        <div class={cx(
          "w-2.5 h-2.5 rounded-full mt-1 shrink-0 z-10",
          event.type === 'error' ? 'bg-red-500' :
          event.type === 'approval' ? 'bg-amber-500' :
          event.type === 'phase_start' ? 'bg-blue-500' :
          'bg-slate-300'
        )} />
        {i < events.length - 1 && <div class="w-px flex-1 bg-slate-200 my-0.5" />}
      </div>
      {/* Event content */}
      <div class="pb-4 min-w-0 flex-1">
        <div class="flex items-baseline gap-2">
          <span class="text-sm font-medium text-slate-800">{event.type.replace(/_/g, ' ')}</span>
          <span class="text-xs text-slate-400 font-mono">{formatTime(event.timestamp)}</span>
        </div>
        {event.message && <p class="text-sm text-slate-600 mt-0.5">{event.message}</p>}
        {showRaw && (
          <pre class="mt-1 text-xs font-mono text-slate-500 bg-slate-50 rounded p-2 overflow-x-auto">
            {JSON.stringify(event, null, 2)}
          </pre>
        )}
      </div>
    </div>
  ))}
</div>
```

**Cancel Run**: POST to `/api/runs/:id/cancel` (optimistic: set status to 'cancelled' in local state, revert on error). Show confirmation dialog before cancelling.

**Polling**: When `run.status === 'running'`, poll `/api/runs/:id`, `/api/runs/:id/events`, and `/api/runs/:runId/approvals` every 5 seconds. Stop polling when status transitions to a terminal state (succeeded/failed/cancelled).

**States**: Loading → skeleton for both columns. Error → error card. 

---

### 3.8 Approvals Queue Page

**Information Architecture**
1. Page title: "Approvals" + pending count badge
2. Filter tabs: Pending | Resolved (All, Approved, Denied)
3. Approval table

**Component Composition**
```
<ApprovalsPage>
  {/* Filter tabs */}
  <div class="flex items-center gap-1 border-b border-slate-200 mb-4 ...">
    <TabButton value="pending" label="Pending" count={pendingCount} />
    <TabButton value="approved" label="Approved" />
    <TabButton value="denied" label="Denied" />
    <TabButton value="all" label="All" />
  </div>

  {/* Table */}
  <div class="bg-white rounded-lg border border-slate-200 overflow-hidden">
    <table class="w-full text-sm">
      <thead class="bg-slate-50 border-b border-slate-200">
        <tr>
          <th class="text-left px-4 py-3 ...">Run / Playbook</th>
          <th class="text-left px-4 py-3 ...">Type</th>
          <th class="text-left px-4 py-3 ...">Requested</th>
          <th class="text-left px-4 py-3 ...">Context</th>
          <th class="px-4 py-3 ...">Actions</th>
        </tr>
      </thead>
      <tbody class="divide-y divide-slate-100">
        {approvals.map(a => <ApprovalRow key={a.id} approval={a} />)}
      </tbody>
    </table>
  </div>
</ApprovalsPage>
```

**ApprovalRow**:
```
<tr class={cx("hover:bg-slate-50", a.status === 'pending' && "bg-amber-50/30")}>
  <td class="px-4 py-3">
    <Link to={`/runs/${a.run_id}`} class="text-sm font-medium text-slate-900 hover:text-blue-600">
      {a.playbook_name}
    </Link>
    <p class="font-mono text-xs text-slate-400 mt-0.5">{a.run_id.slice(0, 8)}...</p>
  </td>
  <td class="px-4 py-3">
    <span class="text-sm text-slate-700">{a.approval_type}</span>
  </td>
  <td class="px-4 py-3 text-xs text-slate-500 whitespace-nowrap">{relativeTime(a.created_at)}</td>
  <td class="px-4 py-3 max-w-xs">
    <p class="text-sm text-slate-600 line-clamp-2">{a.context}</p>
  </td>
  <td class="px-4 py-3">
    {a.status === 'pending' ? (
      <div class="flex items-center gap-1.5">
        <Button variant="primary" size="sm" loading={resolving === a.id} onClick={() => resolve(a.id, 'approved')}>Approve</Button>
        <Button variant="danger" size="sm" onClick={() => resolve(a.id, 'denied')}>Deny</Button>
      </div>
    ) : (
      <Badge status={a.status} />
    )}
  </td>
</tr>
```

**Bulk Actions (P2)**: Checkbox column + "Approve All Selected" button in a sticky action bar that appears when checkboxes are checked.

**States**: Loading → table skeleton. Empty (pending) → EmptyState "All caught up! No pending approvals." (positive framing). Error → error card.

**Polling**: When on "Pending" tab, poll `/api/approvals` every 10 seconds to catch new approval requests from running runs.

---

## 4. Interaction Patterns

### 4.1 Form Patterns

**Validation strategy**: Validate on blur (field loses focus) for individual fields. Validate all fields on submit attempt. Never validate on keystroke (too aggressive). 

**Error display**: 
- Field-level: below the input, `text-xs text-red-600 mt-1`
- Form-level (API error): top of form, inside a red alert box `bg-red-50 border border-red-200 rounded-md p-3 text-sm text-red-700`
- Do not clear errors until the field is successfully re-validated

**Submission states**:
1. `idle` — normal enabled form
2. `submitting` — primary button shows loading spinner, form inputs disabled (`disabled` attr, opacity-75)
3. `success` — navigate away or close modal, show success toast
4. `error` — re-enable form, show error message, keep field values intact (do not reset form on API error)

**Required field indication**: `*` after the label in `text-red-500`, not before.

### 4.2 Polling / Refresh Strategy

Implement a `usePolling(fn, intervalMs, active)` hook:
```
function usePolling(fetchFn, intervalMs, active) {
  useEffect(() => {
    if (!active) return;
    const id = setInterval(() => {
      if (!document.hidden) fetchFn();
    }, intervalMs);
    return () => clearInterval(id);
  }, [fetchFn, intervalMs, active]);
}
```

**Intervals by page**:
- Dashboard: 30s (stat counts)
- Run List: 10s when running/all tab active and there are running runs
- Run Detail: 5s when `run.status === 'running'`; stop polling on terminal status
- Approvals Queue: 10s when on "Pending" tab

**Manual refresh**: All list pages and Run Detail show a "Refresh" icon button in the header bar. On click, fetch immediately and reset the polling timer.

**Page visibility**: Check `document.hidden` in the interval callback. Skip the fetch when the tab is hidden. This prevents unnecessary load from background tabs.

### 4.3 Toast Notifications

Place a `<ToastContainer>` in the App root. Use a React context `useToast()` hook for triggering from any component.

**Positioning**: `fixed bottom-4 right-4 z-50 flex flex-col gap-2 max-w-sm w-full`

**Toast structure**:
```
<div class="bg-white border border-slate-200 rounded-lg shadow-lg p-4 flex items-start gap-3 animate-in slide-in-from-bottom-2">
  <StatusIcon class="w-5 h-5 shrink-0 mt-0.5" />
  <div class="flex-1 min-w-0">
    <p class="text-sm font-medium text-slate-900">{title}</p>
    {message && <p class="text-xs text-slate-500 mt-0.5">{message}</p>}
  </div>
  <button class="text-slate-400 hover:text-slate-600 shrink-0" onClick={dismiss}>✕</button>
</div>
```

**Variants**: `success` (emerald icon), `error` (red icon), `info` (blue icon), `warning` (amber icon)

**Auto-dismiss**: 4 seconds for success/info. 8 seconds for error (operator needs more time to read). Warning: no auto-dismiss.

**API**: `toast.success('Run started')`, `toast.error('Failed to approve', 'Server returned 500')`, `toast.info('Polling paused')`.

**Trigger points**:
- Start Run: success → navigate + toast "Run started"
- Approve/Deny: success → toast "Approval resolved"
- Cancel Run: success → toast "Run cancelled"
- Any API error that isn't shown inline: error toast
- Form save (Playbook/Harness create/edit): success → navigate + toast

### 4.4 Modal vs Page Navigation

**Use modal when**:
- Quick action with a small form (Start Run inputs, Approve/Deny with reason)
- Confirmation dialogs (Cancel Run confirmation, Delete confirmation)
- Creating an entity that is always attached to a parent (Harness create from Playbook Detail)
- Form has 5 or fewer fields

**Use page navigation when**:
- Complex form with many fields (Playbook Create/Edit)
- User might need to navigate away and return
- The created entity has its own detail page

**Confirmation dialog pattern**: Small modal (sm size), title "Are you sure?", description of what will happen, Cancel (secondary) + Confirm (danger for destructive actions).

### 4.5 Optimistic Updates vs Server-Confirmed

**Optimistic** (immediate local state update, revert on error):
- Approval resolve — mark as resolved immediately, revert if API fails
- Run cancel — set status to 'cancelled' immediately, revert if API fails
- Toast shown immediately; if revert occurs, show error toast

**Server-confirmed** (wait for API response before updating UI):
- Playbook create/edit — navigate only after success
- Harness create — close modal only after success
- Start Run — navigate to run page only after success (need the run ID from the response)

Do NOT use optimistic updates for creates (you need the server-assigned ID).

---

## 5. Implementation Priority

### P0 — Must Have (implement first, highest operator impact)

These are the items that turn the current read-only dashboard into a usable operator tool.

1. **Design system tokens applied globally** — Add CSS variables to `index.css`, update `Layout.tsx` to use new shell structure (sidebar + header). All subsequent work builds on this foundation.

2. **Breadcrumb component + integration** — `Breadcrumb` component in `components/Breadcrumb.tsx`, integrated into Header. Wire up on all existing pages.

3. **Loading skeletons on all data-fetch pages** — `Skeleton` component in `components/Skeleton.tsx`. Replace the current blank loading states on PlaybookListPage, RunListPage, RunDetailPage, ApprovalsPage.

4. **Empty states on all list pages** — `EmptyState` component. PlaybookListPage (no playbooks), RunListPage (no runs), ApprovalsPage (all caught up).

5. **Run List status filter tabs** — The single most useful operator feature for run-first UX. Tabs for All/Running/Pending Approval/Succeeded/Failed. Filter by status query param.

6. **Run Detail visual event timeline** — Replace raw text list with the stepper component. This is the core operator-debug layer. `EventTimeline` component in `components/EventTimeline.tsx`.

7. **Run Detail three-section layout** — Restructure `RunDetailPage.tsx` into the Business/Governance/Operator-Debug three-layer grid.

8. **Run Detail pending approval cards with inline resolve** — The amber highlighted card with Approve/Deny buttons surfaced in the governance panel. No more hunting for the Approvals page.

9. **Run cancellation button** — Cancel Run button on RunDetailPage. POST to `/api/runs/:id/cancel`. Confirmation dialog before firing.

10. **Playbook Detail Start Run modal** — `StartRunModal` component with dynamic input form from playbook schema. Replace the blind "Start Run" button that fires empty.

11. **Dashboard / Home page** — New `/dashboard` route. Stat cards + attention items + recent runs. Set as the default route (`/`).

12. **Toast notification system** — `ToastContainer` + `useToast` hook. Required before any create/edit flows.

### P1 — Important (follow-on sprint)

13. **Playbook Create / Edit page** — `/playbooks/new` and `/playbooks/:id/edit` with full form.

14. **Harness Create / Edit modal** — `HarnessModal` triggered from Playbook Detail.

15. **Polling / auto-refresh** — `usePolling` hook. Active on Run Detail (running runs) and Approvals Queue (pending tab).

16. **Pagination** — `Pagination` component. Apply to RunListPage and PlaybookListPage.

17. **Search on list pages** — Search input on PlaybookListPage and RunListPage. Client-side filter for small datasets.

18. **Sidebar collapsible** — Toggle button, collapsed icon-only mode. State persisted in `localStorage`.

### P2 — Nice to Have

19. **Bulk approval actions** — Checkbox column on ApprovalsPage + sticky "Approve All" bar.

20. **Keyboard shortcuts** — `?` to show shortcut help, `J/K` to navigate list items.

21. **Dark mode** — CSS variable overrides in `@media (prefers-color-scheme: dark)` or `.dark` class toggle.

22. **Mobile-responsive sidebar** — Hamburger toggle, overlay drawer on small screens.

---

## Appendix: New Files to Create

| File | Purpose |
|---|---|
| `packages/app/src/components/Button.tsx` | Primary button component |
| `packages/app/src/components/Card.tsx` | Card container |
| `packages/app/src/components/Badge.tsx` | Replaces/extends StatusBadge |
| `packages/app/src/components/Modal.tsx` | Modal/dialog wrapper |
| `packages/app/src/components/Input.tsx` | Text input with label+error |
| `packages/app/src/components/Skeleton.tsx` | Loading skeleton |
| `packages/app/src/components/EmptyState.tsx` | Empty state container |
| `packages/app/src/components/Breadcrumb.tsx` | Breadcrumb nav |
| `packages/app/src/components/Pagination.tsx` | Page nav |
| `packages/app/src/components/EventTimeline.tsx` | Visual event stepper |
| `packages/app/src/components/Toast.tsx` | Toast + ToastContainer |
| `packages/app/src/hooks/usePolling.ts` | Polling hook |
| `packages/app/src/hooks/useToast.ts` | Toast context hook |
| `packages/app/src/pages/DashboardPage.tsx` | New dashboard |
| `packages/app/src/pages/PlaybookFormPage.tsx` | Create/Edit playbook |
