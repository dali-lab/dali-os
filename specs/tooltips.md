# Site-wide tooltips

Status: in progress · Branch `feat/site-tooltips` · Started 2026-08-26

## Goal

The app has lots of copy explaining features and processes, but almost none of
it is attached to the control it describes. Introduce **one** tooltip primitive
and roll it out across the site so jargon, ambiguous badges, disabled controls
and icon-only buttons explain themselves on hover/focus/tap.

## Decisions (locked with Kiran)

- **Comprehensive sweep**, not a curated subset — every area, including migrating
  the ~440 native `title=` hints to the component.
- **Clean rebuild, no back-compat.** The old string-only `Tooltip` that lived in
  `ui/IconButton.tsx` is gone; call sites move to the new API.
- **ⓘ InfoTip** icon next to a label is the affordance for explaining jargon.

## The component (`app/components/ui/floating/Tooltip.tsx`)

Built on `@floating-ui/react`, matching the rest of `ui/floating/`
(Popover/Menu/Select): flips/shifts off screen edges, portals out of
overflow-clipped ancestors, opens on hover (250ms) + keyboard focus, dismisses
on Escape, `role="tooltip"` for a11y.

```tsx
import { Tooltip, InfoTip } from "~/components/ui/floating";

// label variant — name an icon-only control (compact dark chip, no wrap)
<Tooltip content="Delete epic">
  <button aria-label="Delete epic">…</button>
</Tooltip>

// rich variant — a sentence or two of explanation (card surface, wraps ~260px)
<Tooltip content="Whether this role must be filled for the project to run." variant="rich">
  <span>Essentiality</span>
</Tooltip>

// InfoTip — the ⓘ affordance next to a jargon label (rich tooltip built in)
<label className="inline-flex items-center gap-1">
  Essentiality
  <InfoTip content="Whether this role must be filled for the project to run. Set by the PM." />
</label>
```

Props: `content` (ReactNode; `null`/`""` = no tip), `placement` (floating-ui
`Placement`, default `top`), `variant` (`"label"` | `"rich"`, default `label`),
`delay` (ms, default 250), `disabled`, `className`. `IconButton` delegates to it
(`content={label}`, `placement={tooltipSide}`).

### When to use which

| Situation | Use |
|---|---|
| Icon-only button (toolbar/row action) | `IconButton` (free tooltip) or `<Tooltip content="Name">` wrapping the button |
| Jargon term / heading needs a definition | `InfoTip` next to the label |
| Badge / pill / colored dot whose meaning isn't obvious | `<Tooltip variant="rich">` on the badge |
| Disabled control | `<Tooltip variant="rich" content="why it's disabled">` on a wrapper span (disabled buttons don't fire hover) |
| Truncated text | `<Tooltip content={fullText}>` on the truncated node |

### Rules

- Copy explains the **why**, doesn't just repeat the label. 1–2 sentences for
  rich; a couple words for label.
- Don't wrap a disabled `<button>` directly — hover events don't fire on it. Put
  the Tooltip on an enclosing `<span>`.
- Prefer verifying the copy against the nearby code/prose over trusting the
  survey draft verbatim.
- Retire the native `title=` on the same element when you add a Tooltip (no
  double tooltip).

## Rollout — foundation (done)

- [x] `Tooltip` + `InfoTip` on floating-ui (`ui/floating/Tooltip.tsx`), exported from `ui/floating/index.ts`
- [x] `IconButton` delegates to the new `Tooltip`; old hand-rolled tooltip deleted
- [x] Migrated all existing `<Tooltip label=…>` call sites (26 files) to the new API
- [x] Typecheck green (app/)

## Rollout — sweep (per area)

Each area: (a) add `InfoTip`s for the jargon below, (b) add why-disabled
tooltips, (c) migrate native `title=`/icon-only buttons to the component. Flagship
items per area from the code survey — not exhaustive; grep `title=` in the area
for the rest.

### Projects / Board / Timeline (`app/projects`, `app/components/board`)
- Staffing: `MemberCard` "Bid unresolved" / "Added" badges, "No domain eligibility", domain-level chip (P1/P2/P3), "+ Domain"
- `RoleBadge` mentor/mentee (level-derived, auto-pairing)
- `StaffingBoard` Finalize ✓ button, open-project ↗
- `TaskBoard` update-bell, overdue date, checklist `3/5`, disabled Sprint/Story selects (need one first)
- `EpicSprintManager` MoSCoW priority pills (Must/Should/Could/Wont)
- Term codes (e.g. "26F"), Domain filter

### Hiring / Staffing / Core (`app/hiring`, `app/core`) — densest
- **delibs** (deliberations board), pre-pipeline pills (Reviewing / Interview scheduled / Post-interview)
- Recommendation scale (Strong Hire → No Hire), reviewer status pills, "3/5 submitted"
- Cycle status (Open / Under review / Draft / Completed), Decision Draft→Final→Released, **Accepted elsewhere**
- **synthetic CORE domain**, Force Mark Ready, Mark Ready
- Why-disabled: Advance Cycle (checklist unmet), Auto-Assign Reviewers (need rubrics), confidentiality gate
- Waitlist accept (runs full release flow even post-cycle)

### Education / Forms (`app/education`, `app/forms`, `app/components/form-builder`)
- **Miniseries vs Workshop**, Draft/Published/Archived, attendance ✓/✗/− marks + % color threshold
- **CE credit** ("1 per term"), CE compliance badge, completion threshold %
- Waitlist rank, feedback bindings (session feedback vs instructor exit), two-lane instructor notes (shared vs internal)
- Why-disabled: Type locked after create, form locked after first submission
- Form versioning (draft = scratch vs frozen version), required `*`, page break (layout not question)

### Admin / Jobs / Signing (`app/admin`, `app/jobs`, `app/signing`)
- Job interval/lease ranges (surfaced from registry defaults), Feature-flag targeting (Everyone / Role / Person semantics)
- AI usage quota (200/day + 10/min burst; token counts best-effort), email sender daily cap (blank = uncapped)
- Signing fields (Initials / Text / Supervisor signature = presigned at issuance), "Put in force"
- Agreement audience (NewMembers / Members / Mentors / HiringParticipants), binding completion %, Remind (24h throttle)
- Domain level badge = dropdown, delete-domain disabled (in use)

### Members / Mentorship / Presence (`app/members`, `app/mentorship`, `app/components/presence`)
- `RolePills` (Admin / Core / Domain Lead — scope, not just title), warmth "New" (<30d) + 🎂
- Avatar presence dots (active now / recently / hidden), mentor-note **vibes** (Excellent / Room for improvement / Concerning)
- `PersonalNotesRail` visibility marks (Lock / Eye / Landmark / Users), mentor-note visibility (mentors+Core, not mentee)
- Achievements earning criteria (already uses tooltip — migrate), why-disabled level options (eligibility / mentee count)

### Drive / Docs / Sharing / Calendar / Collab (`app/components/{drive,doc,doc-chrome,sharing,page-docs,collab}`, `app/calendar`)
- Drive view toggles (columns/list/grid), **Managed** folder chip (rename/delete locked), file/breadcrumb truncation
- Sharing tiers (View/Comment/Edit/FullAccess), **General access** ("Everyone in the lab" vs restricted), partner visibility
- Presence "connecting" dot, "+N more", version-history snapshots, comment Jump-to-cursor (disabled = doc-level), Resolve/Reopen
- Calendar: dynamic vs static groups, recurring meeting, freebusy, RSVP

### Shell / Nav / Settings / UI kit (`app/components/*` top-level, `app/components/settings`, `app/components/ui`, `app/routes`, `app/partners`)
- **Collapsed sidebar** icon-only nav (Home, My Tasks + count, Calendar, area hub, sub-tabs, profile, settings, logout)
- Tab controls (close/pin/history back-forward/overflow +N), Search ⌘K hint
- Settings toggles: Focus mode, Appear away (activity still recorded), notification channels (in-app/email/Slack/desktop), Slack-DM disabled = "connect Slack first"

## Notes / gotchas
- `admin.payroll.tsx` imports recharts' own `Tooltip` — the UI one is aliased `UiTooltip` there.
- Worktree needs `prisma generate` (placeholder `DATABASE_URL`) + `npm install` for the missing `@zxing/browser` / `passkit-generator` optional deps before typecheck is clean.
