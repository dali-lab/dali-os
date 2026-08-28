# Calendar: unified Create-Event modal + timesheet/blocks rework

Status: **planned** (2026-08-28). Branch: `feat/calendar-create-modal` (worktree off `staging`).

This reshapes the **unified calendar** (`calendar-unified`, currently flag-off) into its
final form before rollout. Because the unified screen and Google event CRUD
(`calendar-google-crud`) are both still behind off-by-default flags, we can restructure the
create flow and remove in-app blocks with low risk — the legacy three-tab calendar remains
the production fallback until we cut over.

## Goals

1. Replace the two separate create flows (personal **Event** popover + **Meeting** scheduling
   overlay) with **one centered `CreateEventModal`**.
2. Remove the explicit event/meeting split: **no guests → Event, guests/group → Meeting.**
3. Collapse the when2meet **availability matrix** into the modal (left panel).
4. Collapse the **timesheet** ("count this as work") into the modal, decoupled from blocks.
5. New optional **DALI Timesheet Google calendar** per user (Postgres stays authoritative).
6. **Remove DALI blocks** (`ManualBlock`) entirely.
7. Consolidate the **four overlapping calendar-config surfaces** into one in-page panel.

## Decisions (settled with Kiran, 2026-08-28)

| Topic | Decision |
|---|---|
| Timesheet storage | **Postgres `TimeEntry` is the source of truth.** Optional one-way mirror to Google. |
| Google timesheet sync | **Opt-in, off by default.** When enabled, calendar is created on the user's **DALI** (`@dali.dartmouth.edu`) Google link; prompt to link it if missing. |
| Non-work manual blocks | **Silent delete.** Prod check: 26 non-work blocks across 3 users, **all one-off and all past-dated** (0 future) → nothing to migrate, no user notice needed. |
| Config home | **One in-page "Calendars" panel.** Settings→Calendar becomes a pointer. |

## Current state (as-built)

Everything lives under `dali-api/app/calendar/`.

- **`components/composer.tsx` → `EventComposer`** — anchored popover, personal events.
  Destination = a Google calendar **or** in-app `LOCAL_DEST` (a `ManualBlock`). Already
  carries the "Add to timesheet" toggle + role + note, but **only** on the in-app-block
  destination (`isLocal`).
- **`components/scheduling.tsx` → `MeetingComposer` + `ScheduleWeekGrid`** — full split
  screen; `ScheduleWeekGrid` is the when2meet heatmap fed by
  `/api/calendar/group-availability`. Guest/group picker (`ParticipantPicker`), optional
  "Create meeting note."
- **`routes/calendar.server.ts`** — loader + action handlers (`event-create/-update/-delete/
  -move`, `add/update/remove-manual-block`, `add/update-time-entry`, class + working-hours
  intents). `crudEnabled = isFeatureEnabled("calendar-google-crud")` gates Google writes.
- **`lib/layers.ts`** — builds grid layers: `buildBlocksLayer`, `buildExternalLayer`,
  `buildMeetingsLayer`, `buildClassesLayer`, `buildLoggedTimeLayer`, plus
  `buildLoggedSourceIndex` (de-dups logged time against its source block/meeting).
- **`lib/availability.ts`** — `computeUserFreeBusy` = working hours ∩ (Google busy ∪ manual
  blocks). Manual blocks are an availability constraint.

Data models (`prisma/schema.prisma`):
- `ScheduledMeeting` (meetings; `scopeType`, `participantUserIds`, `notePage`, `meetingType`,
  `attendance`, `organizerCalendarLinkId`, `externalEventId`).
- `ManualBlock` (in-app blocks; `isWork` + `assignmentType`/`roleRefId`/`workNote` mirror into
  a Block-sourced `TimeEntry`).
- `TimeEntry` (`source: Meeting | Manual | Block`; `assignmentType`/`roleRefId`/`projectId`,
  `date`, `hours`, optional `startTime`/`endTime`).
- `UserCalendarLink` (`provider`, `externalEmail`, encrypted `oauthTokens`, `subCalendarIds`),
  `MemberClass`, `WorkingHoursDay`, `UserAvailabilitySettings`.

Google plumbing (`lib/google-calendar.ts`) is complete: `createGoogleCalendarEvent`,
`patchGoogleCalendarEvent`, `deleteGoogleCalendarEvent`, `getOrCreateNamedCalendar`,
`createCalendar`, `subscribeCalendarForLink`, `getValidAccessTokenForLink`. **OAuth scope is
the full `https://www.googleapis.com/auth/calendar`** → creating a secondary "DALI Timesheet"
calendar needs **no re-consent**. Classes already use this exact pattern
(`lib/member-class.server.ts`: `materialize` → `getOrCreateNamedCalendar` + recurring events;
`tearDownGoogle`), with Postgres (`MemberClass`) authoritative and Google as a mirror — this
is the precedent the timesheet mirror copies.

## Target design

### 1. `CreateEventModal` (Phase 1)

One centered modal (replaces the anchored `EventComposer` popover **and** the full-screen
scheduling overlay). Layout mirrors the mockup:

- **Left panel:** week mini-grid + availability heatmap. Empty state "Add guests to see their
  availability"; once guests exist it renders `ScheduleWeekGrid` for the resolved participant
  set (reuse `/api/calendar/group-availability`). Prev/next week nav.
- **Right panel:** Title, **Guests** ("Add guests or a group" — reuse `ParticipantPicker`),
  Duration, Date, Start, End, **Timesheet** toggle ("Count this as work") + **Role** picker,
  **Create meeting notes** button, Location, (Description, Repeat as today).
- **Type chip** top-left auto-flips **Event ⇄ Meeting** on guest presence:
  - **0 guests → Event.** Submits `event-create` → writes a Google event to the chosen
    calendar (the destination picker keeps its Google options; the `LOCAL_DEST` in-app option
    is removed). If the user has no writable Google link, show the existing "Connect a Google
    Calendar" empty state.
  - **≥1 guest/group → Meeting.** Submits to `/api/scheduled-meetings` → `createScheduledMeeting`
    exactly as today (invites, availability, optional notes, attendance).
- Timesheet + role are available for **both** event and meeting (not gated on destination).

No schema change in this phase. Keep `ManualBlock` alive but stop creating new ones from the
create flow (drop `LOCAL_DEST`). Gate the modal behind `calendar-unified`.

### 2. Timesheet decoupled from blocks (Phase 2)

- Drop `TimeEntrySource.Block`. "Count this as work" creates a standalone **`TimeEntry`
  (`source: Manual`)** with `startTime`/`endTime` + `assignmentType`/`roleRefId` + `note`,
  independent of where the calendar item lives (Google event or meeting). This is a
  create-time snapshot; the `TimeEntry` is the payroll record (`/api/timesheets/export` /
  JobX already read `TimeEntry`).
- Migration: convert existing **Block-sourced** `TimeEntry` rows → `Manual` (keep
  time/role/note, null out `manualBlockId`, drop the `@@unique([manualBlockId, userId])`).
- `lib/time-entry-sync.ts` Block path is removed; the logged-time layer
  (`buildLoggedTimeLayer`) already renders `Manual` entries by `startTime`/`endTime`.
- Collapse the standalone Timesheet tab UI into the modal + the logged-time layer.

### 3. DALI Timesheet Google calendar (Phase 3)

- New user setting **"Mirror my timesheet to Google"** (default **off**), surfaced in the
  consolidated Calendars panel.
- When on: lazily `getOrCreateNamedCalendar(daliLinkId, "DALI Timesheet")` against the user's
  **DALI** `UserCalendarLink`. If no DALI link exists, the toggle prompts the user to link
  their `@dali.dartmouth.edu` Google account first (reuse the OAuth start flow, `loginHint =
  user.daliEmail`).
- One-way mirror: on work-`TimeEntry` create/update/delete, `createGoogleCalendarEvent` /
  `patchGoogleCalendarEvent` / `deleteGoogleCalendarEvent` against that calendar. Store the
  resulting `googleEventId` (+ `googleCalendarLinkId`) on `TimeEntry` for sync/delete. Best-
  effort: Google failures never block the Postgres write (mirror the classes error handling).
- Postgres remains authoritative for payroll; the Google calendar is a portable read view of
  "my paid hours," subscribed via `ensureCalendarVisible` so it shows in the external layer.

### 4. Remove `ManualBlock` (Phase 4 — with the unified cutover)

The legacy three-tab calendar still reads `ManualBlock` (Availability tab) and the Timesheet
tab, so full deletion is **coupled to retiring the legacy calendar** and flipping
`calendar-unified` on. Steps:

- Migration: delete all `ManualBlock` rows (26 past non-work blocks; work-block `TimeEntry`
  rows already migrated to `Manual` in Phase 2). Drop the `ManualBlock` model + relation.
- Remove: `buildBlocksLayer` + the "blocks" layer toggle; `add/update/remove-manual-block`
  actions; `availability.ts` manual-block expansion (availability = working hours ∩ Google
  busy); MCP `manage_manual_block` / `list_my_manual_blocks` (+ faceted router); `LOCAL_DEST`
  and all `isLocal` timesheet plumbing in the composer; `time-entry-sync.ts`.
- Retire `LegacyCalendarTabs` and the three-tab routes.

### 5. Consolidate config into one Calendars panel (Phase 5)

Four overlapping surfaces today:
1. **Settings→Calendar** (`components/settings/CalendarSettingsBlock.tsx`) — connect Google
   accounts; per-sub-calendar "block availability" toggles → `UserCalendarLink.subCalendarIds`.
2. **Calendars dropdown** (`CalendarLayerList` in `routes/calendar.tsx`) — layer visibility +
   hidden calendars → `localStorage` (`dali:calendar:layers`, `dali:calendar:hiddenCals`).
3. **Manage Calendars modal** (`CalendarManagerModal` in `composer.tsx`) — Google
   create/rename/delete.
4. **Classes modal + working-hours editor**.

Target: **one in-page "Calendars" panel** owning connected accounts, per-calendar
visibility + "counts toward availability" + color + rename/delete, working hours, classes, and
the timesheet-sync toggle. Reduce Settings→Calendar to a pointer ("Manage your calendars from
the Calendar page"). Reconcile the two visibility concepts: **show-on-grid** (was localStorage
`hiddenCals`) vs **counts-toward-availability** (was `subCalendarIds`) become two explicit
per-calendar toggles in one row.

## Phase order & flags

1. **Phase 1** — `CreateEventModal`, no schema change, behind `calendar-unified`.
2. **Phase 2** — timesheet decoupling + `Block`-source migration (schema change).
3. **Phase 3** — DALI Timesheet Google mirror (schema: `googleEventId`/`googleCalendarLinkId`
   on `TimeEntry`; a per-user opt-in flag on `UserAvailabilitySettings` or a new column).
4. **Phase 4** — delete `ManualBlock` + retire legacy calendar, as part of flipping
   `calendar-unified` on (data-losing migration — flag in PR per `MIGRATIONS.md`).
5. **Phase 5** — consolidate config surfaces.

Schema-touching phases (2–4) get flagged for review before migrations run.

## Risks / notes

- **Data-losing migrations** (Block→Manual conversion, `ManualBlock` drop) must be called out
  in the PR per repo migration rules; needs `DIRECT_URL`.
- **Legacy coupling:** `ManualBlock`/`TimeEntry` are read by the live legacy calendar — don't
  delete `ManualBlock` until the unified cutover.
- **No writable Google link:** an Event (Google write) and the timesheet mirror both require a
  linked writable Google calendar; handle the empty state (prompt to connect) rather than
  failing.
- **CRDT:** meeting-note creation stays on the existing collab path; no editor schema change.
