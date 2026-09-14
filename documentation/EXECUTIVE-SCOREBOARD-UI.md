# Executive Scoreboard Page — UI Documentation

> Source: [`ExecutiveScoreboard.jsx`](file:///c:/Users/91995/Desktop/D-table_analytic/nia-infra-hide-pms-mm/nia-infra-hide-pms-mm/Frontend/src/pages/ExecutiveScoreboard.jsx)  
> Component: `ExecutiveScoreboard`  
> Primary Route: `/scoreboard`  
> Aliases & Redirects: `/performance` → `/scoreboard`  
> Local Documentation: [`Frontend/src/pages/ExecutiveScoreboard.md`](file:///c:/Users/91995/Desktop/D-table_analytic/nia-infra-hide-pms-mm/nia-infra-hide-pms-mm/Frontend/src/pages/ExecutiveScoreboard.md)  
> Sidebar Entry: `PrimarySidebar.jsx` (under 'Tasks') & `SecondarySidebar.jsx` → `Executive Scoreboard` (`Trophy` icon)  
> Access Scoping: **All Authenticated Users (Read-Only View)**; **CEO, Managing Director (MD), & Admins (Inline Goal & Adjustment Editing)**

---

## Overview

The **Executive Scoreboard** (`ExecutiveScoreboard.jsx`) represents the unified enterprise performance board within the PMS/IMS platform, replacing the legacy split between the Performance dashboard and gamified Scoreboard. 

It provides leadership and project teams with a transparent, mathematically rigorous evaluation of every doer's execution efficiency across two core Key Result Areas (KRAs) spanning both Head Office (HO) and Bhandup site operations across Delegations and Recurring Checklists.

### Core Objectives & Design Philosophy

1. **Unified Enterprise Performance**:
   - Consolidates work volume from all four organizational streams (**HO Delegation**, **HO Checklist**, **Bhandup Delegation**, and **Bhandup Checklist**) into an authoritative executive review.
2. **KRA/KPI Miss-Based Grid**:
   - Evaluates performance across two standard organizational KRAs:
     - **KRA 1: "All work should be done"** → **KPI: "% work not done"**
     - **KRA 2: "All work should be done on time"** → **KPI: "% work not done on time"**
   - Both KPIs quantify execution *misses* against an immutable benchmark of **0%** (*lower miss rate is better*).
3. **Inverted Mean Scoring & Tie-Breaker Architecture**:
   - Individual baseline score is calculated as the inverted mean of completed work:
     $$\text{Score} = \text{mean}(100 - \text{Miss}\%)$$
   - Because high performers often finish all tasks on time, score ties at 100 or other round figures naturally occur. The interface incorporates a dedicated **MD Adjustment field (+1/-10 to +10)** to break ties based on executive discretion and qualitative leadership review.
4. **Separable Site Scopes**:
   - Features a multi-site toggle (**Overall**, **HO**, **Bhandup**) allowing leadership to view location performance independently without ever blending site metrics into ambiguous aggregated figures.
5. **Universal Doer Surfacing**:
   - Lists *every* active user with tasks in the system, even if they have 0 tasks planned for the selected period. A silent or underutilized week is surfaced prominently as an operational signal rather than omitted from view.
6. **Executive Inline Governance**:
   - Gives the CEO and Managing Director inline editing capabilities directly in the table to set next-period goals and tie-breaker adjustments, updating live rankings synchronously.

---

## Page Layout & Component Hierarchy

```
┌────────────────────────────────────────────────────────────────────────────────────────────────────────┐
│  1. HEADER & GLOBAL CONTROLS                                                                           │
│     [ 🏆 ] Executive Scoreboard                             [ Week | Month | Year ] [ 🏢 All|HO|Bhandup ] │
│            Week of 2026-09-08 — 2026-09-14 · 24 doers...                [ ↺ Refresh ] [ 📥 Export ]   │
├────────────────────────────────────────────────────────────────────────────────────────────────────────┤
│  2. TOP 3 PODIUM CARDS (Top Performers with Work)                                                      │
│     ┌────────────────────────┐  ┌────────────────────────┐  ┌────────────────────────┐                 │
│     │ 🥇 Rank 1              │  │ 🥈 Rank 2              │  │ 🥉 Rank 3              │                 │
│     │ Rahul Sharma           │  │ Amit Patel             │  │ Sneha Gupta            │                 │
│     │ Final Score: 100       │  │ Final Score: 96        │  │ Final Score: 92        │                 │
│     │ (Gold Ambient Glow)    │  │ (Neutral Card)         │  │ (Neutral Card)         │                 │
│     └────────────────────────┘  └────────────────────────┘  └────────────────────────┘                 │
├────────────────────────────────────────────────────────────────────────────────────────────────────────┤
│  3. SEARCH & EXECUTIVE ADVISORY BAR                                                                    │
│     [ 🔍 Search doers...                               ]   🎯 Set next week score goal inline...       │
├────────────────────────────────────────────────────────────────────────────────────────────────────────┤
│  4. KRA/KPI GRID TABLE (13 Columns, Multi-Row per Doer)                                                │
│     ┌──────┬──────────────┬──────────────────┬──────────────────────┬─────┬─────┬─────┬─────┬─────┬───┐│
│     │ Rank │ Doer Name    │ KRA              │ KPI                  │ Bmk │Last%│Plan │ Act │Act %│...││
│     ├──────┼──────────────┼──────────────────┼──────────────────────┼─────┼─────┼─────┼─────┼─────┼───┤│
│     │      │              │ All work done    │ % work not done      │ 0%  │ 0%  │ 12  │ 12  │ 0%  │   ││
│     │  🥇1 │ Rahul Sharma ├──────────────────┼──────────────────────┼─────┼─────┼─────┼─────┼─────┼───┤│
│     │      │              │ Done on time     │ % work not on time   │ 0%  │ 5%  │ 12  │ 11  │ 8%  │   ││
│     │      │              │                  │                      │     │     │     │     │     │   ││
│     │      │              └─ [Next Planned: 8] [Next Goal: 95] [MD Adj: +1] [Final Score: 97] ─────────┤│
│     ├──────┼──────────────┼──────────────────┼──────────────────────┼─────┼─────┼─────┼─────┼─────┼───┤│
│     │  2   │ Vikram Rao   │ All work done    │ % work not done      │ 0%  │ 10% │  5  │  4  │ 20% │   ││
│     │      │              ├──────────────────┼──────────────────────┼─────┼─────┼─────┼─────┼─────┼───┤│
│     │      │              │ Done on time     │ % work not on time   │ 0%  │ 10% │  5  │  4  │ 20% │   ││
│     │      │              └─ [Next Planned: 3] [Next Goal: 85] [MD Adj:  0] [Final Score: 80] ─────────┤│
│     └──────┴──────────────┴──────────────────┴──────────────────────┴─────┴─────┴─────┴─────┴─────┴───┘│
├────────────────────────────────────────────────────────────────────────────────────────────────────────┤
│  5. FOOTNOTE & CALCULATION METHODOLOGY                                                                 │
│     ℹ️ Both KPIs count misses against a 0% benchmark, so lower is better; the score is the mean...    │
└────────────────────────────────────────────────────────────────────────────────────────────────────────┘
```

---

## 1. Header & Global Controls

The header establishes context, period timeframe, doer census, and operational switches:

```
┌────────────────────────────────────────────────────────────────────────────────────────────────────────┐
│ [ 🏆 ] Executive Scoreboard                             [ Week | Month | Year ] [ 🏢 All|HO|Bhandup ] │
│        Week of 2026-09-08 — 2026-09-14 · 24 doers · 19 with work        [ ↺ Refresh ] [ 📥 Export ]   │
└────────────────────────────────────────────────────────────────────────────────────────────────────────┘
```

### Component Breakdown

| Element | Visual Styling / Classes | Behavior & Operational Rules |
|---|---|---|
| **Trophy Icon Badge** | `p-2 bg-amber-500/10 rounded-xl` housing `<Trophy className="text-amber-500" size={30} />` | Visual branding accentuating the executive evaluation charter. |
| **Title** | `text-3xl font-extrabold text-(--text-primary) tracking-tight` | Header label: `"Executive Scoreboard"`. |
| **Period & Doer Census Subtitle** | `mt-2 text-slate-500 font-medium` | Renders dynamic metadata: `{Period} of {periodStart} — {periodEnd} · {N} doers · {M} with work this {period}`. Renders `"Loading…"` during initial load. |
| **Period Selector Pill Group** | `flex items-center p-1 rounded-xl bg-(--bg-secondary) border border-(--border-color)` | Segmented switch between **Week** (default), **Month**, and **Year**. Active pill: `bg-amber-500 text-white shadow-sm`. Inactive pill: `text-slate-500 hover:text-amber-600`. |
| **Scope Selector Pill Group** | `flex items-center p-1 rounded-xl bg-(--bg-secondary) border border-(--border-color)` | Segmented switch between **Overall** (`all`), **HO** (`HO`), and **Bhandup** (`Bhandup`). Includes `<Building2 size={15} className="mx-2 text-slate-400" />`. Active pill: `bg-emerald-600 text-white shadow-sm`. Inactive: `text-slate-500 hover:text-emerald-600`. |
| **Refresh Button** | `p-2.5 rounded-xl border border-(--border-color) bg-(--bg-secondary) text-slate-500 hover:text-emerald-600` | Re-executes `load()` without clearing parameters. `<RefreshCw size={17} />` spins continuously while `loading === true`. |
| **Excel Export Button** | `px-4 py-2.5 rounded-xl bg-emerald-600 text-white text-sm font-bold hover:bg-emerald-700 shadow-sm inline-flex items-center gap-2` | Triggers client-side Excel generation formatted with multi-KRA flattened rows via `exportToExcel()`. |

---

## 2. Top 3 Podium Cards (`PodiumCard`)

Directly beneath the header, a high-impact podium showcases the top 3 highest-ranking performers who completed work during the active period.

```
┌──────────────────────────────────┐  ┌──────────────────────────────────┐  ┌──────────────────────────────────┐
│  🥇  Rank 1                      │  │  🥈  Rank 2                      │  │  🥉  Rank 3                      │
│      Rahul Sharma                │  │      Amit Patel                  │  │      Sneha Gupta                 │
│      Final Score: 100            │  │      Final Score: 96             │  │      Final Score: 92             │
└──────────────────────────────────┘  └──────────────────────────────────┘  └──────────────────────────────────┘
```

### Visual Specifications

- **Container**: `grid sm:grid-cols-3 gap-3` (only rendered when `!loading && data?.top?.length > 0`).
- **Medal Representation**: `MEDALS = ['🥇', '🥈', '🥉']` rendered at `text-3xl leading-none`.
- **First-Place Treatment**:
  - Gradient Background: `bg-gradient-to-br from-amber-50 to-white dark:from-amber-500/10 dark:to-transparent`
  - Border: `border-amber-300`
- **Second & Third-Place Treatment**:
  - Background: `bg-(--bg-secondary)`
  - Border: `border-(--border-color)`
- **Card Fields**:
  - **Rank Tag**: `text-[10px] font-black uppercase tracking-widest text-slate-400` (`Rank {row.rank}`)
  - **Doer Name**: `font-extrabold text-[17px] text-(--text-primary) truncate`
  - **Final Score**: `text-3xl font-extrabold tabular-nums` dynamic colored via `band(row.finalScore)`

---

## 3. Search & Executive Advisory Bar

Positioned above the main data table, this bar combines interactive filtering with role-tailored instruction:

```
┌────────────────────────────────────────────────────────────────────────────────────────────────────────┐
│ [ 🔍 Search doers...                                 ]  🎯 Set the next week score goal and the MD    │
│                                                            adjustment inline — rank updates as you type│
└────────────────────────────────────────────────────────────────────────────────────────────────────────┘
```

### UI Elements

1. **Search Input**:
   - Icon: `<Search size={16} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400" />`
   - Input: `w-full pl-10 pr-3 py-2.5 rounded-xl border border-(--border-color) bg-(--bg-primary) text-(--text-primary) text-sm`
   - Placeholder: `"Search doers…"`
   - Filtering: Instant, real-time client-side substring matching on `row.doer.toLowerCase()`.
2. **Contextual Role Banner**:
   - **For Authorized Editors (`canEdit === true`)**:
     - Visual: `text-[11px] font-semibold text-slate-500 inline-flex items-center gap-1.5`
     - Icon: `<Target size={13} className="text-amber-500" />`
     - Message: *"Set the {nextLabel} score goal and the MD adjustment inline — rank updates as you type."*
   - **For Standard Viewers (`canEdit === false`)**:
     - Visual: `text-[11px] font-semibold text-slate-400 inline-flex items-center gap-1.5`
     - Icon: `<Info size={13} />`
     - Message: *"Goals and adjustments are set by the CEO/MD."*

---

## 4. The KRA/KPI Scoreboard Grid Table

The primary presentation element is a 13-column, responsive tabular grid. Each individual doer spans **two distinct table rows**, corresponding to their two core KRAs.

### Table Header Architecture

```
┌──────┬───────────┬───────────────────────────────┬───────────────────────────────┬───────────┬──────────────┬──────────────┬──────────────┬──────────────┬──────────────┬────────────────┬───────────────┬─────────────┐
│ Rank │ Doer Name │ KRA                           │ KPI                           │ Benchmark │ Last Period% │ Curr Planned │ Curr Actual  │ Curr Actual% │ Next Planned │ Next Goal (MD) │ MD Adjustment │ Final Score │
└──────┴───────────┴───────────────────────────────┴───────────────────────────────┴───────────┴──────────────┴──────────────┴──────────────┴──────────────┴──────────────┴────────────────┴───────────────┴─────────────┘
```

| Column Header | Alignment | Styling Tokens | Description |
|---|---|---|---|
| **Rank** | Left | `px-3 py-2.5 text-[10px] font-black text-slate-500 uppercase tracking-wider` | Standing order (1 to N), decorated with 🥇🥈🥉 for top 3 |
| **Doer Name** | Left | Standard header tokens | Full employee name (`firstName lastName`) |
| **KRA** | Left | Standard header tokens | Key Result Area description |
| **KPI** | Left | Standard header tokens | Key Performance Indicator description |
| **Benchmark** | Center | Standard header tokens | Target miss threshold (**0%**) |
| **Last {Period} Actual %** | Center | Standard header tokens | Historical miss rate from previous period |
| **Current {Period} Planned** | Center | Standard header tokens | Total task commitments due within the active period |
| **Current {Period} Actual** | Center | Standard header tokens | Completed / on-time task completions achieved |
| **Current {Period} Actual %** | Center | Standard header tokens | Current miss percentage against planned volume |
| **Next {Period} Planned** | Center | Standard header tokens | Queued tasks already scheduled for the upcoming period |
| **Next {Period} Score Goal** | Center | `bg-amber-50/60 dark:bg-amber-500/5` (Amber tint) | Target score target set by executive management |
| **MD Adjustment** | Center | `bg-amber-50/60 dark:bg-amber-500/5` (Amber tint) | Tie-breaker (+1 / -10 to +10) awarded by MD |
| **Final Score** | Center | `bg-amber-50/60 dark:bg-amber-500/5` (Amber tint) | Final evaluated score ($Score + MD\ Adjustment$) |

---

### Row Structure & Spanning Geometry

Each doer occupies a 2-row block (`r.kras.map((k, i) => ...)`):

```
Row 1 (i = 0):
┌───────────┬───────────┬─────────────────────────┬──────────────────────┬──────┬───────┬──────┬──────┬───────┬──────────────┬────────────────┬───────────────┬─────────────┐
│ Rank [r2] │ Name [r2] │ All work should be done │ % work not done      │  0%  │ last% │ plan │ done │ miss% │ NextPlan[r2] │ NextGoal [r2]  │ MD Adj [r2]   │ Final [r2]  │
├───────────┴───────────┼─────────────────────────┼──────────────────────┼──────┼───────┼──────┼──────┼───────┼──────────────┴────────────────┴───────────────┴─────────────┤
│ (Spanned from above)  │ Done on time            │ % work not on time   │  0%  │ last% │ plan │ ontm │ miss% │ (Spanned from Row 1 above)                                  │
└───────────────────────┴─────────────────────────┴──────────────────────┴──────┴───────┴──────┴──────┴───────┴─────────────────────────────────────────────────────────────┘
```

1. **Columns Spanning Both Rows (`rowSpan={2}`)**:
   - **Rank**: Renders medal emoji for ranks 1-3 if `r.hasWork === true` (e.g. `🥇 1`), else numeric rank.
   - **Doer Name**: Displays `r.doer`. If `!r.hasWork`, appends a small muted badge: `<div className="text-[10px] font-bold text-slate-400 uppercase tracking-wide">No tasks</div>`.
   - **Next Planned**: Shows count of future incomplete tasks queued for next period (`r.nextPlanned`).
   - **Next Goal**: Inline editable score target (`r.nextGoal`).
   - **MD Adjustment**: Inline editable tie-breaker (`r.mdAdjustment`).
   - **Final Score**: Highlighted numerical score styled with score color bands.
2. **KRA Sub-Rows**:
   - **Row 1 (`k.key === 'done'`)**:
     - KRA: `"All work should be done"`
     - KPI: `"% work not done"`
     - Planned: `now.planned`
     - Actual: `now.done`
     - Actual %: `missBand(k.actualPct)`
   - **Row 2 (`k.key === 'onTime'`)**:
     - KRA: `"All work should be done on time"`
     - KPI: `"% work not on time"`
     - Planned: `now.planned`
     - Actual: `now.onTime`
     - Actual %: `missBand(k.actualPct)`
     - Divider: `border-b border-(--border-color)` demarcating the boundary before the next person.

---

## 5. Inline Number Editor (`EditableNum`)

The management columns (**Next Period Score Goal** and **MD Adjustment**) use an inline editable component designed for rapid data entry without bulky modal dialogs:

```
┌─────────────────────────┐
│        [  95  ] ⏳      │
└─────────────────────────┘
```

### Component Mechanics & Keyboard Interactions

```javascript
const EditableNum = ({ value, disabled, placeholder, onCommit, title, width = 'w-16' }) => { ... }
```

| State / Trigger | Visual Presentation | Operational Behavior |
|---|---|---|
| **Disabled (Read-Only)** | `<span className="tabular-nums text-slate-500">` | Renders value or em-dash (`—`) when user lacks edit authorization. |
| **Active Input** | `rounded-lg border border-(--border-color) bg-(--bg-primary) text-(--text-primary) text-[13px] tabular-nums text-center focus:ring-2 focus:ring-emerald-500/40` | Numeric input allowing user to type values directly. |
| **Commit on Blur** | Automatic blur invocation | Evaluates `draft` against original `value`. If modified, triggers `onCommit(normalised)`. |
| **Enter Key** | `e.key === 'Enter'` | Calls `e.currentTarget.blur()`, which invokes commit immediately. |
| **Escape Key** | `e.key === 'Escape'` | Reverts `draft` back to original `value ?? ''` and blurs input without saving. |
| **Saving Indicator** | `<Loader2 size={12} className="animate-spin text-emerald-600 absolute -right-4" />` | Spun right outside the input border while API call is in-flight. |

---

## 6. Color Coding & Performance Thresholds

The UI utilizes two distinct, semantically calibrated color band systems:

### 6.1 Score Performance Band (`band(score)`)
Used for **Final Score** and **Podium Cards** (*Higher score is better*):

| Score Range | CSS Class | Color Sample | Semantic Meaning |
|---|---|---|---|
| **$\ge 85$** | `text-emerald-600` | Emerald Green | Exceptional / Star Performer |
| **$70 - 84$** | `text-sky-600` | Sky Blue | Proficient / Solid Execution |
| **$50 - 69$** | `text-amber-600` | Amber Orange | Needs Improvement / Warning |
| **$< 50$** | `text-red-500` | Coral Red | Critical Deficiency |
| **`null` / `undefined`** | `text-slate-400` | Muted Gray | No Evaluated Score |

### 6.2 KPI Miss Band (`missBand(pct)`)
Used for **Last Period Actual %** and **Current Period Actual %** (*Lower miss percentage is better against a 0% benchmark*):

| Miss Percentage | CSS Class | Color Sample | Semantic Meaning |
|---|---|---|---|
| **$= 0\%$** | `text-emerald-600` | Emerald Green | Perfect Execution (Zero Misses) |
| **$\le 15\%$** | `text-sky-600` | Sky Blue | Minimal / Acceptable Slippage |
| **$\le 30\%$** | `text-amber-600` | Amber Orange | Moderate Slippage / Elevated Misses |
| **$> 30\%$** | `text-red-500` | Coral Red | Unacceptable Slippage / Excessive Misses |
| **`null` / `undefined`** | `text-slate-400` | Muted Gray | No Work Scheduled (0 planned) |

---

## 7. Business Logic & Mathematical Engine

### 7.1 Period Window Formulation

| Period Type | Calculation Mechanism | Window Boundary Rules |
|---|---|---|
| **Week** | Monday to Sunday (standard management cycle) | Computed via `mondayOffset = (d.getDay() + 6) % 7`. Monday 00:00:00 to next Monday 00:00:00 (exclusive). |
| **Month** | Calendar Month | 1st of month 00:00:00 to 1st of subsequent month 00:00:00. |
| **Year** | Calendar Year | Jan 1st 00:00:00 to Jan 1st of next year 00:00:00. |

> [!IMPORTANT]
> **In-Progress Period Cutoff**: For a period that is currently running, the calculation window is bounded at `endOfToday (23:59:59.999)`. Counting tasks due on Friday as "not done" on a Tuesday would falsely penalize the entire workforce with artificial misses early in the week.

### 7.2 Multi-Stream Aggregation

Data is fetched across four orthogonal operational buckets:
1. `HO|delegation`
2. `HO|checklist`
3. `Bhandup|delegation`
4. `Bhandup|checklist`

Depending on the `scope` selection (`all`, `HO`, `Bhandup`), the system filters the relevant bucket metrics:
- **Planned**: Delegations with `dueDate` in window + Checklist tasks with `plannedDate` in window.
- **Done**: Tasks with non-null completion timestamp (`completedAt` or `actualDate`).
- **On Time**: Tasks completed on or before their specified deadline (`completedAt <= dueDate` or `actualDate <= plannedDate`).

### 7.3 Formulas

1. **Miss Percentage**:
   $$\text{Miss}\% = \text{round}\left( \frac{\text{Planned} - \text{Hit}}{\text{Planned}} \times 100 \right)$$
2. **Computed Score**:
   $$\text{Score} = \text{round}\left( \frac{\sum (100 - \text{Miss}\%)}{N_{\text{KRAs}}} \right)$$
3. **Final Score**:
   $$\text{FinalScore} = \max(0, \text{Score} + \text{mdAdjustment})$$

### 7.4 Ranking Hierarchy

Rows are sorted strictly according to the following 3-level comparator:
1. **Activity Precedence**: Employees with active work this period (`hasWork === true`) always sort *above* those with no tasks (`hasWork === false`), preventing zero-task doers from tying with low performers.
2. **Final Score (Descending)**: Higher final score ranks higher. MD adjustments apply directly before rank evaluation to serve as authoritative tie-breakers.
3. **Alphabetical Tie-Break**: If final scores remain identical, names are sorted alphabetically (`a.doer.localeCompare(b.doer)`).

---

## 8. Role-Based Permissions & Editing Governance

| Role / Designation | Read Access | Inline Edit (Goals & MD Adjustments) | Technical Verification Rule |
|---|---|---|---|
| **CEO / Managing Director (MD)** | ✅ Full Access | ✅ Enabled | Checked by `canEditExec`: designation matches regex `/\b(ceo\|managing director\|md)\b/i` against `users` table. |
| **ADMIN / SUPERADMIN** | ✅ Full Access | ✅ Enabled | User role is `'ADMIN'` or `'SUPERADMIN'`. |
| **Team Leads / Managers** | ✅ Full Access | ❌ Disabled (Read-Only) | Receives `canEdit: false` from API; inputs render as static tabular numbers. |
| **Standard Doers / Employees** | ✅ Full Access | ❌ Disabled (Read-Only) | Can view company-wide standings and their own rank transparently. |

---

## 9. Excel Export Schema

Clicking **"Export"** initiates `exportToExcel()` with a flattened multi-row structure where each person has two consecutive rows matching the table grid:

```javascript
exportToExcel(
    rows.flatMap((r) => r.kras.map((k, i) => ({
        Rank: i === 0 ? r.rank : '',
        'Doer Name': i === 0 ? r.doer : '',
        KRA: k.kra,
        KPI: k.kpi,
        Benchmark: `${k.benchmark}%`,
        [`Last ${label} Actual %`]: k.lastPct ?? '',
        [`Current ${label} Planned`]: k.planned,
        [`Current ${label} Actual`]: k.actual,
        [`Current ${label} Actual %`]: k.actualPct ?? '',
        [`${nextLabel} Planned`]: i === 0 ? r.nextPlanned : '',
        [`${nextLabel} Score Goal`]: i === 0 ? (r.nextGoal ?? '') : '',
        'MD Adjustment': i === 0 ? r.mdAdjustment : '',
        'Final Score': i === 0 ? r.finalScore : '',
    }))),
    `Executive-Scoreboard-${period}-${data?.periodStart || ''}`,
);
```

---

## 10. Empty & Loading States

### Loading State
- Renders 6 skeleton pulse rows (`<div className="h-12 skeleton" />`) within the table container.
- Refresh icon spins in the header (`animate-spin`).

### Empty State (Zero Matches)
If search yields no matching names (`filtered.length === 0`):
- Displays a centered icon card with `<Trophy size={30} className="text-slate-400" />` in a circular background.
- Heading: `"No doers to show"`.
- Subtext: `"Nothing matches this search."`.
