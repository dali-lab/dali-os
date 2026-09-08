# Mobile readiness review

**Date:** 2026-09-07 · **Branch:** `claude/mobile-review` · **Method:** static analysis of `dali-api/app/` by 5 parallel sub-agents (shell, drag/touch, overflow, overlays, CI) + spot verification.

DALI OS was built desktop-first. This is a holistic map of what breaks on a ~375–430px phone viewport, a phased remediation plan (**Part A**), and a plan for automated mobile CI (**Part B**).

## Implementation status — 2026-09-07 · branch `claude/mobile-review`

**Built & verified** (typecheck: 0 errors in `app/` + `e2e/`, only 11 pre-existing baseline errors in untouched `scripts/`+`prisma/seeds/`; **all 3999 unit tests pass**). 34 files changed + 2 new.
- **Phase 0 foundation** — `app/hooks/useIsMobile.ts` (`useIsMobile`/`useMediaQuery`); `app.css` gains `@custom-variant touch (@media (hover:none))` + `dnd-touch-handle` utility; **server-side mobile→tabless** in `lib/tabless.ts` (mobile UA now renders the single-page shell regardless of cookie; desktop + the Tauri desktop shell keep the tabbed workspace — their UAs don't match the mobile regex).
- **Phase 1 overflow / Phase 2 touch / Phase 3 layouts / Phase 4 polish** — landed. Touch DnD uses the desktop-preserving contract: `PointerSensor`→`MouseSensor` (distance) + `TouchSensor` (delay 200 / tolerance 8) + `dnd-touch-handle`, applied to KanbanBoard/StaffingBoard/TaskBoard/partners/FormBuilder/RubricDetail/DriveBrowser. WeekGrid converted mouse→pointer events. Hover-gated actions get `touch:`/`focus-within:` fallbacks. `SlotColumnMapper` migrated HTML5→@dnd-kit. Calendar sidebar → mobile drawer; CreateEventModal + VersionHistory panes stack; tables wrapped in `overflow-x-auto`; boards stack single-column < md; fixed-width overlays clamped; ⌘K added to mobile top bar.
- **Part B CI (Phase 1–2)** — `assertNoHorizontalOverflow(page, {soft})` helper in `e2e/helpers.ts`; `mobile-audit.spec.ts` rewritten to run under a real mobile context (21 routes, **report-only / soft** overflow assertions); new `mobile-pixel7` Playwright project (`devices['Pixel 7']` @ 375px) runs the audit inside the **existing** e2e job. No `.github/workflows/` files were edited.

**Deferred (needs follow-up):**
1. **HTML5→@dnd-kit** for `projects/routes/projects.$id.tsx` (doc/folder reorder, dual reorder+reparent semantics in a ~5700-line file) and `education/components/ManageCourseContent.tsx` (reparent-into-folder, not a sort). Both non-functional on touch today but don't regress desktop; each needs a focused PR with test coverage.
2. **Workflow-file changes** (held for explicit approval per CLAUDE.md): a separate `mobile-e2e` CI job, flipping the audit `soft`→hard once a seeded run confirms routes pass, and the Lighthouse **mobile budget** (`MIN_PERF_SCORE`/`MIN_A11Y_SCORE` in `preview-deploy.yml`). Ready-to-paste YAML lives in Part B below.

---

## TL;DR

- **Foundation is fine.** `root.tsx:77` ships a correct `<meta name="viewport" content="width=device-width, initial-scale=1">` (no zoom-lock). The shells (`Layout`, `LayoutOS`, `LayoutClassic`) already have a `md:hidden` mobile top bar + hamburger drawer, and the base `Modal` centers and scrolls. So responsive CSS works today — nothing is globally blocked.
- **Three structural P0s dominate everything else:**
  1. **The tabbed workspace has no mobile mode.** Non-tabless users (the default) get a horizontally-scrolling iframe tab strip on a phone. Nothing auto-switches to the single-page (tabless) shell on narrow screens.
  2. **Drag is broadly broken on touch** — *both* the native-HTML5/mouse-only surfaces (definitely dead) *and* the @dnd-kit surfaces (Kanban, tabs, Drive), because they use `PointerSensor` + a `distance` constraint with **zero `touch-action`** and **zero `TouchSensor`** — the config that loses the gesture to page-scroll on touch.
  3. **Content renders inside iframes / `overflow-hidden` wrappers, so overflow is silently clipped rather than scrollable** — and the *existing* mobile audit only checks the outer document width, so it never catches it.
- **Most route _content_ has no responsive breakpoints.** ~403 responsive-prefix (`sm:`/`md:`/`lg:`) usages exist app-wide, heavily concentrated in a handful of files; the shell adapts, the pages inside do not.

---

# Part A — Issues found & remediation plan

Severity: **P0** = core workflow impossible/offscreen on mobile · **P1** = significantly degraded · **P2** = polish. File refs are `dali-api/app/…`.

## A0. Foundation (verified good — no work needed)
- ✅ Viewport meta correct — `root.tsx:77`.
- ✅ Shell mobile scaffolding exists — `md:hidden` top bar + hamburger drawer in all three shells (`Layout.tsx:853`, `LayoutOS.tsx:799`, `LayoutClassic.tsx:599`); desktop sidebar `hidden md:flex`.
- ✅ Base `Modal` is mobile-safe — `Modal.tsx:63` (`inset-0 … p-4 sm:p-6 overflow-y-auto`, `max-w-md w-full max-h-[85vh]`).
- ✅ Floating-UI `Select`/`Popover` reposition correctly (`flip`+`shift`+`size`).
- ⚠️ **No `useMediaQuery`/`useIsMobile` hook exists anywhere.** This is the missing shared primitive; several fixes below need it. Add it first.

## A1. Shell doesn't switch to a mobile mode  — **P0**
| # | Issue | Ref | Fix |
|---|---|---|---|
| 1 | **Tabbed workspace has no mobile fallback.** Default (non-`dali_tabless`) users get an `overflow-x-auto` iframe tab strip + split-pane concept on a phone. `TabWorkspace` has **no** `innerWidth`/`matchMedia`/mobile branch (verified). | `components/TabWorkspace.tsx` | Auto-force tabless (single-page) shell below `md` — set `dali_tabless=1` for mobile UA in the loader, or a client `useEffect(innerWidth<768)` before first paint. **Highest-leverage fix in the whole review** — it makes every route render as a plain page. |
| 2 | **Calendar sidebar `hidden lg:flex`** — mini-month, account toggles, visibility controls, "meet with", timesheet roles all vanish <1024px with **no replacement**. | `calendar/components/CalendarSidebar.tsx:287`, `calendar/routes/calendar.tsx:794` | Expose the sidebar content behind a "Calendars" button → drawer/bottom-sheet on `<lg`. |
| 3 | **Most route content has no breakpoints.** Shell adapts; page bodies are fixed desktop layouts. | app-wide | Mobile-first default: page columns `flex-col`, add `md:flex-row` for side-by-side. Prioritize Home, Projects hub, Tasks. |

## A2. Drag & touch interactions  — **P0**
**Root cause (verified):** `TouchSensor` and `touch-action` appear **0 times** in the codebase. Every @dnd-kit board uses `useSensor(PointerSensor, { activationConstraint: { distance } })` (`components/board/KanbanBoard.tsx:141`). On touch, moving a finger `distance` px is interpreted as a page scroll → browser fires `pointercancel` → drag aborts. Net: **most drag surfaces are broken or unreliable on touch**, not just the HTML5 ones.

**Completely dead on touch (native HTML5 `draggable`/`dataTransfer`, or mouse-only listeners):**
| Surface | Ref |
|---|---|
| Calendar WeekGrid drag-to-create / move / resize (`onMouseDown` + `window.mousemove/up`) — **P0** | `calendar/components/WeekGrid.tsx:693,743,1089,1178` |
| Project Documents tab reorder (HTML5) | `projects/routes/projects.$id.tsx:4543` |
| Education course-content reorder (HTML5) | `education/components/ManageCourseContent.tsx:128` |
| Slot column mapper reorder (HTML5) | `projects/components/SlotColumnMapper.tsx:429` |
| Epics timeline bars — stray `draggable={editMode}` attr fights the pointer tracker (inconsistent iOS/Android) | `projects/components/EpicsTimeline.tsx:1403` |

**Unreliable on touch (@dnd-kit, `PointerSensor` + `distance`, no `touch-action`):** Task Kanban, Staffing board, Delibs board, Partner-apps board, browser tab reorder, Drive item DnD, Form-builder & Rubric reorder — all via `KanbanBoard.tsx:141` / their own `useSensors`.

**Fixes:**
- **One shared fix covers the boards + tabs:** in `KanbanBoard` (and each `useSensors` site) switch to `activationConstraint: { delay: 200, tolerance: 6 }` (press-and-hold, the dnd-kit-recommended touch pattern) **and** add `touch-action: none` to drag handles (a `.dnd-handle { touch-action: none }` utility in `app.css`). Optionally add `TouchSensor` alongside `PointerSensor`.
- Migrate the 4 HTML5-drag surfaces to @dnd-kit sortable + `PointerSensor` (pattern already in `DriveBrowser.tsx`).
- Calendar WeekGrid: convert `onMouseDown`→`onPointerDown` and `window.mousemove/mouseup`→`pointermove/pointerup` (unifies mouse+touch; the hiring availability grid at `hiring/components/CalendarGrid.tsx:250` already does touch correctly — port it).
- Remove the stray `draggable={editMode}` on `EpicsTimeline`.

**Hover-only actions (no touch fallback) — P1/P2:** form-builder edit/delete (`form-builder/FormBuilder.tsx:707,783`), rubric edit/delete (`hiring/components/RubricDetail.tsx:419`), page icon/cover (`components/DocumentEditor.tsx:831`), calendar-row delete (`calendar/components/CalendarSidebar.tsx:218`), open-tasks flyout (`Layout.tsx:569`), tab context menu / double-click promote (`TabWorkspace.tsx:428,2217`). Fix: add `focus-within:opacity-100`, or reveal on `@media (hover: none)`, or move actions into a persistent `⋯` menu; give tabs a long-press/visible action instead of dblclick+right-click.

## A3. Horizontal overflow / offscreen content  — **P0 / P1**
| Sev | Issue | Ref | Fix |
|---|---|---|---|
| P0 | Tables clipped by `overflow-hidden` corner-rounding wrappers (no scroll → columns silently cut off): Waitlists, Internal-cycle decisions | `hiring/routes/waitlists.tsx:176`, `hiring/routes/lead.internal-cycle.$id.tsx:1381` | Insert `<div className="overflow-x-auto">` between wrapper and `<table>`; add `min-w-[560px]`. |
| P0 | Calendar week/day grid compresses to ~45px columns (`w-14` time axis + 7 flex cols, no `min-w`/scroll wrapper) | `calendar/components/WeekGrid.tsx:1221`, `calendar/routes/calendar.tsx:814` | `min-w-[640px]` + wrap parent in `overflow-x-auto`; or auto-switch to Day/Agenda <md. |
| P0/P1 | Kanban/staffing/partner boards = `flex-shrink-0 w-64/w-72` columns (scroll exists but unusable on a phone) | `projects/components/StaffingBoard.tsx:591`, `projects/components/TaskBoard.tsx:716`, `partners/routes/partners.applications.tsx:1168` | Stacked single-column list below `md`. |
| P1 | Fixed-width overlays overflow 375px: DocComments `w-[380px]` (comments unreachable), CalendarsPanel `w-[22rem]`, AddMemberFlow `w-80`, VersionHistory `w-72` split, Drive Miller cols `min-w-[15rem]` | `doc/comments/DocCommentsPanel.tsx:241`, `calendar/components/CalendarsPanel.tsx:143`, `projects/components/AddMemberFlow.tsx:236`, `collab/VersionHistoryPanel.tsx:309`, `drive/DriveBrowser.tsx:2524` | Clamp: `w-[min(380px,calc(100vw-1rem))]`; stack two-pane panels <sm; `overflow-x-auto` on Miller row. |
| P1 | `grid-cols-4` rubric editor doesn't collapse (score input ~78px) | `hiring/components/RubricDetail.tsx:347,453` | `grid-cols-1 sm:grid-cols-4`. |
| P1 | Other clipped tables: Education CourseHub, Admin Analytics errors | `education/components/CourseHub.tsx:918`, `admin/routes/admin.analytics.tsx:309` | `overflow-hidden`→`overflow-x-auto`; wrap in scroll div. |
| P1 | AreaPillNav `overflow-x-auto no-scrollbar` — extra pills scroll with no cue | `components/AreaPillNav.tsx:48` | Right-edge fade mask, or dropdown on narrow. |
| P1 | `lead.cycle` table `hidden sm:block` but **no** `sm:hidden` card fallback → mobile sees nothing | `hiring/routes/lead.cycle.$id.tsx:2052` | Add stacked-card fallback (pattern exists at `:1876`). |

## A4. Modals, menus & touch targets  — **P0 / P2**
| Sev | Issue | Ref | Fix |
|---|---|---|---|
| P0 | **CreateEventModal** two-panel `flex-row`, left panel `w-[52%] shrink-0`, no collapse → ~190px panes at 375px | `calendar/components/CreateEventModal.tsx:464` | `flex-col sm:flex-row`, left `w-full sm:w-[52%]`; gate availability grid behind a toggle on mobile. |
| P1 | **⌘K palette** has no touch trigger in the mobile top bar (search only inside the hamburger drawer) | `LayoutOS.tsx:799`, `Layout.tsx:853` | Add a `Search` icon button to the mobile top-bar icon row (next to bell/profile). |
| P1 | **DateField** popover never flips upward → clipped near viewport bottom | `components/ui/DateField.tsx:197` | Flip when `top+height>innerHeight`, or adopt floating-ui `flip()`. |
| P2 | Touch targets <44px: modal close `p-1` (~28px), calendar week-nav arrows `h-7 w-7` | `Modal.tsx:192`, `CreateEventModal.tsx:478` | Bump padding to `p-2.5`/`h-10 w-10`. |
| P2 | No safe-area (notch) insets on CommandPalette; favorites strip hidden on mobile; collapsed-sidebar state bleeds into the mobile drawer | `CommandPalette.tsx:351`, `LayoutOS.tsx:862`, `Layout.tsx:466` | `env(safe-area-inset-*)` padding; force non-collapsed in drawer. |

## Remediation plan (phased)

**Phase 0 — Primitives & highest-leverage switch (small, do first)**
1. Add `useMediaQuery`/`useIsMobile` hook (shared primitive; none exists).
2. **Auto-enable tabless shell < md** (A1#1) — single change removes the iframe tab chrome from phones and makes every route a plain page. Do this before per-page CSS work; it changes what "mobile" even renders.
3. Add `.dnd-handle { touch-action: none }` utility + a global `@media (hover:none)` reveal helper.

**Phase 1 — Stop the offscreen bleeding (overflow P0/P1, A3)** — wrap clipped tables, clamp fixed-width overlays, collapse `grid-cols-*`, stacked-list boards. Low-risk CSS, high visible payoff. Gate with the CI overflow check (Part B) so it stays fixed.

**Phase 2 — Touch interactions (A2)** — the shared KanbanBoard `delay/tolerance`+`touch-action` fix; migrate 4 HTML5 surfaces to @dnd-kit; WeekGrid pointer-events; hover-action fallbacks.

**Phase 3 — Feature-area mobile layouts** — calendar sidebar drawer + Day/Agenda default (A1#2, A3), CreateEventModal stack (A4), timesheet card view, two-pane→stacked panels.

**Phase 4 — Polish (A4 P2)** — touch targets, safe areas, month-grid truncation, favorites access.

Each phase is independently shippable behind existing patterns; recommend one `mobile-*` feature flag if you want to stage the tabless-on-mobile switch for a beta cohort.

---

# Part B — Expanded mobile CI testing

### What exists today (verified)
- **Playwright:** two projects, **both `devices['Desktop Chrome']`** (1280×720) — `playwright.config.ts`. `baseURL :3001`, `webServer: npm run dev`, `retries: CI?1:0`. No mobile project, no `isMobile`/`hasTouch`.
- **`e2e/mobile-audit.spec.ts` already exists** (this is the "small mobile audit"). It sets `test.use({ viewport: {375×812} })`, logs in as admin, loops 15 static routes, screenshots each, and asserts no overflow. **Two blind spots:** (a) it asserts only the **outer** `document.documentElement.scrollWidth` and *collects but never asserts* iframe width — and because the tabbed shell renders content inside iframes (`fixtures.ts` pins `dali_tabless=0`), inner overflow is invisible; (b) a bare viewport override, **not** a device preset, so `isMobile`/`hasTouch`/UA/DPR are all off. It runs under the desktop `chromium` project today → mostly a screenshot generator + weak check.
- **CI:** `.github/workflows/test.yml` runs Vitest + Playwright (chromium only) against a Postgres 16 service container. No device matrix.
- **Lighthouse:** `preview-deploy.yml` runs PSI **mobile + desktop** on Home + Login per PR via the dev-login trick, comments scores, but gates on `MIN_PERF_SCORE: "0"` (**report-only**); a11y collected, never enforced. Baseline Home-mobile ≈ 83.

### Plan
**Fix the audit's blind spots** (Phase 1): assert **iframe** width too (or navigate with `?embed=1` to bypass the shell — the pattern specs already use); swap the manual viewport for `devices['Pixel 7']` so `isMobile`/`hasTouch` are real; convert to per-test assertions (not an `afterAll` console dump); expand routes to include detail/dense pages (`/drive`, `/education`, `/tasks`, `/people`, project & task detail, admin subtabs). This is the cheapest, highest-value check — it directly catches the "renders offscreen" class.

**Add a mobile Playwright project** (Phase 2): a `mobile-pixel7` project with `grep: /@mobile/` running a tagged subset (smoke, nav, hiring-hub, education, mobile-audit) — not all specs (keeps CI ~+2–3 min). Uses Chromium under the hood, so no new browser binary. Run it as a **separate `mobile-e2e` CI job** (its own Postgres service) so failures triage independently; start `continue-on-error: true`.

**Lighthouse mobile budget** (Phase 3): raise `MIN_PERF_SCORE` off 0 (start 75, ~10% under baseline), add `MIN_A11Y_SCORE: 85`, and add `/projects` + `/hiring` PSI routes — all in the existing `preview-deploy.yml` job (~+1 min, preview only).

**Touch-drag tests** (Phase 5): only meaningful **after** the Phase-2 touch fixes land (before that they just confirm breakage — which is itself a fine red baseline). Cover Kanban, Drive, tab reorder under `hasTouch`.

**Visual regression** (optional, Phase 6): `toHaveScreenshot()` at 375px for a few *stable* screens (Login, Home, hiring hub) with `mask:` on avatars/timestamps and `maxDiffPixelRatio: 0.02`; snapshots in `e2e/snapshots/mobile/`, updated via manual workflow-dispatch, not per-PR. High maintenance — do last, keep report-only.

### Rollout
| Phase | Ships | Blocking? | CI cost |
|---|---|---|---|
| 1 | Fix + expand `mobile-audit.spec.ts` (device preset, assert iframe width, ~23 routes, per-test) | Yes (already asserts) | +0 (same chromium project) |
| 2 | `mobile-pixel7` project + `@mobile` tags + separate `mobile-e2e` job | Report-only | +2–3 min/PR |
| 3 | `MIN_PERF_SCORE=75` + `MIN_A11Y_SCORE=85` + more PSI routes | Yes (preview gate) | +1 min/PR (preview) |
| 4 | Drop `continue-on-error` on `mobile-e2e` | Yes | — |
| 5 | Touch-drag specs (after A2 fixes) | Yes | +1 min |
| 6 | Visual snapshots (Login/Home/hub) | Report-only | +~30s/shot |

**Watch-outs:** switch the audit user to the stable `admin@dali.dartmouth.edu` (PSI already uses it); add `testIgnore: /mobile-audit/` to the desktop `chromium` project once it moves to `@mobile` (avoid running twice); prefer `?embed=1` for content-overflow tests so the iframe shell doesn't mask bugs.
