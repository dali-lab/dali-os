# Classes this term

Let members add their Dartmouth classes to the calendar in a couple of clicks —
accurate meeting times, term-bounded, and (by default) synced to a linked Google
calendar so they show on every device.

Behind the `calendar-classes` feature flag (ships off). Built on top of the
unified calendar (`calendar-unified`), so it's a stacked branch.

## The idea

- **Accurate times without a fetch.** Dartmouth publishes a fixed period
  schedule (10, 10A, 11, 2, 2A, x-hours, evening blocks). We transcribe it
  verbatim (`app/calendar/lib/dartmouth-periods.ts`, sourced from the ORC
  time-sequence page). Picking a period → exact weekly meeting times, x-hour
  included. A custom day/time fallback covers ARR / off-schedule sections.
- **X-hour is part of the class.** An "Include x-hour" checkbox on the class
  adds/edits/removes the x-hour meeting together with the main block — one class,
  two weekly patterns.
- **Classes live in the linked Google calendars.** Configurable per class: a
  dedicated "Classes" Google calendar, an existing calendar you pick, or a
  DALI-only layer when there's no Google link.

## Data

`MemberClass` (migration `20260827134509_member_class`): `userId`, `termId`,
`title`, `periodCode?`, `meetings` (resolved `PeriodMeeting[]` JSON — the source
of truth so period and custom classes share one render path), `location?`,
`storage` ("Google" | "Local"), `linkId?` / `calendarId?` / `googleEventIds[]`
(Google destination + the events we created). Term-scoped → clean rollover.

## Rendering — no double-draw

- **Google-stored** classes are real recurring events
  (`FREQ=WEEKLY;BYDAY=…;UNTIL=<term end>`, x-hour = a second event) written via
  `createGoogleCalendarEvent`. They appear through the **existing Google/external
  layer** (under "Linked calendars", in that calendar's Google colour) — never
  re-drawn locally. Because `fetchBusyEvents` only pulls calendars in the link's
  `subCalendarIds`, writing a class also **subscribes + enables** its target
  calendar (`ensureCalendarVisible`, seeding the real primary first when the set
  was empty) so a brand-new dedicated "Classes" calendar shows up immediately
  rather than needing a manual toggle in settings.
- **Local** classes are expanded server-side across the fetched range
  (`expandClassOccurrences`) and drawn by `buildClassesLayer` as a toggleable
  navy "Classes" layer.

All Dartmouth times are US/Eastern wall-clock; the grid renders them in the
viewer's timezone.

## Surfaces

- **Loader** (`calendar.tsx`): when the flag is on, loads the term's
  `MemberClass` rows → `memberClasses` (manager), `classOccurrences` (Local
  layer), `classDestinations` (add-form targets).
- **Action**: `class-add` / `class-update` / `class-remove` intents, handled
  before the Zod calendar action. Term is resolved server-side (never trusted
  from the form). Edit = full replace (tear down old Google events, recreate).
- **UI**: a Classes row + "Manage classes" in the toolbar's Calendars popover →
  `ClassesManagerModal` (period picker / custom, x-hour checkbox, destination,
  location; list with edit/remove).

## Server helpers

- `app/lib/member-class.server.ts` — create/update/remove + DTO/destination
  builders (prisma + Google CRUD).
- `app/lib/google-calendar.ts` — added `patchGoogleCalendarEvent`,
  `deleteGoogleCalendarEvent`, `getOrCreateNamedCalendar`; `createGoogleCalendarEvent`
  now takes `location`. Uses the existing full `auth/calendar` write scope.
- Pure/client-safe: `class-schedule.ts` (occurrence + RRULE math),
  `class-format.ts` (destination codec + summary), `dartmouth-periods.ts`.

## Deferred

Auto-fetch of a course's period from Dartmouth's public timetable (v2) and the
student's actual enrollment behind SSO/Banner (v3). v1 is period-table +
custom entry only.

## Flags for review

- **Additive migration** (new table, two FKs) — no data loss.
- **Google write**: creates/edits/deletes events on the member's own linked
  Google calendars (ownership checked against `UserCalendarLink`). Best-effort
  teardown (a failed delete orphans an event rather than blocking removal).
- Not tested live in CI (no seeded Postgres / real Google account in the
  worktree) — needs a staging pass with the flag on and a linked account.
