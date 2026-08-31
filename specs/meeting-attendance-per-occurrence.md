# Meeting attendance & hours — per-occurrence

Status: draft (2026-08-30). Owner: TBD. Depends on: nothing. Enables:
`check-in-unification.md` (extracts the shared check-in primitive from here).

## Problem

`ScheduledMeeting` is one row per *series*. Both dependent tables are keyed
with **no occurrence dimension**:

- `MeetingAttendance` — unique `(scheduledMeetingId, userId)`.
- `TimeEntry` (source `Meeting`) — unique `(scheduledMeetingId, userId)`.

Occurrences are only expanded at read time (`app/lib/meeting-occurrences.ts`
`expandOccurrences`), consumed solely by `list_my_upcoming_meetings` and the
reminders job. Attendance and hours never expand. Consequences for a recurring
meeting:

1. One attendance checkbox per person for the whole series — cannot record
   "present wk 1, absent wk 2".
2. One `TimeEntry` per person, dated at the first occurrence — a 10-week weekly
   meeting logs one occurrence's hours; **payroll under-counts ~10×**.
3. `MeetingException` (per-occurrence cancel/retime) never touches attendance.

Two further correctness bugs, independent of recurrence:

4. **TimeEntry writer collision.** Three writers hit the same
   `(scheduledMeetingId, userId)` row: `markMeetingAttendance`
   (`app/lib/scheduled-meeting.ts`), and `add-time-entry` +
   `toggle-meeting-time-entry` (`app/calendar/routes/calendar.server.ts`).
   Unchecking attendance `deleteMany`s the row **even if the member manually
   attributed a role / edited hours**; re-checking **overwrites edited hours**.
5. **No role attribution.** The attendance path writes only `projectId`, never
   `assignmentType`/`roleRefId`, so meeting hours land in payroll's
   "unassigned" bucket.

## Decisions (locked)

- Attendance **and** hours are **per-occurrence**.
- **One running note doc per series** (minutes as a living doc); notes are not
  per-occurrence.
- Role attribution: **auto-attribute the unambiguous case, otherwise surface
  "needs a role"** (never silently unassigned).
- `MeetingException` cancel/retime *writes* are **out of scope** (follow-up);
  attendance keys off computed occurrences regardless.

## Schema

Add an occurrence key to both tables (mirrors the existing
`MeetingReminderLog` shape `(scheduledMeetingId, occurrenceStart, userId)`):

```prisma
model MeetingAttendance {
  // …
  occurrenceStart DateTime
  @@unique([scheduledMeetingId, occurrenceStart, userId])   // was (scheduledMeetingId, userId)
  @@index([userId])
}

model TimeEntry {
  // …
  occurrenceStart DateTime?   // set for source == Meeting
  @@unique([scheduledMeetingId, occurrenceStart, userId])   // was (scheduledMeetingId, userId)
}
```

**Backfill migration:** `occurrenceStart = selectedAt` for every existing row.
Correct for one-offs (`occurrenceStart == selectedAt` always). Recurring
meetings' single existing row maps to the first occurrence — acceptable, since
series-level was never meaningful. Data-losing? No (additive column + key
change); flag the unique-key rewrite in the PR.

## Occurrence resolution

New helper alongside `expandOccurrences`:

- `resolveOccurrenceAt(meeting, at): DateTime | null` — the occurrence whose
  check-in window (see `check-in-unification.md`) contains `at`. Used by
  self-check-in and scan.
- `nearestOccurrence(meeting, now): DateTime` — most recent past / in-progress
  occurrence. Roster check-off default.

Non-recurring meeting → the single `selectedAt`.

## Row lifecycle

No pre-fan-out (a series can be open-ended). Rows are created **lazily** for an
occurrence:

- **Roster:** the checklist for occurrence *O* lists all series participants
  (`participantUserIds` + organizer); toggling a person upserts
  `(meeting, O, user)`.
- **Self-check-in / scan:** upsert `(meeting, resolvedOccurrence, user)`.

## TimeEntry coupling — single-owner model (fixes bug 4 & 5)

Principle: **attendance `present` owns row existence; the timesheet owns
role/hours edits; neither clobbers the other.**

`markMeetingAttendance(meeting, occurrenceStart, userId, present, actor)`:

- **present → upsert** keyed `(meeting, occurrenceStart, user)`:
  - `create`: `source=Meeting`, `date`/`startTime`/`endTime`/`hours` derived
    from the occurrence, role resolved (below).
  - `update`: **ensure existence only** — do **not** overwrite `hours`, `date`,
    or role (preserves user edits across a re-check).
- **absent → delete** the Meeting-sourced row for that occurrence. (Not
  present ⇒ no hours; if a member wants the hours they stay marked present.)

Remove the parallel writers now that attribution happens by editing the
attendance-owned row via the existing `update-time-entry` (which already
requires a real role):

- Delete `toggle-meeting-time-entry` (`calendar.server.ts`).
- Delete the `scheduledMeetingId` branch of `add-time-entry`
  (`calendar.server.ts:1224-1240`) — meeting rows come only from attendance.

### Role attribution ("who and when")

`occurrenceStart` pins the term, so the role set is well-defined:
`getUserRoleInstances(userId, termForDate(occurrenceStart))`
(`app/lib/roles.ts`).

- If the meeting is Project-scoped and the user has **exactly one**
  `ProjectAssignment` on `meeting.projectId` that term → auto-attribute
  (`assignmentType=Project`, that `roleRefId`).
- Otherwise leave `assignmentType`/`roleRefId` null **and flag the row**: the
  timesheet shows it as "needs a role" (the picker already exists). No silent
  unassigned bucket.

## UI

- Roster checklist (`AttendanceChecklist`, shown on the note page and
  `calendar.meeting.$id`): add an **occurrence selector** (default
  `nearestOccurrence`, switch among recent occurrences). Marking allowed for
  current + recent-past occurrences, not far-future.
- Self-check-in / scan panels: operate on the current-window occurrence (no UI
  change beyond wording).

## Shared check-in primitive (extracted here, consumed by education)

While rewriting meeting check-in, extract:

- `checkInWindow({ start, end, graceBeforeMin, graceAfterMin }): { open: boolean; opensAt; closesAt }`
  — replaces the inline `isWithinCheckInWindow` (`scheduled-meeting.ts`).
- `renderCheckInQrSvg(url)` — replaces the inline `QRCode.toString(svg)` calls
  in `calendar.check-in.$id.tsx` and `documents.$pageId.tsx`. Reuse existing
  `renderCheckInQrPdf` (`app/calendar/lib/check-in-qr-pdf.server.ts`).

See `check-in-unification.md` for pointing education at these.

## Out of scope / follow-ups

- Writing `MeetingException` (cancel/retime a single occurrence).
- Any change to the note-doc model (stays one-per-series).

## Test focus

- Recurring meeting: attendance + hours accrue per occurrence; totals across
  10 weeks correct.
- Uncheck does not delete a user-edited/role-attributed row's edits… (verify
  new single-owner semantics: absent deletes, but re-check→edit→re-check
  preserves edits).
- Backfill: existing one-off rows unchanged (`occurrenceStart == selectedAt`).
- Role auto-attribution only in the single-assignment case; else null + flagged.
