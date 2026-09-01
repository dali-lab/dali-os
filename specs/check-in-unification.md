# Self check-in — unify the shared primitives

Status: draft (2026-08-31). Owner: TBD.
Depends on: `meeting-attendance-per-occurrence.md` (extracts the meeting-side
window primitive; this spec repoints education at it and adds the missing
education QR-PDF). Land per-occurrence first.

## Problem

There are two self-check-in implementations, built at different times, that
share a shape ("instructor/organizer projects a QR; the signed-in scanner marks
*themselves* present") but duplicate their plumbing and have **drifted**:

| | Meetings | Education sessions |
|---|---|---|
| Mark path | `markMeetingAttendance` → `MeetingAttendance` + `TimeEntry` | `saveAttendance` → `EducationAttendance` (+ CE credit) |
| Eligibility | meeting participant | `Approved` enrollment |
| Window | `isWithinCheckInWindow` (`app/lib/scheduled-meeting.ts:358`) | `isSessionCheckInOpen` (`app/education/lib/session-checkin.server.ts:32`) |
| Open trigger | none (pure time window) | manual — instructor sets `checkInOpenAt` |
| QR (inline SVG) | `calendar.meeting.$id.tsx:82`, `calendar.check-in.$id.tsx:57`, `documents.$pageId.tsx:284` | `education.manage.$offeringId.tsx:127` |
| QR (printable PDF) | `renderCheckInQrPdf` + `api.scheduled-meetings.$id.check-in-qr.pdf.ts` | **none** |
| Wallet-pass scan | `AttendeeScanner` + `scan-attendee` route | n/a |

Two concrete duplications/drifts:

1. **Window math is defined twice, differently.**
   - Meeting: a *pure time* window, symmetric `CHECK_IN_GRACE_MIN` (=15) minutes
     before `selectedAt` and after `selectedAt + durationMinutes`. Always
     computable; no human toggle.
   - Education: *instructor-gated* — open iff `checkInOpenAt != null` **and**
     `now <= (endsAt ?? datetime + 3h) + 30min`. No before-bound (the instructor
     opening it *is* the start signal); auto-closes so a forgotten-open session
     doesn't stay open forever.

   The grace constants (15 vs 30 min) and the very *shape* of the window differ.
   Some of that is intentional (see below); none of it is coordinated.

2. **QR rendering is copy-pasted 4×.** Four inline
   `QRCode.toString(url, { type: "svg", margin: 1, width: 180|200 })` call sites,
   plus one PDF helper that only meetings have. Education instructors can only
   show the QR on-screen, not print/hand out a sheet.

## Decisions (locked)

- The **domains stay separate**. `EducationAttendance` (+ CE credits, session
  feedback) is not merged into `MeetingAttendance`/`TimeEntry`. The mark paths,
  eligibility checks, and the open-trigger policy are *deliberately* different
  and stay per-domain.
- What is genuinely shared — **QR rendering** and **window arithmetic** — gets
  extracted to one definition each. Divergence that remains (grace lengths,
  open-trigger) becomes an explicit parameter, not an accident of two codebases.
- Education gets **QR-PDF parity** with meetings (the user asked to fold QR into
  scope).
- **Wallet-pass scan stays meeting-only** — education has no wallet pass; not in
  scope.

## Changes

### 1. Shared QR rendering

New `app/lib/check-in-qr.ts` (server-safe; `qrcode` is already a dep):

- `renderCheckInQrSvg(url: string, opts?: { width?: number }): Promise<string>`
  — the one definition of the inline SVG. Replace all four call sites
  (`calendar.meeting.$id`, `calendar.check-in.$id`, `documents.$pageId`,
  `education.manage.$offeringId`). Default `width` 180; education passes 200 if
  we want to keep its slightly larger code, else standardize on one.
- Generalize the existing `renderCheckInQrPdf` (`app/calendar/lib/check-in-qr-pdf.server.ts`):
  rename the `meetingTitle` field to a neutral `title` (the layout copy —
  "DALI LAB / Self check-in / <title>" — is already generic). Move it next to
  `renderCheckInQrSvg` or leave in place and import from both domains.
- Add an education QR-PDF route mirroring
  `api.scheduled-meetings.$id.check-in-qr.pdf.ts`
  (e.g. `education.manage.$offeringId.sessions.$sessionId.check-in-qr.pdf.ts`),
  gated by `isOfferingManager`, passing the session title. Add a "Print QR"
  affordance next to the existing on-screen QR in `education.manage`.

### 2. Shared window arithmetic (single definition, parameterized)

Introduce (in `meeting-attendance-per-occurrence.md`'s extraction, consumed
here):

```ts
checkInWindow(opts: {
  start: Date;
  end: Date;
  graceBeforeMin: number;   // Infinity ⇒ no lower bound
  graceAfterMin: number;
}): { open: boolean; opensAt: Date | null; closesAt: Date };
```

- **Meeting** (`isWithinCheckInWindow`) becomes:
  `checkInWindow({ start: occurrence, end: occurrence + duration, graceBeforeMin: 15, graceAfterMin: 15 }).open`
  (occurrence resolved per `meeting-attendance-per-occurrence.md`; today it's the
  series `selectedAt`).
- **Education** (`isSessionCheckInOpen`) keeps its instructor gate on top and
  delegates only the *close* math:
  `checkInOpenAt != null && checkInWindow({ start: datetime, end: endsAt ?? datetime+3h, graceBeforeMin: Infinity, graceAfterMin: 30 }).open`.
  `graceBeforeMin: Infinity` preserves "no too-early bound" — the manual open
  toggle is the start signal.

This gives one arithmetic definition while keeping the two *policies*
(unattended time-window vs instructor-opened) explicit and adjacent, so future
changes to one don't silently diverge from the other. Add a doc comment on
`checkInWindow` naming both callers.

## Explicitly NOT unified

- Mark paths (`markMeetingAttendance` vs `saveAttendance`), because they write
  different tables with different side effects (TimeEntry/payroll vs
  EducationAttendance/CE credit/feedback).
- Eligibility predicates (meeting participant vs Approved enrollment).
- The open-trigger policy (meetings unattended, education instructor-opened).
- Wallet-pass scan (meeting-only).

## Sequencing

1. `meeting-attendance-per-occurrence.md` lands, creating `checkInWindow` +
   `renderCheckInQrSvg` as part of rewriting meeting check-in per occurrence.
2. This spec: repoint education's window at `checkInWindow`, replace the four
   inline QR sites with `renderCheckInQrSvg`, generalize `renderCheckInQrPdf`,
   and add the education QR-PDF route + button.

## Test focus

- `checkInWindow`: meeting symmetric ±15; education `Infinity` before + 30 after;
  `open=false` before instructor opens even inside the time window.
- The four SVG sites render identical markup after extraction (snapshot).
- Education QR-PDF route: manager-gated, returns a PDF, 403 for non-managers.
- No behavior change to wallet-pass scan or either mark path.
