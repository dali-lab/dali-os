# Education instructor UX improvements

Status: **spec** (2026-08-24). Owner: Kiran. Source: instructor UI/UX review of the
LMS (`dali-api/app/education/`).

This bundles seven improvements to the instructor-facing education experience.
They are largely independent; PR A (date derivation) is the only ordering
constraint because the clone date-shift builds on it.

## Decisions locked
- Start **and** end date (and the offering's term) derive from the sessions —
  not manual fields. Rationale: all sessions are entered before publishing, so
  the sessions are the real source of truth for when a course runs.
- Assignment points / grades stay **informational** — they do not gate course
  completion. Completion remains attendance-driven.
- The per-offering Drive folder is **auto-created** (rename/relocate optional).
- Clone shifts session date/times by a chosen offset (prompt for a new first
  session date; shift all sessions + registration window by the delta).

---

## 1. Derive start/end/term from sessions (foundational — PR A)

Today `EducationOffering.startsAt`/`endsAt` are manual `datetime-local` fields
typed at creation and never reconciled with the sessions added later. That stale
estimate drives real behavior: the catalog Past/Upcoming split
(`education.tsx:51` — `endsAt < now`), the certificate date range
(`certificate-pdf.server.ts:62`), and every card. A slipped last session flips a
still-running course to "Past."

Change:
- `startsAt`/`endsAt` become **derived cache columns** (keep them — ~15 read
  sites already read them). Make both **nullable** (a draft with no sessions has
  no dates). `termId` is already nullable.
- New helper `recomputeOfferingDates(tx, offeringId)`: sets
  `startsAt = min(session.datetime)`, `endsAt = max(session.datetime)`,
  `termId = termIdForDate(min)`. Call after every session mutation:
  `create-session`, `update-session`, `delete-session`,
  `generate-weekly-series`, and duplicate.
- Remove the Start/End inputs from `OfferingFields` (create + edit). Registration
  opens/closes stay manual. Drop the `startsAt ≤ endsAt` check in `validateDates`.
- Term assignment moves off create into `recomputeOfferingDates`. Editing sessions
  can now re-file an offering into a different term (intended).
- **Publish gate:** block publish when the offering has zero sessions (extends
  today's "a miniseries needs a session" to workshops too). Guarantees
  *Published ⇒ dates non-null*, so the catalog never hits a null.
- **Backfill:** one-time script recomputes existing offerings' dates from their
  sessions.
- Null-guard the read sites that assume a non-null `Date`
  (`formatDateShort(offering.endsAt)` etc.). Draft-with-no-sessions is the only
  null path.

Schema: `startsAt`/`endsAt` → nullable. No data loss.

## 2. Clone / duplicate (PR B)

The `duplicate-offering` server action already exists
(`offerings.server.ts:480`): it copies core fields + sessions + instructors + a
fresh application form as a Draft (Core-only), and the manage route already
redirects to the clone (`education.manage.$offeringId.tsx:420`). It is simply
**not surfaced in the UI**.

Change:
- Add a **Duplicate** button (Core-only) in the Details tab near Publish/Archive.
- **Date-shift:** the duplicate modal asks for a new first-session date; server
  computes `delta = newFirst − oldFirst` and shifts every session `datetime`
  plus `registrationOpensAt`/`registrationClosesAt` by `delta`, preserving
  spacing. `recomputeOfferingDates` then sets start/end/term from the shifted
  sessions — a clone is never born in the past.
- Uploaded **file blobs** are not copied on clone (S3 duplication); note it,
  addable later. Pages/folders copy as today.

## 3. Configurable completion threshold (PR C)

Replace the hardcoded `MINISERIES_THRESHOLD = 0.8` (`certificates.server.ts:15`).
- Schema: `EducationOffering.completionThreshold Float @default(0.8)`.
- UI: "Completion threshold (%)" in Details, default 80, **Miniseries only**
  (Workshop rule stays "≥1 Present").
- Wire into `certificateEligibility`, `previewCloseOut`, and the performance-view
  eligibility preview.

## 4. Optional assignment point values (PR D, informational)

- Schema: `EducationAssignment.points Int?` (null = complete/incomplete, current
  behavior). `EducationSubmission.score Int?`.
- UI: "Points (optional)" in the add/edit assignment form. In grading, when
  `points` is set show a numeric score input (0–points) alongside the free-form
  grade; else free-form only. Student sees "Grade · 18/20" when scored.
- No completion effect.

## 5. Consolidated performance view (PR D, informational)

- Fold into the Roster tab as a toggle: **Attendance** (today's matrix) |
  **Performance**.
- Performance = students × [attendance % · each assignment's score/grade ·
  certificate-eligibility preview against the threshold]. Reads existing
  attendance + submissions. **No schema change.**

## 6 + 7. Per-offering Drive folder + file import + session linking (PR E)

### Architecture found
- Each offering is already a Drive scope (`{ kind: "EducationOffering",
  offeringId }`) rendered under the **Education space** (`drive-spaces.ts` —
  `backing: "workspace-multi"`; the space is not a single physical folder, each
  offering is its own workspace within it).
- **Offerings cannot own files today.** `loadDriveScope` for education loads
  *pages + forms only* — `drive.server.ts:914` "offerings don't own files."
  Uploaded files are `ProjectFile` rows hard-scoped to `projectId`
  (`loadFiles(projectIds)`). This is why materials are create-only.
- The auto-create-a-folder pattern exists: `ensureHiringDriveRoot` /
  `ensureCoreDriveRoot` (`pages.ts`) — a `Page kind:Folder` with a `systemKey`
  for idempotency + scope fields, re-homing unplaced artifacts on every call.

### Design
- **`ensureOfferingDriveFolder(offeringId)`** — mirrors `ensureHiringDriveRoot`
  one level down: a `Page kind:Folder`, `workspaceType:"EducationOffering"`,
  `workspaceId:offeringId`, `systemKey:"drive:offering:<id>"`, titled after the
  offering. Runs on offering create (+ backfill). Idempotent. Lives in the
  offering's workspace, which renders under the Education space. Rename/relocate
  is optional.
- **File storage for offerings:** add nullable `ProjectFile.offeringId` (exactly
  one of `projectId`/`offeringId` set); teach `loadFiles` an offering variant and
  include it in the EducationOffering branch of `loadDriveScope`. No table rename.
- **Import (#6):** "Upload file" in the Materials tab creates a `ProjectFile`
  homed under the offering root folder via the existing presign/version flow →
  opens at `/documents/file/:id`. Materials pages, shared docs, and the
  application form adopt `folderPageId` = the offering root.
- **Session linking (#7):** optional `sessionId` on material rows (mirrors
  assignments; works for pages and files). Student Materials view groups by
  session with an "All / general" bucket. *Alternative considered:* auto "Session
  N" subfolders under the offering root — elegant but collides with free-form
  folders; going explicit column.

Schema: `ProjectFile.offeringId String?` (+ constraint), material `sessionId
String?`, systemKey'd root folder (data, not schema). All additive.

---

## Schema & migration summary
All additive or nullability-relaxing → **no data-losing migration**.
- `EducationOffering`: `startsAt`/`endsAt` → nullable; add `completionThreshold
  Float @default(0.8)`
- `EducationAssignment`: add `points Int?`
- `EducationSubmission`: add `score Int?`
- `ProjectFile`: add `offeringId String?`
- material `sessionId String?`
- Backfill scripts: recompute offering dates from sessions; adopt existing
  material/form artifacts under the new offering root folders.
- Per CLAUDE.md: new migration file (never hand-edit), needs `DIRECT_URL`. Watch
  the worktree `prisma generate` gotcha; don't import `.server` files into
  component routes (leak guard).

## PR order
1. **PR A** — date derivation (foundational).
2. **PR B** — clone button + date-shift.
3. **PR C** — configurable threshold.
4. **PR D** — assignment points + performance view.
5. **PR E** — offering Drive folder + file import + session linking (biggest).

A is the only ordering constraint; B–E are otherwise independent.
