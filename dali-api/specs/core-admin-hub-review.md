# Core & Admin Hub Review — Allocation + Admin Redesign

Status: **Proposal (review + allocation plan).** No code changes yet.
Branch: `claude/core-admin-hub-review` (worktree off `staging`).
Author intent (Kiran): "Core = all things process/lab. Admin = all things
system/admin. Right now the separation is poorly defined; some things are in
both. Decide where every feature lives (dedupe paths), and design better
interfaces — particularly for Admin."

Decisions locked with Kiran up front:
- **Scope:** produce the plan; build only after approval.
- **Access:** the boundary is *logical/functional, not an auth wall.* Core may
  still see system tools — what must be unambiguous is each hub's **purpose**.
  So this proposal does **not** tighten any role gates.
- **Infra-comms:** **Email Senders** and **Outbound Messages** both move to
  **Admin → System & Insights.**

---

## 1. Executive summary

The Core/Admin split already exists in code — the `nav-regroup` flag
(`defaultEnabled: true`, everyone) makes Core the lab-*process* area and Admin
the *system* area. The "some things are in both" feeling is not a deep
architectural gap; it is **three concrete leaks** plus a **thin Admin
presentation**:

1. The **`/admin` landing page still renders the Core-owned clusters** (People &
   Access, Communications). It builds its grid from raw `ADMIN_CLUSTERS` instead
   of `adminClustersFor(flags)` (which the sidebar already uses). So a Core
   member on `/admin` sees "Roles & Permissions", "Domains", "Announcements",
   "Email" cards that immediately **redirect to `/core/*`** when clicked. That is
   the visible duplication.
2. **`Outbound Messages` is orphaned.** It is declared under the *Communications*
   cluster (which is Core-owned under regroup) but has no Core alias and no
   redirect, so it silently renders only in Admin with no clean nav home.
3. **`Email Senders` is filed as process** (Core → Communications → Email →
   Senders) but is really **infrastructure** (Gmail OAuth accounts + daily caps).

And on presentation: the **Admin hub is a static launcher grid** with only two
live badges, and **four pages are bare tables** (Audit Log, AI Usage, Email
Senders, Outbound Messages). Once Admin is *only* system tooling, its landing
should become a **system console** (live health at a glance), and those four
tables deserve real UI.

The fixes are small and surgical (Part A), and the redesign is well-scoped
because Admin's surface shrinks to two clusters (Part B).

---

## 2. Current state — the map

### 2.1 How the split is wired today

- `nav-regroup` (default on) → sidebar shows **Admin = Finance + System &
  Insights** only; **Core** owns the process tools.
- Process tools have **one implementation, two URLs**: the impl lives in
  `app/admin/routes/*` (or `app/projects/routes/*` for staffing), and a thin
  **re-export alias** in `app/core/routes/*` overrides only the breadcrumb.
- `regroupRedirect()` sits at the top of each *source* loader and, for flag-on
  viewers, 302s the pre-regroup URL to its canonical `/core/*` address
  (`app/core/lib/regroup-redirect.server.ts`). Query string + sub-paths carry
  over. It is inert on the canonical path (prefix guard), so no loop.
- `adminClustersFor(flags)` drops `people` + `communications` from Admin when
  regrouped (`CORE_OWNED_CLUSTERS`). **The sidebar uses this. The `/admin`
  landing does not** — that is leak #1.

### 2.2 Everything reachable today, and where it renders

| Feature | Impl file | Canonical URL (flag-on) | Alias / leak |
|---|---|---|---|
| Core hub (calendar) | `core/routes/core.hub.tsx` | `/core` | — |
| Staffing board | `projects/routes/projects.staffing` | `/core/staffing` | `/projects/staffing` redirects |
| Intent to Work | `projects/routes/projects.intent-to-work` | `/core/intent-to-work` | `/projects/...` redirects |
| Project Bids | `projects/routes/projects.project-bids` | `/core/project-bids` | `/projects/...` redirects |
| Level Up | `projects/routes/projects.level-up` | `/core/level-up` | `/projects/...` redirects |
| Roles & Permissions | `admin/routes/admin.members.tsx` | `/core/access/roles` | `/admin/members` redirects |
| Domains | `admin/routes/admin.domains.tsx` | `/core/access/domains` | `/admin/domains` redirects |
| Attendance | `admin/routes/admin.attendance.tsx` | `/core/attendance` | `/admin/attendance` redirects |
| Announcements | `admin/routes/admin.announcements.tsx` | `/core/communications/announcements` | `/admin/announcements` redirects |
| Email Templates | `admin/routes/admin.email-templates.tsx` | `/core/communications/email` | `/admin/email-templates` redirects |
| Agreements console | `signing/routes/core.agreements.tsx` | `/core/agreements` | — |
| **Email Senders** | `admin/routes/admin.email-senders.tsx` | `/core/communications/email-senders` | `/admin/email-senders` redirects → **misfiled (infra)** |
| **Outbound Messages** | `admin/routes/admin.outbound-messages.tsx` | `/admin/outbound-messages` | **orphan — no Core home, no redirect** |
| Analytics | `admin/routes/admin.analytics.tsx` | `/admin/analytics` | — |
| AI Usage | `admin/routes/admin.ai-usage.tsx` | `/admin/ai-usage` | — |
| Activity / Audit Log | `admin/routes/admin.activity.tsx` | `/admin/activity` | — |
| Jobs | `admin/routes/admin.jobs.tsx` | `/admin/jobs` | — |
| Feature Flags | `admin/routes/admin.feature-flags.tsx` | `/admin/feature-flags` | — |
| Payroll Export | `admin/routes/admin.payroll-export.tsx` | `/admin/payroll-export` | — (Admin-only) |
| Payroll Reconcile | `admin/routes/admin.payroll.tsx` | `/admin/payroll` | — (Admin-only) |

### 2.3 Presentation, per hub

- **Core hub** (`/core`) = a *dashboard*: month calendar (Core meetings + DALI
  General Calendar) + upcoming Core meetings + announcement deadlines. Good.
  But the **Core sidebar is a flat run of 9+ tabs** (Hub, Staffing, Intent,
  Bids, Level Up, Roles, Domains, Communications, Agreements, Attendance) with
  only Communications clustered — see §4.5.
- **Admin hub** (`/admin`) = a *static launcher grid* of cluster cards; two live
  badges (scheduled announcements, failing jobs). Fine, but under-uses the space
  once Admin is purely system.
- **Bare tables** needing design: `admin.activity`, `admin.ai-usage`,
  `admin.email-senders`, `admin.outbound-messages`.
- **Already well-built** (leave alone): `admin.members`, `admin.domains`,
  `admin.announcements`, `admin.jobs`, `admin.feature-flags`, `admin.analytics`,
  `admin.payroll*`.

---

## 3. Guiding principle (the litmus test)

> **Core is where you run the lab. Admin is where you run the system.**

For any tool, ask: *"Is this the lab's people/process/comms work, or is it the
platform's plumbing, money, and telemetry?"*

- **Process → Core:** who's in the lab, who leads what, who's staffed where, who
  signed what, what we announced.
- **System → Admin:** background jobs, feature rollout, audit trail, AI/site
  telemetry, the email transport (accounts, caps, the send outbox), payroll.

Email is the clarifying case: **what you say** (Announcements, Templates) is
Core; **the pipes you say it through** (Sender accounts, the delivery outbox) is
Admin.

---

## 4. Part A — Feature allocation + dedup

### 4.1 Final allocation

**CORE (process/lab)** — `/core/*`
- Hub `/core`
- **Staffing** cluster: Staffing · Intent to Work · Project Bids · Level Up
- **Access** cluster: Roles & Permissions · Domains
- **Communications** cluster: Announcements · Email **Templates** *(Senders removed)*
- Attendance
- Agreements (compliance console)
- (Core hiring portal `/core/apply` — applicant-facing, unchanged)

**ADMIN (system)** — `/admin/*`
- Hub `/admin` (redesigned → system console, §5)
- **System & Insights** cluster: Analytics · AI Usage · Activity (Audit) · Jobs ·
  Feature Flags · **Email Senders** *(moved in)* · **Outbound Messages** *(moved in)*
- **Finance** cluster (Admin-only): Payroll Export · Payroll Reconcile

Access is unchanged: System & Insights stays `isCore`-visible; Finance stays
`isAdmin`-only. The win is *clarity of purpose*, not a new auth wall.

### 4.2 The two moves

**Email Senders → Admin/System.**
- `coreNav.tsx`: drop the `senders` subtab from the Communications → Email
  section (Email becomes Templates-only; the subtab strip collapses).
- `adminNav.tsx`: move the `email-senders` section out of the `communications`
  cluster into the `system` cluster.
- Remove the Core alias route `core.communications.email-senders.tsx` and its
  `routes.ts` entry; remove `regroupRedirect(...email-senders...)` from
  `admin.email-senders.tsx` so **`/admin/email-senders` is the single canonical
  URL** again.
- `routes.ts`: delete `core/communications/email-senders`.

**Outbound Messages → Admin/System.**
- `adminNav.tsx`: move the `outbound-messages` section from `communications`
  into `system`. It already has no Core alias and no redirect, so **no route
  churn** — this just files it under the cluster it actually lives in, ending the
  orphan. Canonical URL stays `/admin/outbound-messages`.

Net effect on clusters:
- Core Communications = **{Announcements, Email Templates}**.
- Admin Communications cluster is now empty of Core-owned items → it **collapses
  entirely**; Admin keeps **System & Insights** (7 items) + **Finance** (2). For
  flag-off viewers, Senders/Outbound simply appear under System instead of
  Communications — a strict improvement.

### 4.3 Dedup — one URL per page

Three surgical fixes; each removes a "renders in two places" ambiguity:

1. **`/admin` landing uses `adminClustersFor(flags)`.**
   `admin.tsx` currently: `ADMIN_CLUSTERS.filter(c => (admin || !c.adminOnly) && c.key !== "documents")`.
   Change to source from `adminClustersFor(flags)` (thread the flag map into the
   loader like the sidebar does), then apply the `adminOnly`/`documents` filter.
   Result: regrouped Admin landing shows **only System & Insights + Finance** —
   no more cards that bounce to Core. *(This is the single highest-value fix.)*

2. **Email Senders canonicalized to `/admin`** (per §4.2) — removes the
   `/core/.../email-senders` twin.

3. **Outbound Messages filed under System** (per §4.2) — ends the orphan; it now
   appears in exactly one cluster, in one hub.

Everything else already resolves to one canonical URL via `regroupRedirect`; no
change needed. The pre-regroup `/admin/members`-style URLs keep redirecting
(deep links and bookmarks stay alive).

### 4.4 Optional follow-up: retire `nav-regroup`

`nav-regroup` is `defaultEnabled` + `defaultEveryone`. The dual URL surface + the
re-export aliases exist **only to keep the flag-off nav working.** If Kiran wants
to commit (the whole app already assumes regroup), a later cleanup can:
- physically relocate the People/Comms impls from `app/admin/routes/` to
  `app/core/routes/` (Core owns them for real), leaving `/admin/*` as pure
  redirects or dropping them;
- delete `regroupRedirect`, `adminClustersFor`, `CORE_OWNED_CLUSTERS`, and the
  flag entry.

This is **out of scope for this pass** (bigger, touches many files, needs a
migration-free but wide diff). Flagged here as the natural end state. The Part A
fixes above are correct whether or not we ever retire the flag.

### 4.5 Core IA cleanup (lighter — Core is the secondary focus)

Core's sidebar is a flat run of 9+ tabs. Core already *has* the cluster
machinery (it uses `CORE_CLUSTERS` for Communications). Proposal: give Core the
same nested-hub shape Admin has, so its landing and sidebar read as grouped work
rather than a long list:

- **Staffing** cluster (`/core/staffing` hub): Staffing · Intent to Work ·
  Project Bids · Level Up
- **Access** cluster (`/core/access`): Roles & Permissions · Domains
- **Communications** cluster (unchanged): Announcements · Email Templates
- Standalone: Attendance · Agreements

This is a nice-to-have that makes Core and Admin visually symmetric (both
nested hubs). Can ship after the Admin work. Not required to fix the "in both"
problem.

---

## 5. Part B — Admin redesign

### 5.1 Concept: Admin as a **System Console**

Admin is now *only* plumbing, telemetry, money. Its landing should stop being a
launcher and start being a **status board** — the first thing an operator wants
is "is anything on fire?", then a jump-off to fix it. This also harmonizes the
two hubs: Core hub is a dashboard (calendar/deadlines); Admin hub becomes a
dashboard (system health).

Design language: stays inside the DALI style guide (coral accent, existing
`panel`/`shadow-brand` tokens). System pages lean into **status semantics** —
green/amber/red dots, tabular numerals for counts — to read as an ops surface
without inventing a new theme.

### 5.2 Admin hub — mockup

```
 Admin                                                       system console

 ┌── System health ──────────────────────────────────────────────────────┐
 │  ● Jobs            ● Outbound          ● AI today        ● Site (24h)   │
 │  12 on · 1 failing  4 pending · 0 dead  1.2k req · 340k   99.9% · 2 err │
 │  [View jobs →]      [View outbox →]     [AI usage →]      [Analytics →] │
 └────────────────────────────────────────────────────────────────────────┘
   ▲ amber when >0 failing   ▲ red when dead>0    (tiles are links)

 ┌── Recent activity ─────────────────────┐  ┌── Email senders ──────────┐
 │  ○ K. Jones  granted Core   ·  2m ago   │  │ Hiring     ● 41/500 today │
 │  ○ System    ran digest job ·  9m ago   │  │ Education  ● 12/500       │
 │  ○ A. Lee    edited flag     · 22m ago  │  │ Partners   ● 3/500        │
 │  ○ K. Jones  sent announce.  · 1h ago   │  │ General    ⚠ 470/500      │
 │  [Full audit log →]                     │  │ [Configure senders →]     │
 └─────────────────────────────────────────┘  └───────────────────────────┘

 ── Jump to ─────────────────────────────────────────────────────────────
 SYSTEM & INSIGHTS
 [Analytics] [AI Usage] [Activity] [Jobs] [Feature Flags] [Senders] [Outbox]
 FINANCE  (admin only)
 [Payroll — Hire Setup] [Payroll — Reconcile]
```

Loader adds a few cheap counts (jobs enabled/failing already exist; add outbound
pending/dead, AI today totals, 24h error count, per-sender usage, last ~6 audit
rows). All default-0/empty so the hub degrades gracefully. The bottom "Jump to"
is the existing card grid, demoted below the live signals and filtered to
System + Finance only (§4.3 fix).

### 5.3 Page redesigns (the four bare tables)

**a) Activity / Audit Log** — table → **filterable timeline**

```
 Activity                                     [ action ▾ ] [ who ▾ ] [ 7d ▾ ]

  Today
   ●  09:41   K. Jones      granted Core to  A. Rivera        ⌄
              └ term 26F · membership.role: Staff → Core · ip 129.170.x.x
   ●  09:12   System        ran job  daily-digest             ⌄
   ⚑  08:55   A. Lee        toggled flag  templates  → on     ⌄
  Yesterday
   ●  17:03   K. Jones      sent announcement  "All-hands"    ⌄
```
- action-type icon + color chip (grant/role = coral, job = grey, flag = amber,
  destructive = red); actor avatar; relative time with absolute on hover;
  expandable metadata row (the JSON we already store). Keep the existing
  filter/pagination loader — this is a render change, not a data change.

**b) AI Usage** — numeric table → **summary + leaderboard**

```
 AI Usage                                                      [ 7d ·30d·90d ]

 ┌ Requests ─┐ ┌ Tokens in ┐ ┌ Tokens out ┐ ┌ Members ─┐
 │   1,240   │ │   340k    │ │   180k     │ │    18    │
 └───────────┘ └───────────┘ └────────────┘ └──────────┘
  sparkline ▁▂▃▅▇▆▅  (requests / day)

  Member            Requests   Tokens        share
  K. Jones            420      120k   ███████████░░░░  34%
  A. Lee              180       55k   █████░░░░░░░░░░  15%
  …                                                    [export csv]
```

**c) Email Senders** — table → **per-purpose cards with usage gauges**

```
 Email Senders                            the Gmail accounts each area sends as

 ┌ Hiring ───────────────┐ ┌ Education ─────────────┐
 │ dali-hiring@…         │ │ dali-ed@…              │
 │ ▓▓▓▓░░░░░  41 / 500   │ │ ▓░░░░░░░  12 / 500     │
 │ ● connected           │ │ ● connected            │
 │ [Reconnect] [Cap ▾]   │ │ [Reconnect] [Cap ▾]    │
 └───────────────────────┘ └────────────────────────┘
 ┌ Partners ─────────────┐ ┌ General ───────────────┐
 │ dali-partners@…       │ │ dali@…                 │
 │ ▓░░░░░░░  3 / 500     │ │ ⚠ ▓▓▓▓▓▓▓▓▓ 470 / 500  │
 │ ● connected           │ │ ● connected · near cap │
 └───────────────────────┘ └────────────────────────┘
```
- gauge turns amber approaching cap; a disconnected purpose shows a red dot +
  "Connect" (uses the existing `/admin/authorize-gmail` OAuth flow).

**d) Outbound Messages** — table → **status-segmented outbox**

```
 Outbound Messages                                        [ search… ]

  [ All 128 ] [ Pending 4 ] [ Sent 120 ] [ Dead 0 ] [ Canceled 4 ]

  ✉ email   ⧗ Pending   → a.rivera@…   "Interview invite"   0 tries   ⟳ retry ✕
  ✉ email   ✓ Sent      → lab@…        "All-hands"          1 try     · 1h ago
  ⧉ slack   ✓ Sent      → @kiran       digest               1 try     · 9m ago
  ✉ email   ✗ Dead      → x@…          "Reminder"  smtp 550  3 tries   ⟳ retry
```
- channel icon (email/Slack), status chip with color, inline last-error on Dead,
  Retry/Cancel actions preserved. Segment tabs are just the existing status
  filter surfaced as counts.

### 5.4 Consistency notes

- Reuse `panel`, `panelPad`, `shadow-brand-*`, `text-accent-coral` — no new
  palette. Add only status dot/gauge utility classes.
- Tabular numerals (`tabular-nums`) for all counters so columns don't jitter.
- Status vocabulary is shared across pages: `● green` ok · `⚠ amber` attention ·
  `✗ red` failure. Same three everywhere (jobs, senders, outbox, health tiles).
- Health-tile counts should be cheap, individually-`try/catch`ed queries with 0
  fallbacks (mirror the current `admin.tsx` badge pattern) so one slow table
  never blocks the hub.

---

## 6. Phasing (once greenlit) — FINAL

All decisions locked (§7). Because `nav-regroup` is being **retired**, the dedup
and the retirement are the same structural change, so they merge into P1.

- **P1 — Allocation + dedup + retire `nav-regroup` (the structural pass). ✅ BUILT.**
  Approach taken: make the regroup **permanent** rather than physically moving
  impl files (lower churn, less risk on shared nav infra). Concretely:
  - `regroupRedirect()` is now **unconditional** (dropped the flag + roles
    lookup) — the pre-regroup `/admin/*` and `/projects/*` process URLs always
    302 to their canonical `/core/*` address, with the `from`-prefix guard
    keeping it inert on the canonical path. Deep links survive; impl files stay
    where they are and the `/core/*` re-export aliases remain canonical.
  - Moved **Email Senders** + **Outbound Messages** into the Admin **System &
    Insights** cluster (§4.2). Senders is canonical at `/admin/email-senders`
    again (removed its `regroupRedirect`; the old `/core/.../email-senders`
    alias now redirects *to* `/admin`). Outbound stays `/admin/outbound-messages`
    (orphan resolved — it's a real System section now). Core Communications =
    Announcements + Email Templates only.
  - Deleted `adminClustersFor`, `CORE_OWNED_CLUSTERS`, the flag-off branches in
    `nav-areas.ts` (`areasFor`/`pinnedNavItems` are unconditional; `NAV_AREAS`
    kept only for `ALL_AREAS` favourite/icon back-compat), and the `nav-regroup`
    flag entry. `AdminClusterKey` narrowed to `finance | system`. The two Admin
    cluster-hub routes (`/admin/people`, `/admin/communications`) became plain
    redirects. The `/admin` landing now shows only System + Finance because
    ADMIN_CLUSTERS itself no longer carries the process clusters.
  - Core sidebar stays **flat** (decision #2). No cluster hubs added.
  - No schema, no migration. 14 files, net −121 lines. typecheck (0 app errors)
    + full unit suite (3765) green.
- **P2 — Admin hub console (§5.2, full console — decision #3):** loader signals
  (jobs, outbound, AI today, 24h errors, sender usage, recent audit rows) + the
  new landing layout. *(next)*
- **P3 — The four page redesigns (§5.3):** Audit Log, AI Usage, Email Senders,
  Outbound Messages. Independent of each other and of P2 — land one at a time.

Each phase is its own PR to `staging`.

---

## 7. Decisions

1. **Retire `nav-regroup` (§4.4) — CONFIRMED.** The regroup is the committed
   model. Folded into P1: relocate People/Comms impls into `app/core/routes/`,
   drop `regroupRedirect`/`adminClustersFor`/`CORE_OWNED_CLUSTERS`, delete the
   flag. Old `/admin/*` process URLs become thin redirects so deep links survive.
2. **Core IA — KEEP FLAT (CONFIRMED).** No cluster hubs for Core; the 10-item
   flat sidebar stays. §4.5 / Appendix A are **not** being built. Every Core tool
   remains one click from the sidebar.
3. **Admin hub density — FULL CONSOLE (CONFIRMED).** Build §5.2: health strip +
   recent-activity feed + email-sender usage panel + demoted launcher grid.

---

## Appendix A — Core IA options (for decision #2)

**Today (flat):** 10-item Core sidebar; `/core` landing is the calendar dashboard.

```
 CORE                              /core landing = month calendar +
  ▸ Hub                            upcoming Core meetings + deadlines
  ▸ Staffing                       (unchanged in both options)
  ▸ Intent to Work
  ▸ Project Bids          ← "staffing" work
  ▸ Level Up
  ▸ Roles & Permissions   ← "access" work
  ▸ Domains
  ▸ Communications        (already clustered)
  ▸ Agreements
  ▸ Attendance
```

**Option: Clustered** — mirror Admin's nested hub. Sidebar → 6 items; the cluster
entry deep-links to the primary tool (`clusterEntryPath`, same as Admin's
Email/Payroll), so the main tool stays one click; siblings are one pill away.

```
 CORE
  ▸ Hub
  ▸ Staffing         → /core/staffing       (Board · Intent · Bids · Level Up)
  ▸ Access           → /core/access         (Roles · Domains)
  ▸ Communications   → /core/communications (Announcements · Templates)
  ▸ Agreements
  ▸ Attendance

 Core › Staffing
 [ Board ] [ Intent to Work ] [ Project Bids ] [ Level Up ]
   → primary page = the live staffing board

 Core › Access
 [ Roles & Permissions ] [ Domains ]
```

Tradeoff: calmer sidebar + symmetric with Admin, vs siblings moving from
one-click to one-pill.

---

## Appendix B — Admin hub density options (for decision #3)

**Option A — full system console:** health strip + recent-activity feed +
email-sender usage panel + demoted "Jump to" launcher (see §5.2 for the full
mockup).

**Option B — health strip + launcher grid:** the four vitals up top, then the
normal cluster card grid below. No feed/senders panel; lighter loader + build.

```
 Admin                                                       system console
 ┌── System health ─────────────────────────────────────────────┐
 │ ● Jobs 12·1 fail   ● Outbox 4·0 dead   ● AI 1.2k   ● Site 99.9% │
 └───────────────────────────────────────────────────────────────┘
 SYSTEM & INSIGHTS
 [Analytics] [AI Usage] [Activity] [Jobs] [Feature Flags] [Senders] [Outbox]
 FINANCE (admin only)
 [Payroll — Hire Setup] [Payroll — Reconcile]
```

**Option C — cleaned grid only:** no health strip; just the §4.3 landing fix
(stop rendering Core clusters) with today's two badges retained. Minimal.

The four page redesigns (§5.3) are independent of this pick — they land in P3
regardless of which hub density is chosen.
