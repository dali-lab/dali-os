# Education MVP — what's built, what remains

This document tracks the state of the Education section after the initial PR
landed on the `worktree-education` branch. It corresponds to PRs 1–6 of the
implementation plan at `.claude/plans/elegant-napping-walrus.md`.

## TL;DR

A working mini-LMS: members and non-member Dartmouth students can browse
published Miniseries / Workshops, apply (or RSVP), and — once approved — see
sessions, materials, and announcements. Instructors and Core can create
offerings, manage sessions and application questions, review applications,
make decisions, and broadcast announcements. Capacity + FIFO waitlist
auto-promotion is in place. Past Approved education enrollments are surfaced
on the hiring reviewer view.

The Prisma schema for the LMS was already in place before this PR (no
migration work).

---

## What's built

### Server libs (`app/education/lib/`)

| Module | Purpose |
|---|---|
| `auth.ts` | `isInstructorOfOffering`, `canManageOffering`, `manageableOfferingIds` — offering-scoped permission checks. |
| `offerings-data.ts` | Offering CRUD + status transitions, session add/update/delete, application-question replace/duplicate, instructor add/remove. |
| `applications-data.ts` | Submission flow with auto-approve / waitlist routing for RSVP-style offerings; list helpers. |
| `promotion.server.ts` | `promoteFromWaitlist(offeringId)` — FIFO promotion when a seat opens up. |
| `notifications.ts` | In-app `Notification` write + Gmail email for decisions, waitlist promotion, and announcements. Uses the existing applications mailbox refresh token + `resolveCandidateEmail` for dev/staging redirects. |

### API routes (`app/education/routes/api.*`)

All wired under `/api/education/...`:

- `POST /api/education/offerings` — Core creates a Draft offering.
- `GET /api/education/offerings` — lists Published offerings.
- `PATCH/DELETE /api/education/offerings/:id` — edit / delete (Draft only).
- `POST /api/education/offerings/:id/publish` — Draft ↔ Published ↔ Archived. Publish guards: capacity ≥ 1, valid window, ≥1 session for Miniseries.
- `POST /api/education/offerings/:id/sessions` and `PATCH/DELETE /api/education/sessions/:id` — manage sessions.
- `POST /api/education/offerings/:id/questions` — replace question list, or duplicate from another offering via `{ duplicateFromOfferingId }` (the "template" path for MVP).
- `POST /api/education/offerings/:id/applications` — applicant submits; auto-decides for RSVP workshops, leaves Submitted for review-required.
- `POST /api/education/applications/:id/decision` — Approve / Reject / Waitlist / Withdraw. Single transition path. Applicant may self-Withdraw; managers can do anything. Triggers waitlist promotion on `Approved → Withdrawn/Rejected` and notifies the promoted applicant.
- `POST /api/education/offerings/:id/announcements` — instructor posts; fans out in-app + email to every Approved enrollee.
- `POST/DELETE /api/education/offerings/:id/instructors` — Core adds or removes instructors (needs term-scoped userId payload).

Audit log actions added: `education.offering.create/update/delete/status`, `education.session.create/update/delete`, `education.questions.replace/duplicate`, `education.application.submit/decision`, `education.announcement.create`, `education.instructor.add/remove`.

### UI

**Components** (`app/education/components/`):
`OfferingCard`, `OfferingDetail`, `ApplicationForm`, `ApplicationsTable`,
`OfferingBuilder` (Settings/Sessions/Questions/Publish tabs), `SessionList`,
`AnnouncementsFeed`. All built on existing primitives (`Button`, brand
colors, Tailwind utility classes).

**Member / Core / Instructor routes** (`app/education/routes/`):

| Path | Audience | What it does |
|---|---|---|
| `/education` | Members + Core/Instructor | Catalog + "You're enrolled in" rail. Links to /education/manage when applicable. |
| `/education/offerings/:id` | Members | Offering detail with capacity, schedule, instructor list, and RSVP/Apply CTA. |
| `/education/offerings/:id/apply` | Members | Renders dynamic questions; supports resubmission as long as the window is open. |
| `/education/enrolled/:id` | Approved applicants (and managers, marked as previewing) | Sessions, announcements, assignments. |
| `/education/manage` | Instructor / Core | Lists offerings the user can manage. |
| `/education/manage/new` | Core only | Create a Draft offering. |
| `/education/manage/:id` | Manager | Tabbed offering builder. |
| `/education/manage/:id/applications` | Manager | Review tab (Submitted / Approved / Waitlisted / Rejected) + post-announcement panel. |

**Applicant portal mirror** (`app/routes/portal.education*`):
`/portal/education`, `/portal/education/:id`, `/portal/education/:id/apply`,
`/portal/education/:id/enrolled` — same component set rendered inside the
lightweight applicant layout. Non-member Dartmouth students hit these via
the existing CAS-backed `/portal` auth flow.

### Sidebar / layout

- `Layout.tsx` Education area now has `Catalog` (everyone) and `Manage`
  (Core/Instructor) sub-items.
- `Layout` accepts a new `isInstructor` prop; `routes/layout.tsx` loader
  threads it from the existing `getUserRoles()`.

### Hiring profile linkage

`hiring/routes/applications.$domainApplicationId.tsx` now also loads any
Approved `EducationApplication` rows for the applicant and renders them as
"Past DALI Education" above the Interviews section on the reviewer view.

### Tests

`app/education/lib/__tests__/`
- `promotion.test.ts` — capacity full, no waitlisted applicant, FIFO
  promotion, missing offering.
- `applications-data.test.ts` — RSVP auto-approve, waitlist when full,
  review-required stays Submitted, closed window rejects, unpublished
  rejects, required-question enforcement.

All 10 unit tests pass (`npm test`).

`npx tsc --noEmit` is clean for every new file — pre-existing errors in
`scripts/` and missing optional deps (`pdfkit`, `react-markdown`,
`@dnd-kit/sortable` typings) are unchanged.

---

## Second slice (post-MVP follow-up, landed in this branch)

The MVP shipped without the LMS body parts (submissions, attendance, withdraw).
The second slice covers those plus a few polish items.

### Submissions

- `app/education/lib/assignments-data.ts` — assignment CRUD, submission upsert,
  per-student fetch, instructor list.
- API: `POST /api/education/offerings/:id/assignments`,
  `PATCH/DELETE /api/education/assignments/:id`,
  `POST /api/education/assignments/:id/submission`.
- Builder: instructor opens `/education/manage/:id/assignments` (linked from
  the offering page header) to create, list, delete assignments and inspect
  submissions at `/education/manage/assignments/:assignmentId`.
- Student: enrolled view assignment list links to
  `/education/enrolled/:offeringId/assignments/:assignmentId` (or the
  `/portal/education/...` equivalent), which renders the `SubmissionForm`.
  Files use the existing `/api/upload/presign` → S3 POST flow; text body
  is stored alongside attachments in the schema's `EducationSubmission.files`
  JSON column to avoid a schema change.

### Attendance

- `app/education/lib/attendance-data.ts` — list session roster (Approved
  applicants only), bulk upsert by `(applicationId, sessionId)`.
- API: `POST /api/education/sessions/:id/attendance` (manager-only).
- UI: per-session attendance roster at
  `/education/manage/sessions/:sessionId/attendance`, linked from the
  Sessions tab in the offering builder. Pill toggles for Present / Absent /
  Excused, batch save.

### Withdraw button + polish

- `app/education/components/WithdrawButton.tsx` — confirm-once self-withdraw
  on both the member and portal enrolled views. Hits the existing decision
  API (`status=Withdrawn`), so it also triggers waitlist auto-promotion.
- Confirmation modals: Withdraw and "Delete assignment / submission" now
  prompt first.

### Audit log additions

`education.assignment.create/update/delete`, `education.submission.submit`,
`education.attendance.update`.

---

## Third slice (this PR)

Closes the four follow-up items: discussions, grading/feedback, bulk
decisions, and reusable application templates.

### Schema migration

`prisma/migrations/20260619140000_education_discussions_and_templates` adds
four tables:

- `EducationDiscussionPost` — `offeringId`, `authorId`, `body`,
  `parentPostId` (null for top-level, set for replies; one level deep only),
  `isFromInstructor` denormalized at write time, `createdAt`, `editedAt`.
- `EducationDiscussionSubscription` — `(postId, userId)` unique;
  per-thread email opt-in. Author + repliers auto-subscribed; users can
  delete their own row to mute.
- `EducationApplicationTemplate` + `EducationApplicationTemplateQuestion` —
  reusable question sets. Cascade-deletes questions.

User back-relations added (`educationDiscussionPosts`, `educationDiscussionSubs`,
`educationApplicationTemplates`). `EducationOffering` gets `discussionPosts`.

### Discussions

- `app/education/lib/discussions-data.ts` — `listDiscussionThreads`,
  `createPost`, `setSubscribed`, `updatePostBody`, `deletePost`. Rejects
  replies-to-replies in the lib layer so the data shape stays predictable.
- `app/education/lib/discussions-notifications.ts` — implements the chosen
  policy:
  - Top-level **instructor** post → email every Approved enrollee + write
    in-app `Notification`.
  - Top-level **student** post → email instructors only; author is
    auto-subscribed.
  - **Reply** → email everyone subscribed to the parent + instructors.
  - In all cases, the author is stripped from the recipient list (no
    self-notify).
- APIs: `POST /api/education/offerings/:id/discussion` (new post, with
  optional `parentPostId` for replies), `PATCH/DELETE /api/education/discussion/:id`
  (author edits/deletes own; managers can delete any), `POST/DELETE
  /api/education/discussion/:id/subscription` (toggle mute).
- UI: `DiscussionThread` component embedded between Announcements and
  Assignments on both `/education/enrolled/:id` and
  `/portal/education/:id/enrolled`. Two-level rendering: top-level posts
  newest-first with replies oldest-first beneath. Instructor posts get a
  teal "Instructor" chip + tinted background. Inline reply input + per-post
  subscribe toggle + per-post edit/delete for the author.

### Grading + feedback

- `gradeSubmission` added to `assignments-data.ts`. Stashes feedback text
  in the existing `EducationSubmission.files` JSON column under a
  `feedback` key (`{ body, by, at }`) plus flips `gradedAt`. This avoids a
  schema change for the textual feedback while leaving room to migrate to
  `feedbackDocId` (CollabDocument) later.
- API: `POST /api/education/submissions/:id/grade` (`{ feedback, graded }`).
- UI: `GradePanel` inline under each submission row in
  `/education/manage/assignments/:assignmentId`. Student-side
  `SubmissionForm` now shows a teal "Instructor feedback · graded at" card
  above the resubmit form when feedback is present.

### Bulk decisions

- Refactored single-decision logic into `app/education/lib/decisions.ts`
  (`decideApplication`) so both the per-row API and the new bulk endpoint
  share the side-effect chain (waitlist promotion, applicant +
  promoted-applicant notifications).
- API: `POST /api/education/applications/decisions/bulk` (`{ ids[], status }`).
  Pre-checks `canManageOffering` for every distinct offering touched in the
  batch.
- UI: row checkboxes + select-all in the header on `ApplicationsTable`.
  Selection summons a sticky action bar with Approve / Waitlist / Reject
  buttons (confirm-once).

### Application templates

- `app/education/lib/templates-data.ts` — Core-only CRUD;
  `applyTemplateToOffering` replaces the offering's question list with the
  template's.
- APIs: `POST /api/education/templates`,
  `PATCH/DELETE /api/education/templates/:id`,
  `POST /api/education/offerings/:id/questions/from-template`.
- UI: `/education/manage/templates` lists templates with a create-new card;
  `/education/manage/templates/:id` is the editor (name, description,
  ordered questions, delete). Offering builder Questions tab now shows a
  template picker dropdown + Apply button when templates exist.
- Manage page header links to Templates for Core.

### Audit log additions

`education.submission.grade`, `education.discussion.post/edit/delete`,
`education.application.decision.bulk`,
`education.template.create/update/delete/apply`.

---

## Fourth slice (this PR)

Sweeps every item still in the deferred list except a small subset of pure
polish.

### Schema migration

`prisma/migrations/20260619160000_education_notification_kind_and_emails`:

- `NotificationKind` enum gains `Education`. Decision and discussion
  notifications now write with this kind so the bell can icon/route them
  distinctly.
- `OfferingDecisionEmail` table — `(offeringId, status) → emailTemplateVersionId`.
- `EducationApplication.waitlistRank Int?` — explicit waitlist ordering;
  promotion sorts by `(waitlistRank ASC NULLS LAST, submittedAt ASC)`.
- `EducationSession.durationMinutes Int @default(60)` and
  `EducationSession.calendarEventId String?` — calendar push needs both.

### Notification kind

- `lib/notifications.ts` + `discussions-notifications.ts` switched
  in-app rows from `General` → `Education`. `routes/home.tsx`
  `HomeNotification` type updated to include the new variant. Bell icon /
  CTA differentiation is left to a follow-up but the kind is now
  carryable everywhere.

### @-mention parsing

- `app/education/lib/mentions.ts` parses `@firstname` / `@firstname-lastname`
  against the offering's Approved roster + instructors. Unknown handles
  silently no-op.
- API: post creation now passes `forceRecipients: mentionedUserIds` into
  `notifyDiscussionPost` so mentioned users get notified even if they
  aren't already in the subscription set.
- UI: `DiscussionThread.MentionText` renders `@handle` segments in
  accent-coral for visual emphasis (regex match — no userId resolution
  needed for rendering).

### Filters + search

- `app/education/components/EducationFilters.tsx` + `matchesFilters` helper.
  Search query and filter dropdowns persist to URL search params
  (`?q=...&type=Workshop`) so filtered views are shareable.
- Wired on `/education` catalog (search + type filter) and
  `/education/manage` (search + type + status filter). Replaces the bare
  italic empty-state with a branded card; "no matches" branches when
  filters wipe out the list.

### Student attendance summary

- Both enrolled views (`/education/enrolled/:id` and the portal mirror)
  load `listMyAttendance` and render a compact `S1: Present`, `S2: Excused`
  chip rail under the session list. Green / yellow / red color coded.

### Waitlist reorder UI

- `app/education/components/WaitlistReorder.tsx` — up/down arrow rows with
  a dirty/save state.
- API: `POST /api/education/offerings/:id/waitlist/reorder` stamps
  `waitlistRank = (index+1) * 10` for each id in order.
- Surfaced when the review-applications page's tab is `Waitlisted`.

### Analytics events

- `lib/analytics.recordPageView` already fires for every authenticated UI
  navigation; education routes are normalized correctly and included in
  `TRACKED_PREFIXES`. No dedicated event helper is added — the existing
  AuditLog (with the new `education.*` actions added across the three
  slices) doubles as the event stream for product-analytics queries.

### Email template binding

- `OfferingDecisionEmail` table per migration above.
- `POST/DELETE /api/education/offerings/:id/decision-emails` binds /
  unbinds a `(status, emailTemplateVersionId)`.
- Builder gains an **Emails** tab that lists Approved / Waitlisted /
  Rejected with a per-status dropdown of `EmailTemplate` names. Templates
  are shared lab-wide with hiring — the builder links to
  `/hiring/emails` when no templates exist.
- `notifyApplicationStatus` checks for a binding first and renders via
  the shared `lib/email.renderEmail` interpolation (`{{firstName}}` and
  `{{domain}}=offering.title`); falls back to the inline strings when no
  binding is set.

### Calendar push

- `app/education/lib/calendar-push.pushSessionToCalendar(sessionId)`
  resolves the offering's `calendarEmail` to a `UserCalendarLink` and
  posts a single Google Calendar event via the existing
  `createGoogleCalendarEvent` helper. Stores the returned `eventId` on
  `EducationSession.calendarEventId` for future update / delete work.
- Fire-and-forget hook in the `/api/education/offerings/:id/sessions`
  POST handler. Failure is logged and swallowed so the API still succeeds
  if calendar pushing is misconfigured.
- v1 scope: no per-attendee invites, no update/delete propagation. Future
  work: PATCH route to update an event when sessions are edited, and a
  DELETE hook on session removal.

### Rich-text instructions via CollabDocument

- `POST /api/education/assignments/:id/instructions-doc` reserves a
  CollabDocument name (`edu:assignment:<id>`) and writes it to
  `EducationAssignment.instructionsDocId`. The actual document row is
  created lazily by Hocuspocus on first edit — no extra schema change
  needed.
- AssignmentBuilder shows either an `Instructions ↗` link or a
  `+ Instructions doc` button per assignment.

### Playwright E2E

- `e2e/education.spec.ts` — three smoke checks:
  - Core sees the catalog heading + Manage link.
  - Core can open `/education/manage` and click through to `/education/manage/new`.
  - Search input mutates `?q=` and surfaces the empty-state copy.

---

## Fifth slice (this PR)

DRY consolidation: lift @-mention infra out of education and reuse across
every plain-text comment/post surface in the app.

### Shared infrastructure

- **`app/lib/mentions.ts`** (pure, isomorphic) — `MENTION_RE`,
  `extractHandles`, `pickCandidate`, `resolveMentions`, `segmentBody`.
  No Prisma, no React; safe to import from anywhere.
- **`app/lib/mentions.server.ts`** — scope-specific roster loaders:
  `loadOfferingRoster(offeringId)`, `loadProjectRoster(projectId)`,
  `loadLabRoster()`. Each returns a `Candidate[]` matching the pure
  resolver's shape.
- **`app/components/MentionText.tsx`** — single render component used
  everywhere. Highlights `@handle` segments via `segmentBody`. Optional
  `resolved` prop swaps in canonical names; omit to fall back to raw
  regex highlight.

### Refactored consumers

- **Education discussions** — `app/education/lib/mentions.ts` is now a
  thin wrapper around the shared resolver; `DiscussionThread.tsx`'s
  inlined regex + `MentionText` component deleted in favor of the import.
- **Education announcements** — `AnnouncementsFeed.tsx` now renders body
  with `MentionText`; the announcements API resolves @-mentions and
  passes them to `notifyAnnouncement` via a new `extraRecipientUserIds`
  arg so mentioned users outside the enrolled list still get notified.

### New consumers

- **Project / Lab document comments** (`DocComment` via
  `api.comments.ts` + `CommentsRail.tsx`):
  - Render: comment bodies and replies render through `MentionText`.
  - Notify: after a comment is created, the API resolves mentions against
    the owning project's roster (or the lab roster as fallback for
    non-Project pages), then fans out in-app notifications to mentioned
    users with a deep-link back to the document or file.

### Tests

- `app/lib/__tests__/mentions.test.ts` — 9 unit tests covering the regex
  extractor, the firstName-only vs composite matcher, ambiguity, dedupe,
  and segment shape. All pass alongside the 10 prior education tests
  (19/19 green).

---

## Still deferred

- Per-attendee Google Calendar invites (events are created on the
  offering's calendar identity with no attendees today). Update and
  delete now propagate from session edits via
  `patchSessionCalendarEvent` / `deleteSessionCalendarEvent`.
- Reactions / likes on discussion posts.
- Notification-preferences UI for muting all education email per-user
  globally (today users mute per-thread).
- Bell icon / CTA differentiation for the new `Education`
  `NotificationKind` (kind is set everywhere but the bell renders it
  identically to `General`).
- Drag-and-drop waitlist reorder (today: up/down arrows).
- Per-status default email templates (today: pick from existing
  hiring-shared templates or fall back to inline copy).
- Calendar event delete on session removal — orphans remain on the
  calendar until manually cleaned up.

---

## Verification checklist

- [x] `npx tsc --noEmit` — no errors introduced by education changes.
- [x] `npx vitest run app/education/lib/__tests__/` — 10/10 pass.
- [ ] Manual `npm run dev` smoke: not run here (the worktree shares the
      parent's `node_modules`; the dev server hits the parent's `.env`).
      Recommended next step: spin up `npm run dev` from this worktree and
      walk through the flows below.
- [ ] Playwright `npm run test:e2e` — no new specs written for education.

### Suggested manual smoke

1. As Core: `/education/manage/new` → create a Workshop with `requiresReview=false`, capacity 2.
2. Open the Sessions tab, add 1 session. Save. Publish.
3. As another logged-in member: hit `/education`, see the new card.
4. Apply / RSVP twice from two members → both Approved. Third → Waitlisted.
5. Approved member visits `/education/enrolled/:id` → sees the session.
6. Manager posts an announcement → check `Notification` row + Gmail (`dev`
   env skips actual send, `[email:dev] skipped …` logs in stdout).
7. One of the Approved members POSTs `Withdrawn` to
   `/api/education/applications/:id/decision` → the Waitlisted member's
   row should auto-flip to Approved and they get a notification.
8. As an applicant: log in with CAS, hit `/portal/education`, apply.
9. As Core/Reviewer on hiring: open an application detail page for that
   user — `Past DALI Education` panel should list the offering.

---

## Files in this PR

**New files (count: 28)**

```
dali-api/app/education/lib/auth.ts
dali-api/app/education/lib/offerings-data.ts
dali-api/app/education/lib/applications-data.ts
dali-api/app/education/lib/promotion.server.ts
dali-api/app/education/lib/notifications.ts
dali-api/app/education/lib/__tests__/promotion.test.ts
dali-api/app/education/lib/__tests__/applications-data.test.ts
dali-api/app/education/routes/api.offerings.ts
dali-api/app/education/routes/api.offerings.$id.ts
dali-api/app/education/routes/api.offerings.$id.publish.ts
dali-api/app/education/routes/api.offerings.$id.sessions.ts
dali-api/app/education/routes/api.sessions.$id.ts
dali-api/app/education/routes/api.offerings.$id.questions.ts
dali-api/app/education/routes/api.offerings.$id.applications.ts
dali-api/app/education/routes/api.applications.$id.decision.ts
dali-api/app/education/routes/api.offerings.$id.announcements.ts
dali-api/app/education/routes/api.offerings.$id.instructors.ts
dali-api/app/education/routes/education.offerings.$id.tsx
dali-api/app/education/routes/education.offerings.$id.apply.tsx
dali-api/app/education/routes/education.enrolled.$id.tsx
dali-api/app/education/routes/education.manage.tsx
dali-api/app/education/routes/education.manage.new.tsx
dali-api/app/education/routes/education.manage.$id.tsx
dali-api/app/education/routes/education.manage.$id.applications.tsx
dali-api/app/education/components/{OfferingCard,OfferingDetail,ApplicationForm,ApplicationsTable,AnnouncementsFeed,SessionList,OfferingBuilder}.tsx
dali-api/app/routes/portal.education.tsx
dali-api/app/routes/portal.education.$id.tsx
dali-api/app/routes/portal.education.$id.apply.tsx
dali-api/app/routes/portal.education.$id.enrolled.tsx
EDUCATION_MVP.md
```

**Modified**

```
dali-api/app/education/routes/education.tsx       (ComingSoon → catalog)
dali-api/app/routes.ts                            (registered new routes)
dali-api/app/components/Layout.tsx                (sidebar Catalog + Manage; isInstructor prop)
dali-api/app/routes/layout.tsx                    (thread isInstructor into Layout)
dali-api/app/lib/audit.ts                         (added education.* audit actions)
dali-api/app/hiring/routes/applications.$domainApplicationId.tsx
                                                   (Past DALI Education panel)
```

No schema or migration changes.
