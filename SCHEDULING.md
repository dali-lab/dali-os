# Interview Scheduling

This document explains how interview scheduling works end-to-end in `dali-os` — from how available slots are computed to how an applicant books, reschedules, or cancels an interview, and what happens when an interviewer declines. It covers the data model, the algorithm, the concurrency model, and the HTTP contract the (to-be-built) applicant portal should use.

All code lives in `dali-api`. Internal scheduling logic is in `app/lib/scheduling.ts`. The HTTP layer lives in `app/routes/api.*`. The data model is defined in `prisma/schema.prisma`.

## Data model

```
ApplicationCycle ─┬─ InterviewConfig (1)                          ← slot shape + window
                  │
                  ├─ CycleInterviewer (N)   ← per (member, cycle, domain)
                  │     ├─ InterviewerAvailability (N)            ← when this row is free
                  │     └─ InterviewAssignment (N)                ← which interviews this row is on
                  │
                  └─ Interview (N)          ← one per DomainApplication (1:1)
                        └─ InterviewAssignment (2)                ← always InDomain + CrossDomain
                              └─ InterviewNoteVersion (N)         ← append-only notes per interviewer
```

### `InterviewConfig` — shape of a valid slot

One per cycle. Set by the hiring lead before the cycle opens interviews.

- `slotDurationMinutes` — length of each interview (default 30)
- `bufferMinutes` — gap enforced before and after a booked interval when checking conflicts (default 15)
- `dayStartHour`, `dayEndHour` — the daily hours during which interviews may be scheduled (local time in `timezone`)
- `interviewStartDate`, `interviewEndDate` — the window inside which slots can be booked
- `timezone` — IANA zone string (e.g. `"America/New_York"`)

### `CycleInterviewer` — a member's eligibility to interview for a domain

One row per `(daliMemberId, applicationCycleId, domainId)` triple. A member who serves Eng and Design in the same cycle has two rows, with their own `availabilityBlocks` and `interviewAssignments`.

The `AssignmentRole` enum distinguishes in-domain (the interviewer's `domainId` is the applicant's domain) from cross-domain (the interviewer's `domainId` is not the applicant's domain). Every `Interview` gets exactly one interviewer of each role.

### `InterviewerAvailability` — time the interviewer has offered

Per-row blocks with `startTime` and `endTime`. The current UI treats them as a single union, but writes hit one row per submit (see the "multi-domain" note at the end of this document).

### `Interview`

At most one active (`Scheduled`) `Interview` per `DomainApplication` at any time — enforced by a partial unique index on `(domainApplicationId) WHERE status = 'Scheduled'`. Historical `Cancelled` / `Completed` rows accumulate alongside the active row as an audit trail.

Every non-terminal `Interview` always has **exactly two `Active` `InterviewAssignment` rows** (one `InDomain`, one `CrossDomain`). This invariant is guaranteed by `assignInterviewers` (creates both in a single nested write) and `reassignInterviewer` (atomic swap or throw — never produces a half-staffed interview).

Stores:

- `startTime` / `endTime`
- `status` — `Scheduled`, `Completed`, `CancelledByApplicant`, `CancelledByAdmin`
- `recommendation` / `recommendationNotes` — filled in jointly by the two interviewers at the end
- `assignments` — exactly two `InterviewAssignment` rows in the normal flow

### `InterviewAssignment`

Links an `Interview` to a `CycleInterviewer`. Carries:

- `role` — `InDomain` or `CrossDomain`
- `status` — `Active`, `Declined`, or `Replaced`
- `noteVersions` — append-only, one per auto-save of the interviewer's notes

## Computing available slots

Entry point: `computeAvailableSlots(cycleId, applicantDomainIds)` in `app/lib/scheduling.ts`.

The algorithm answers: "For an applicant applying to these domains, which future time windows have at least one free in-domain interviewer AND one free cross-domain interviewer, respecting the cycle's interview config?"

1. **Load the interview config** for the cycle. Abort if none.
2. **Load every `CycleInterviewer` in the cycle** along with their `availabilityBlocks` and all `Active` `interviewAssignments` (including the linked `Interview` for start/end times).
3. **Build per-row free-check data**: each row becomes an `InterviewerFreeCheck` with:
   - `cycleInterviewerId`
   - `domainId`
   - `availability[]` — flat list of the row's availability blocks
   - `bookedIntervals[]` — each active assignment's interview expanded by `± bufferMinutes` on each side
4. **Generate candidate slot start times** via `generateCandidateSlots`:
   - Walk every day from `interviewStartDate` to `interviewEndDate`, inclusive.
   - Skip Saturdays and Sundays (hardcoded — if you ever need weekend interviews this is the spot to change).
   - For each weekday, walk from `dayStartHour` to `dayEndHour` in 15-minute steps.
   - A candidate is included only if the slot (start + `slotDurationMinutes`) finishes on or before `dayEndHour` and strictly after the current wall-clock time (no scheduling in the past).
   - Timezone math uses `Intl.DateTimeFormat` to translate between the cycle's local timezone and UTC; times are stored in UTC.
5. **For each candidate slot**, check whether there exists *any* interviewer row that (a) has `domainId ∈ applicantDomainIds` and is free at this slot (**in-domain slot**), AND *any* other row that (b) has `domainId ∉ applicantDomainIds` and is free at this slot (**cross-domain slot**). Both conditions must hold for the slot to be surfaced.
6. **Return** the surviving `{startTime, endTime}` list. The identities of the interviewers are not exposed to the applicant.

`isInterviewerFree(check, slotStart, slotEnd)` is the pure predicate that combines the two requirements:

- At least one `availability` block must fully contain the slot (`block.start <= slotStart && block.end >= slotEnd`).
- No `bookedIntervals` entry may overlap the slot (`b.start < slotEnd && b.end > slotStart`).

## Booking an interview

Entry point: `assignInterviewers(cycleId, domainApplicationId, applicantDomainIds, slotStart, slotEnd)` in `app/lib/scheduling.ts`.

This runs inside a single **serializable Postgres transaction**. The sequence inside the transaction is:

1. **Lock** every `CycleInterviewer` row for the cycle using a raw `SELECT … FOR UPDATE` on the cycleInterviewer table. This makes the booking operation mutually exclusive across concurrent bookings, so the availability snapshot read below can't change underneath us.
2. **Re-read** all interviewers with their availability blocks and current active assignments (same shape as step 2 of `computeAvailableSlots`).
3. **Build `checks[]`** with the same `InterviewerFreeCheck` structure, plus an `activeCount` equal to the number of active assignments on the row — used as a tiebreaker.
4. **Pick the in-domain interviewer**:
   - Filter `checks` to rows where `domainId ∈ applicantDomainIds` AND `isInterviewerFree(r, slotStart, slotEnd)`.
   - Sort by `activeCount` ascending.
   - If the filtered list is empty, throw `"No in-domain interviewer available for this slot"`. The HTTP layer maps this to `409 Conflict`.
   - Take the top candidate.
5. **Pick the cross-domain interviewer**:
   - Filter `checks` to rows where `domainId ∉ applicantDomainIds` AND `isInterviewerFree(r, slotStart, slotEnd)`.
   - Sort by `activeCount` ascending.
   - If empty, throw `"No cross-domain interviewer available for this slot"` → 409.
   - Take the top candidate.
6. **Create the `Interview`** with `startTime`, `endTime`, `status: "Scheduled"`, and `assignments: { create: [ { inDomain… }, { crossDomain… } ] }` in a single Prisma nested write. Each assignment is `status: "Active"`.
7. **Return** the interview with its two assignments included. The HTTP layer serialises it as JSON.

If any step throws, the transaction rolls back and the caller sees an error — no partial state is ever committed. Concurrency expectations:

- Two applicants trying to book overlapping slots race on the `FOR UPDATE` lock. Whichever commits first wins; the second sees the winner's assignments when it re-reads inside the transaction and fails step 4 or 5 with a 409 the applicant can retry.
- The serializable isolation level means even phantoms (a new `InterviewAssignment` row arriving mid-check) are caught — Postgres will abort and retry via Prisma's standard error path if necessary.

## Reassigning an interviewer who can't make it

Entry point: `reassignInterviewer(interviewId, decliningAssignmentId)` in `app/lib/scheduling.ts`. Called from:

- The interviewer's "Mark Unavailable" button on the interview detail page (`app/routes/api.cycles.$cycleId.my-interviews.$interviewId.decline.ts`).
- A hiring lead's manual reassignment route (`app/routes/api.interviews.$id.reassign.ts`).

The operation is **atomic**: it either finds a replacement and commits the swap in one transaction, or it throws `"No replacement interviewer available"` and the transaction rolls back — leaving the original assignment as `Active` and the interview fully staffed. The calling endpoint translates the throw into a `409 Conflict` response, and the UI shows a toast.

The sequence (inside a single Prisma transaction):

1. **Load the declining assignment** with its interview and the domain application's challenge version so we can read the applicant's domain.
2. **Identify what role the replacement needs to satisfy** — `InDomain` or `CrossDomain`.
3. **Exclude any member (not just row) who already holds an active assignment on this interview**, so we don't pick a different CycleInterviewer row for the same human.
4. **Build the candidate pool and aggregations** — same member-level `bookedIntervals` + `activeCount` pattern as `assignInterviewers`.
5. **Filter** candidates to the correct role, free at the interview's slot, sorted by member-level load ascending.
6. **If at least one free candidate exists**: mark the declining assignment `Declined`, create a new `Active` assignment for the replacement. Commit. Return `{ reassigned: true, newInterviewerId }`.
7. **If no candidate exists**: throw. The transaction rolls back; the declining assignment was never marked `Declined`; the interview stays `Scheduled` with both original assignments `Active`. The UI shows "No replacement interviewer is available for this slot. Please contact the hiring lead."

The applicant never needs to rebook — the slot is preserved regardless of outcome.

## Cancellation and rescheduling

**Cancellation.** `POST /api/my-interview/cancel` finds the applicant's most recent active interview (`status = Scheduled`) and sets its `status` to `CancelledByApplicant`. The `InterviewAssignment` rows are left alone — they remain as historical records pointing at a cancelled parent. The cancelled row stays in the database as an audit record; the scheduler's nested `interview.status` filter excludes it from `bookedIntervals`, so the slot is freed for other applicants on their next `computeAvailableSlots` call.

**Rescheduling.** `POST /api/my-interview/reschedule` is an atomic "cancel + rebook" wrapped in a single serializable transaction:

1. Look up the applicant's current active interview.
2. Mark the old interview as `CancelledByApplicant`.
3. Call `assignInterviewers` (passing the outer transaction) with the new start/end to create a brand-new Interview + assignments.
4. If `assignInterviewers` throws (no free interviewers at the new time), the entire transaction rolls back — the old interview stays `Scheduled` and nothing changes. The caller returns a `409 Conflict`.

Because both the cancel and the rebook happen inside the same serializable transaction, there is no sub-second window where the applicant has no interview.

## Applicant portal HTTP contract

All endpoints below live on `dali-api` (port 3001). All require a `__dali_at` auth cookie via `requireAuth`. Responses are JSON. The portal is expected to send `credentials: "include"`.

### `GET /api/cycles/:cycleId/available-slots?domainId=…[&domainId=…]`

**Auth:** any authenticated user. (The route deliberately doesn't leak interviewer identities, so it's safe to call without being the applicant — though in practice the portal only calls it for its own user.)

**Query params:** one or more `domainId` parameters — the applicant's domain(s) for this cycle. For an applicant applying to a single domain, pass one. For an applicant applying to multiple domains simultaneously (a shared interview slot), pass all of them.

**Returns:** `200 OK` with a JSON array of `{ startTime: string, endTime: string }` where both are ISO-8601 UTC strings. Sorted ascending by `startTime` (the underlying algorithm emits them in candidate-generation order, which is chronological).

**Errors:** `400` if `domainId` is missing.

**Calls internally:** `computeAvailableSlots(cycleId, applicantDomainIds)`.

**What the portal should do:** call this on page load and after any cancellation/reschedule. The list is the full set of bookable slots — there's no pagination. Display them in the applicant's local timezone (the backend returns UTC). There's no need to poll live; a manual refresh after the applicant clicks "Book" is sufficient since booking returns a 409 on a stale slot.

### `POST /api/domain-applications/:id/schedule-interview`

**Auth:** the authenticated user must own the domain application (`domainApplication.application.userId === auth.user.sub`). Enforced by the endpoint.

**Body:** `{ startTime: string }` — ISO-8601. The backend computes `endTime` from `config.slotDurationMinutes`.

**Returns:** `201 Created` with the full `Interview` record (including the two `InterviewAssignment` rows).

**Errors:**
- `404` if the domain application doesn't exist.
- `403` if the authenticated user isn't the applicant.
- `409` if the domain application already has an interview (`interview != null`), or if `assignInterviewers` couldn't find a free in-domain or cross-domain interviewer for the requested slot.
- `400` if no `InterviewConfig` exists for the cycle or `startTime` is missing.

**Calls internally:** `assignInterviewers(cycleId, domainApplicationId, [applicantDomainId], slotStart, slotEnd)`.

**What the portal should do:** call this with a slot `startTime` picked from the `available-slots` response. On 409, re-fetch `available-slots` and re-display — the slot was taken concurrently. On 201, navigate the applicant to a confirmation view showing the booked time. Do not show the assigned interviewer identities to the applicant (the spec says these are hidden until the interview happens).

### `GET /api/my-interview`

**Auth:** required.

**Returns:** the applicant's most recent active interview (`status = Scheduled`) with its `Active` assignments, ordered by `startTime` desc. Returns `null` if the applicant has no active interview.

**What the portal should do:** call this to determine whether to show the "Book an interview" button or the "Your scheduled interview" card. A `null` response with a Released `InvitedToInterview` decision on the applicant's domain application means "you're invited but haven't booked yet".

### `POST /api/my-interview/cancel`

**Auth:** required.

**Body:** empty.

**Returns:** `200` with the updated interview (`status: "CancelledByApplicant"`).

**Errors:** `404` if the applicant has no active interview.

**What the portal should do:** call this when the applicant clicks a "Cancel interview" button with a confirmation dialog. On success, refresh `my-interview` (will return `null`) and offer the applicant the option to rebook by sending them back to the `available-slots` picker.

### `POST /api/my-interview/reschedule`

**Auth:** required.

**Body:** `{ newStart: string, newEnd: string }` — both ISO-8601. The portal should compute `newEnd` from `newStart + slotDurationMinutes`, or read `slotDurationMinutes` from a server-side config endpoint (none currently exists — see "Open questions" below).

**Returns:** `201` with the newly-created interview. The old interview is silently cancelled.

**Errors:** `400` if either field is missing. `404` if there's no active interview. `409` if `assignInterviewers` couldn't find a free interviewer pair at the new slot (the old interview is restored on rollback).

**What the portal should do:** offer this as an alternative to Cancel-then-Book, so the applicant never sees a "you have no interview" state. Show the picker with `available-slots` pre-filtered to exclude the current slot. On 409, keep the old interview and flag the error.

### Open questions for the portal

- **Slot duration**: there's no public endpoint that exposes the cycle's `slotDurationMinutes` today. The portal either needs a read endpoint (`GET /api/cycles/:id/interview-config` exists but is lead-only) or has to compute `newEnd` from the server round-trip rather than client-side. A small `GET /api/cycles/:id/slot-duration` public endpoint would unblock this — probably worth adding before portal work starts.
- **Applicant's domain list**: the portal needs to know which domains the applicant is applying to in order to call `available-slots`. Today you'd fetch the applicant's `Application` via `/api/my-application` (if it exists) and read its `domainApplications[].challengeVersion.domainId`. Verify this is live before relying on it.
- **Interview detail visibility**: the spec says the applicant should NOT see who their interviewers are until the interview starts. The `schedule-interview` response and the `my-interview` GET both include interviewer info — the portal must strip it client-side, or we add server-side stripping when the authenticated user is an applicant rather than a lead. Worth deciding before building the portal.

## Concurrency summary

| Operation | Isolation | Lock scope | What can fail |
|---|---|---|---|
| `computeAvailableSlots` | default (read-committed) | none | nothing — may show slightly stale availability, which is rechecked on book |
| `assignInterviewers` | serializable | `SELECT … FOR UPDATE` on every `CycleInterviewer` in the cycle | 409 if no free interviewer; automatic retry by Postgres on serialization conflict |
| `reassignInterviewer` | serializable (via caller) | none explicit | throws `"No replacement interviewer available"` if no candidate; commits atomic swap otherwise |
| `cancel` | single update | none | 404 if no active interview |
| `reschedule` | serializable (single outer transaction) | `FOR UPDATE` inside `assignInterviewers` | throws on `assignInterviewers` failure; entire transaction (cancel + rebook) rolls back atomically |

## Known limitations

1. **Weekends are hardcoded out.** `generateCandidateSlots` skips `dayOfWeek === 0 || 6`. If a cycle ever needs weekend interviews, this has to become a config flag.
2. **`dayStartHour` / `dayEndHour` are integer hours.** Half-hour day boundaries (e.g. "interviews 9:30 to 17:30") are not expressible without schema changes.
3. **No notification of slot availability changes.** If an applicant sees slot X is free and someone else books it, the first applicant learns about it only on their next page load (or the 409 when they try to book). There's no push or live update.
4. **Interviewer identity is leaked to applicants** by `schedule-interview` and `my-interview`. The portal must either strip this client-side or the backend must filter it. Not currently filtered.
5. **An interviewer who declines when no replacement is available** must contact the hiring lead out-of-band (the "Mark Unavailable" button fails with a toast). A future enhancement could preflight-check whether a decline can succeed and grey out the button ahead of time; today it just fails on click.
6. **The partial unique index** `Interview_activeDomainApplication_key` is created by the seed (`prisma/seed.ts`) rather than by a Prisma migration (Prisma doesn't model partial unique indexes). It must be manually created or re-created whenever the database is rebuilt outside the seed flow.

## Where to look in the code

| Concern | File |
|---|---|
| Algorithm | `dali-api/app/lib/scheduling.ts` |
| Config model | `dali-api/prisma/schema.prisma` (`InterviewConfig`) |
| Interviewer model | `dali-api/prisma/schema.prisma` (`CycleInterviewer`, `InterviewerAvailability`) |
| Interview / assignment model | `dali-api/prisma/schema.prisma` (`Interview`, `InterviewAssignment`, `InterviewNoteVersion`) |
| Available slots endpoint | `dali-api/app/routes/api.cycles.$cycleId.available-slots.ts` |
| Book endpoint | `dali-api/app/routes/api.domain-applications.$id.schedule-interview.ts` |
| My-interview GET | `dali-api/app/routes/api.my-interview.ts` |
| Cancel | `dali-api/app/routes/api.my-interview.cancel.ts` |
| Reschedule | `dali-api/app/routes/api.my-interview.reschedule.ts` |
| Decline (interviewer side) | `dali-api/app/routes/api.cycles.$cycleId.my-interviews.$interviewId.decline.ts` |
| Tests | `dali-api/app/lib/__tests__/scheduling.test.ts` |
| Spec reference | `CYCLE_REDESIGN_SPEC.md` §Interview Flow |
