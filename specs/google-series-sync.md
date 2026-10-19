# Google ↔ DALI meeting sync

Status: plan, not built. Prompted by the Domain Leads duplicate on Oct 19, 2026.

## 1. What went wrong (Domain Leads)

| | Stephanie's meeting `cmu5tijvi…` | Sophie's meeting `cmuueevyq…` |
|---|---|---|
| Origin | Created in DALI, pushed to Google | Tracked from Google on Oct 5 |
| `externalEventId` | `6b1uc1q7…` | `6b1uc1q7…_R20260928T130000` |
| `iCalUID` | `6b1uc1q7…@google.com` | `6b1uc1q7…_R20260928T130000@google.com` |
| DALI rule | weekly to Nov 21 (stale) | none |

1. Someone edited the Sep 28 occurrence in Google with "this and following". Google ended the original series at Sep 21 and started a new series with id `<base>_R20260928T130000` and a new iCalUID.
2. DALI never reads changes back from Google, so Stephanie's meeting still repeats to Nov 21.
3. The grid draws meetings only from fetched Google events. The new series matched no meeting (different id, different iCalUID), so it showed as a plain Google event with "Track in DALI". Sophie tracked it on Oct 5.
4. DB-driven surfaces (meeting page, reminders, record prompts, upcoming lists) still expand Stephanie's stale rule. The grid shows Sophie's. Each week now has two meetings. On Oct 19 the 8:59 note, check-ins and recording landed on Stephanie's; the 9:03 grid click landed on Sophie's.

The split is one case of a general gap: **DALI pushes to Google but never pulls.** Today:

| Change made in Google | Grid | DALI row and DB surfaces |
|---|---|---|
| Series time change | New time | Stale `selectedAt` / rule. `resolveOccurrence` snaps within ±40 days |
| One instance moved | New time, right occurrence | No `MeetingException`, reminders use the old time |
| Instance or series deleted | Gone | Still `Confirmed`, reminders keep firing |
| "This and following" split | New series looks untracked | Rule never truncated, duplicate on track |
| Drag-move on the DALI grid (`event-move`) | New time | Patches Google directly, no exception written. Same drift, DALI's own doing |

Two more hazards found along the way:

- **Cancelling a tracked meeting deletes the Google event.** `cancelScheduledMeeting` deletes whenever `externalEventId && organizerCalendarLinkId`, and tracked rows set both. Cancelling Sophie's copy would delete the live Domain Leads series from Google and send cancel notices. Nothing on the row says whether DALI created the event or only tracked it.
- **Tracked rows don't store `organizerCalendarId`**, so a delete aimed at a non-primary calendar hits primary.

## 2. Goals

1. One Google event (any copy, any split) maps to one DALI meeting lineage. Tracking can never mint a second.
2. Edits made in Google reach the DALI row before they matter: on the next calendar open, and always before a reminder or record prompt is sent. Covers time, duration, title, instance moves, cancels and splits.
3. DALI never deletes or rewrites a Google event it didn't create.
4. Fix the existing duplicates (Domain Leads, plus any others the audit finds).

Not goals: two-way sync of guests, descriptions, rooms. DALI stays the editor for those on DALI-created meetings.

## 3. Design

### 3.1 Identity: series lineage

A Google split id is `<base>_R<YYYYMMDDTHHMMSS>`, and its iCalUID is `<baseUID>_R<stamp>@google.com`. A shared helper `googleSeriesBase(id)` strips the suffix.

- `matchMeetingForEvent` keeps exact matches first (iCalUID, event id, master id), then falls back to the base id / base UID. A fallback hit means a split DALI hasn't adopted yet. It hands the event to the reconciler (3.3) instead of rendering it as untracked.
- `trackExternalEventAsMeeting` checks for an existing meeting by event id, iCalUID (#2244), and the base forms of both. If the base matches an existing lineage, it adopts the split (3.3) and returns that meeting. It never creates a sibling.
- `meetingsForExternalEvents` access filter: key on iCalUID too, not only `externalEventId` (today an iCalUID-only match is dropped for lab-wide viewers).

**How a split is modelled: a continuation row, the same as DALI's own "following" edit.** `updateScheduledMeeting` scope "following" already truncates the old row, creates a new `ScheduledMeeting` with the same notebook, and moves the split occurrence's note. Adopting a Google split reuses that path, with one difference: it binds to the existing `_R` event instead of pushing a new one. Add `ScheduledMeeting.continuesFromId` (nullable self-relation) so the lineage is explicit and the meeting page can say "Continued from the series before Sep 28".

Rejected: one row holding several Google ids. Every per-occurrence reader (notes, attendance, recordings, time entries) assumes one rule per row. That change is much larger than one nullable column.

### 3.2 Ownership: created vs tracked

New field `ScheduledMeeting.googleEventOrigin: Created | Tracked`, nullable, null for rows with no Google event.

- `createScheduledMeeting` sets `Created`, `trackExternalEventAsMeeting` sets `Tracked`, and split adoption copies from the parent.
- Tracking also stores `organizerCalendarId = input.calendarId`.
- `cancelScheduledMeeting` and `updateScheduledMeeting` only write to Google when the origin is `Created`. For a `Tracked` meeting, cancel becomes **Stop tracking**: it marks the row Cancelled, writes nothing to Google, and sends no notices (Google owns the invite).
- Backfill: the audit log for `track-event-as-meeting`, if it has one (open question 5). Otherwise, rows whose `externalEventId` was never returned by `createGoogleCalendarEvent`, which we can't know. Fallback: a row is `Tracked` unless `organizerCalendarLink.externalEmail` equals the Google event's organizer email, checked once by a script against `getGoogleEvent`.

### 3.3 Inbound reconcile

**No sync job.** The calendar loader already fetches Google on every open, so reconcile rides on that read. A check right before sending covers the surfaces that act on stale data. Rejected: a polling job with sync tokens (new state table, a job to babysit) and `events.watch` push (public webhook, channel renewal per calendar). Revisit only if drift shows up on surfaces that don't send anything (Home list, MCP), and those catch up the next time anyone opens the calendar anyway.

One shared function, `reconcileMeetingFromGoogle(meeting, events)`, with two callers:

1. **Calendar open (reconcile on read).** After `meetingsForExternalEvents` matches events to meetings, pass each meeting's fetched instances to the reconciler. Run it fire-and-forget after the response so it doesn't slow the page, the same way the iCalUID heal does now. A fallback match on an unadopted split (3.1) adopts it here, so the duplicate block never renders as untracked.
2. **Check before sending.** `meeting-reminders` and `meeting-record-prompts` already go through meetings one at a time. Before sending for an occurrence of a meeting with an `externalEventId`, look up that instance in Google (one `events.get` on `<master>_<originalStartZ>`, or `events.instances` with a one-occurrence window), reconcile, then send only if the occurrence still exists at that time. If Google errors (link revoked, 5xx), send on DALI's data as today, so a Google outage never silences reminders.

**Rules, per Google event that maps to a meeting:**

| Seen in Google | DALI write | From calendar open? | From check-before-send? |
|---|---|---|---|
| Occurrence at a different time than DALI expands (`originalStartTime` ≠ start) | Upsert `MeetingException { originalStart, overrideStart, overrideDurationMin }` | yes | yes |
| Every occurrence in the window shifted the same way | Update `selectedAt`, `durationMinutes`, `recurrenceRule` (3.4), not N exceptions | yes | no (one occurrence can't tell a series change from a one-off) |
| `<base>_R*` series present for a meeting's base | Truncate the parent rule to before the split, adopt the `_R` series as a continuation (3.1) | yes | yes |
| Occurrence or series cancelled | Upsert `MeetingException { cancelled: true }`, or Cancelled for the series | **no** | yes, only when `events.get` returns `status: "cancelled"` or 404/410 for that exact id |
| Title changed | Update `title` | yes | yes |

**A missing event never cancels anything.** `fetchCalendarEvents` skips cancelled events, so on calendar open "not in the list" can mean deleted, outside the window, or not on this viewer's calendars. Deletes are applied only by a direct lookup that says cancelled or gone.

Writes DALI makes to Google show up on the next read, so the reconciler sees its own changes coming back. Every write is skip-if-equal, and reconcile sends no notifications, so that's harmless. Two viewers opening the calendar at once can both try the same write. Exceptions are upserts on `(scheduledMeetingId, originalStart)`, and split adoption takes a guard (a conditional update on the parent's rule, so only the first adopter proceeds).

Who can trigger a write: any viewer whose fetch matched the meeting. Times come from Google, not the client, so that grants no authority beyond what the viewer can already see.

DALI-side fix in the same phase: `event-move` on a meeting-backed event goes through `updateScheduledMeeting` scope "this", so a drag writes the exception like the composer does.

### 3.4 Occurrence keys when the time changes

Notes, attendance, recordings and time entries key on `originalStart`. If a series moves from 9:00 to 10:00, the old keys would orphan.

- A series-wide time change from Google is treated like DALI's "all" edit: future keys move with the new rule. Past occurrences (end < now) keep their keys, because they already happened at the old time.
- Check whether `updateScheduledMeeting` "all" re-keys future notes today. If it does, the reconciler calls the same helper. If it doesn't, that's a pre-existing bug, and this spec fixes both.

### 3.5 UX

Small, because sync should be invisible when it works.

- **Meeting page, under the time:** when the last change came from Google, a muted line: "Updated from Google Calendar · 2h ago". Tooltip: "Someone changed this event in Google Calendar. DALI picked up the change."
- **Continuation:** the meeting page header shows "Continues the series that ended Sep 21" as a link to the parent. The parent shows "Continued from Sep 28" linking forward. Both stay in one notebook, so the notebook tabs read as one run.
- **Tracked meetings:** the cancel action reads **Stop tracking**. Confirm dialog (`useConfirmSubmit`): "Stop tracking this meeting in DALI? The Google event stays on everyone's calendar. Notes and attendance stay in Drive." Button: "Stop tracking".
- **Track in DALI:** never offered on an event that resolves to a lineage (it adopts instead), so the button just doesn't appear.
- **Organizer notice:** when a check before sending finds a series deleted in Google and cancels it, the DALI organizer gets an in-app notification (new `notification-events.ts` entry `meeting.cancelled-in-google`, in-app only by default). "Domain Leads Meeting was deleted in Google Calendar, so DALI cancelled it too."

### 3.6 Fixing existing duplicates

A script, `scripts/merge-split-series.ts`, dry run by default, with the planner in `app/lib/split-series-fold.ts`. One transaction per (parent, split) pair under `--commit`.

1. Find live rows whose `externalEventId` carries an `_R` suffix. The parent is the live row whose `externalEventId` equals the base id (or whose iCalUID equals the base UID). A split with no parent is reported and left alone. Several splits can share a parent; the oldest is folded first.
2. **Fold.** When every key the split holds data at (notes including archived, attendance, recordings, time entries) is an occurrence `originalStart` of the parent's rule, the split is FOLDED into the parent. Its data moves onto the parent at the same key, the participant lists are unioned, and the split row is Cancelled with no Google calls and no notifications. The calendar already resolves those events to the parent through the base-id fallback. A note moves unless the parent already has a live note at that key; that one is detached (never deleted or archived) and reported. Archived notes are detached on both sides, since the unique index on the note key includes archived pages. Attendance keeps the parent's row and takes the split's presence. A clashing time entry stays on the split and is reported. The parent adopts the split's notebook if it has none, and moved notes are refiled into the parent's notebook.
3. **Continuation.** A split that changed times, so some key is not on the parent's rule, is reported as "times differ, needs continuation" and skipped for now. It needs a continuation row: truncate the parent's rule before the split, set `continuesFromId`, and move the data held at or after the split onto the continuation. The script does not do that yet.

**Domain Leads under this script:** the Sep 28 split row holds the Oct 5 and Oct 12 notes, attendance and recording, all on the parent's Monday 9:00 ET rule. It folds into the parent, which keeps Oct 19. The split row is Cancelled and the notebook Domain Leads 26F becomes the parent's.

## 4. Phases

| PR | Contents | Risk |
|---|---|---|
| **A** (extend #2244) | iCalUID dedup (done), `_R` base matching in match and track, `googleEventOrigin` + tracked-cancel = Stop tracking, `organizerCalendarId` on track, `event-move` → exception | Low. Migration adds two nullable columns. Stops new duplicates and the delete hazard |
| **B** | Merge script: folds a split whose occurrences all land on the parent's rule, reports and skips one that changed times (continuation later). Run on prod after a reviewed dry run | Data move. Run after A deploys |
| **C** | `reconcileMeetingFromGoogle`, wired into the calendar loader (fire-and-forget) and into `meeting-reminders` / `meeting-record-prompts` before sending. Split adoption on read, continuation UI, occurrence re-key. Behind a feature flag `google-reconcile` so it can be turned off without a deploy | Medium. Flag on for staging first |
| **D** | Organizer notice, "Updated from Google" line | Low |

Deploy order: A → B → C (flag on staging, then prod) → D.

## 5. Open questions

1. **Continuation organizer.** When adopting a split, who is the DALI organizer: the parent's organizer (proposed), or whoever's link sees the `_R` event?
2. **Google-side delete.** Auto-cancel in DALI (proposed), or flag it for the organizer to confirm?
3. **Past-occurrence re-keying.** Keep past keys fixed on a series time change (proposed)?
4. **Check-before-send cost.** One Google call per reminder or prompt send. Fine at our volume. If it ever isn't, cache per occurrence for the tick.
5. **Backfilling origin.** Does the audit log record `track-event-as-meeting`? If not, is the organizer-email heuristic acceptable?
6. **Other Google edits.** Pull guest changes on tracked meetings into the roster? Proposed: not now.
