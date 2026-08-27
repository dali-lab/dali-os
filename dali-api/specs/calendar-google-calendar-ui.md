# Calendar as a Google Calendar UI — milestone spec

Turn the DALI calendar from a read-only availability surface into a full
**Google Calendar client**: create / read / update / delete events across all
linked Google calendars, plus manage the calendars themselves — all from the
DALI grid.

**Scope:** Google write, **Outlook read-only** (Outlook write = a separate
Microsoft Graph track, out of scope here). Behind a new `calendar-google-crud`
flag (ships off). Builds on the unified calendar + the classes write plumbing.

**Non-goals (this milestone):** Outlook write; changing free/busy scheduling,
availability, meeting scheduling, or timesheet behavior (all unchanged — they
keep using the existing "busy" read); a general offline/local calendar.

---

## Where we are today

- **Read is busy-only.** `fetchBusyEvents → fetchBusyForLink → fetchEventsForCalendar`
  (`app/lib/google-calendar.ts`) drops cancelled, `transparency:"transparent"`
  (free), and **all-day** (date-only) events, and skips events the viewer
  **declined**. Each `BusyEvent` carries `calendarId` but the DTO exposes **no
  event `id`, no `linkId`, no access role, no recurrence id** to the client.
- **Write helpers already exist** (built for classes): `createGoogleCalendarEvent`,
  `patchGoogleCalendarEvent`, `deleteGoogleCalendarEvent`, `getOrCreateNamedCalendar`,
  `subscribeCalendarForLink`, `listCalendarsForLink`, `updateGoogleAttendeeRsvp`.
  `ensureCalendarVisible` (in `member-class.server.ts`) pulls a written-to
  calendar into the display set.
- **Grid** (`WeekGrid.tsx`): drag-to-select creates; the committed *selection*
  block supports resize/move drag — but **existing events don't**. The event
  detail popover (`CalendarEventDetailPopover`) is **read-only**. There is **no
  all-day row**. Month view is chip-based (`MonthGrid.tsx`).
- **OAuth scope** is the full `https://www.googleapis.com/auth/calendar`
  (read + write) — confirmed in `oauth.calendar.google.start.ts`. No re-consent
  needed.

---

## Phase 0 — Foundation: read all events + event identity

Everything downstream needs this; it's the biggest single prerequisite.

- **A display-events read.** Add `fetchCalendarEvents` (or a mode on the existing
  fetch) that returns **all** events — all-day, free/transparent, tentative, and
  declined (rendered muted) — NOT just busy. Keep `fetchBusyEvents` as-is for
  availability/scheduling (two reads; they can share the underlying
  `events.list` call as a perf follow-up).
- **Event identity + capability on every event:** `id`, `calendarId`, `linkId`,
  `allDay`, `recurringEventId` (+ `originalStartTime` for instances), `colorId`,
  and **`writable`**. Derive `writable` per-calendar from the `calendarList`
  entry's `accessRole` (`owner`/`writer` → writable; `reader`/`freeBusyReader` →
  read-only). Outlook-sourced events are always `writable:false` this milestone.
- **DTO:** extend `LoaderData.externalEvents` with the fields above.
- **All-day rendering (net-new):** an all-day band above the time grid in
  week/day views, with multi-day spans. Month view already stacks chips.
- **Deliverable:** the grid shows everything a Google client shows (all-day
  included), and every event knows whether it can be edited — but no write yet.

## Phase 1 — Create (event composer)

- **`EventComposer`** replaces the "New block" popover for events: title,
  calendar (destination selector), start/end, **all-day** toggle, description,
  location, **recurrence** (reuse `RepeatField`). Attendees: v1 optional/basic.
- **Destination selector** (generalize the classes one): **In-app** (a
  `ManualBlock`, the no-Google fallback) **+ each linked Google calendar**
  (primary + writable sub-calendars). No "dedicated" option (that's classes).
  Default = last-used, remembered in a **`dali_event_dest` cookie** (loader reads
  it to preselect; updated on submit). Default to the first writable Google
  calendar when connected, else In-app.
- **Drag-create** prefills start/end and opens the composer.
- **Write:** `createGoogleCalendarEvent` (+ `ensureCalendarVisible`); recurrence
  → RRULE. In-app → `ManualBlock` (unchanged path).
- **Timesheet:** keep the "Add to timesheet" toggle → a `TimeEntry` (Manual
  source with a time range for Google-destination events; Block-sourced for
  in-app). This finally answers "what are manual blocks for" — they become the
  in-app fallback, Google is the default.
- **Deliverable:** it *feels* like a calendar — you make real events from DALI.

## Phase 2 — Update

- **Click a writable event → EventComposer prefilled (edit mode)** →
  `events.patch`.
- **Drag move / resize existing writable events** on the grid → `events.patch`
  (extend the selection move/resize drag to operate on event blocks; gate on
  `writable`).
- Read-only events show no edit affordance; **invite-only** events keep RSVP
  (existing `updateGoogleAttendeeRsvp` / notification RSVP).
- **Single (non-recurring) events first.**

## Phase 3 — Delete

- Delete from the composer / event popover → `events.delete`. Single events
  first. Confirm before deleting.

## Phase 3.5 — Recurring-series semantics (the hard part — isolate it)

- On edit/delete of a **recurring** instance, prompt **"This event / This and
  following / All events"** (Google Calendar's model):
  - *This event* → patch/delete the **instance** id (creates an exception).
  - *All events* → patch/delete the **master** (`recurringEventId`).
  - *This and following* → Google has no native op: set `UNTIL` on the master
    just before this instance, then create a **new series** from this instance
    with the edited fields. Emulated; edge-case heavy.
- Everything before this phase treats recurring instances as read-only-ish
  (RSVP + "open in Google") so we never half-support them.

## Phase 4 — Calendar management (CRUD of linked calendars)

- Manage calendars (in Settings, extending `CalendarSettingsBlock`, and/or a
  calendars manager): **create, rename, recolor, delete**; subscribe/unsubscribe;
  which feed availability (exists) + the **default write calendar**.
- New helpers: `patchCalendar` (summary/color via `calendarList`/`calendars`
  patch), `deleteCalendar`.

---

## Cross-cutting

- **Permissions:** every edit/delete/drag gates on `writable` (per-calendar
  accessRole). Never render a write affordance on a read-only or Outlook event.
- **Timezone & all-day:** all-day = date-only, no tz; timed events keep the
  existing zoned handling. Multi-day spans in week/day.
- **Consistency:** last-write-wins for v1; refetch (revalidate) after each write;
  optimistic UI where cheap. Surface Google API errors clearly.
- **Flag:** `calendar-google-crud` (ships off), independent of `calendar-unified`
  / `calendar-classes`.
- **Outlook:** read-only — hide all edit affordances for Outlook-sourced events;
  a banner/tooltip explains write isn't supported yet.
- **Safety:** the calendar becomes write-capable — guard against accidental
  edits (confirm destructive ops; consider an undo toast on move/resize/delete).

## Touch points

- `app/lib/google-calendar.ts` — `fetchCalendarEvents` (all events + id +
  writable + recurrence), `patchCalendar`/`deleteCalendar`, recurrence-scope
  handling on patch/delete.
- `app/calendar/lib/types.ts` — extend `externalEvents` DTO; `EventComposer` types.
- `app/calendar/components/WeekGrid.tsx` — all-day row; drag move/resize on
  existing events; edit affordances in the detail popover.
- `app/calendar/routes/calendar.tsx` — `EventComposer`; loader (display events +
  writable + cookie default); action (`event-create` / `event-update` /
  `event-delete` intents, recurrence scope).
- `app/components/settings/CalendarSettingsBlock.tsx` — calendar management CRUD.

## Suggested PR sequence

- **PR A** — Phase 0 (read-all + all-day row + event identity/writable). No write.
- **PR B** — Phase 1 (composer + create; cookie default; timesheet).
- **PR C** — Phase 2 (edit via composer + drag move/resize).
- **PR D** — Phase 3 + 3.5 (delete + recurring-series).
- **PR E** — Phase 4 (calendar management CRUD).

Each is independently shippable behind the flag; the calendar starts feeling
like a Google client at PR B.

## Risks / open questions

- **Recurring-series editing** is the dominant complexity and schedule risk.
- **All-day / multi-day** rendering is net-new UI with its own edge cases.
- **Two reads** (busy + display) — acceptable at first; de-dupe the `events.list`
  call as a perf pass.
- **Attendees / invites** in the composer — how far to go in v1 (create with
  guests → Google sends invites)? Proposed: defer rich attendee management past
  PR B.
- **Google rate limits / quota** under heavier write traffic — monitor.
