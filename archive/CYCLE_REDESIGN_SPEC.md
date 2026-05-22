# Cycle Management Redesign Spec

## Overview

An application cycle moves through four phases: **Draft → Open → Under Review → Completed**. Everything is evaluated per `DomainApplication` — if a candidate applies to Engineering and Design, those are entirely separate tracks with separate reviews, interviews, and decisions.

---

## Schema Changes

### 1. Rename `ApplicationCycleStatus` enum values

| Old | New |
|---|---|
| `Closed` | `UnderReview` |
| `DecisionsReleased` | `Completed` |

---

### 2. Add `closeDate` to `ApplicationCycle`

```prisma
model ApplicationCycle {
  // ...existing fields...
  closeDate DateTime? // application due date; triggers auto-transition to UnderReview
}
```

---

### 3. `CycleReviewer` — allow same member in multiple domains

Remove `@@unique([daliMemberId, applicationCycleId])`.
Add `@@unique([daliMemberId, applicationCycleId, domainId])`.

A DALI member can now be a reviewer for Engineering _and_ Design in the same cycle.

---

### 4. New `CycleInterviewer` model

Separate from `CycleReviewer` — interviewers and reviewers are managed independently. Each domain lead manages their own list of interviewers for their domain in the cycle.

```prisma
model CycleInterviewer {
  id        String   @id @default(cuid())
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt

  daliMemberId       String
  daliMember         DALIMember       @relation(fields: [daliMemberId], references: [id])
  applicationCycleId String
  applicationCycle   ApplicationCycle @relation(fields: [applicationCycleId], references: [id])
  domainId           String
  domain             Domain           @relation(fields: [domainId], references: [id])

  availabilityBlocks   InterviewerAvailability[]
  interviewAssignments InterviewAssignment[]

  @@unique([daliMemberId, applicationCycleId, domainId])
}
```

A `DALIMember` can be a `CycleInterviewer` for multiple domains in the same cycle. Cross-domain eligibility = any `CycleInterviewer` whose `domainId != applicant's domainId` (even if they are also an interviewer for the applicant's domain under a different record).

---

### 6. `Interview` — move from `Application` to `DomainApplication`

Interviews are domain-specific. Remove `applicationId`, add `domainApplicationId`.

```prisma
model Interview {
  id        String   @id @default(cuid())
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt

  domainApplicationId String
  domainApplication   DomainApplication @relation(fields: [domainApplicationId], references: [id])
  applicationCycleId  String
  applicationCycle    ApplicationCycle  @relation(fields: [applicationCycleId], references: [id])

  startTime DateTime
  endTime   DateTime
  status    InterviewStatus @default(Scheduled)

  // Joint outcome — set by either interviewer when marking complete
  recommendation      String?  // 'Strong Hire' | 'Hire' | 'Lean Hire' | 'Lean No Hire' | 'No Hire'
  recommendationNotes String?

  assignments InterviewAssignment[]

  @@index([applicationCycleId, startTime])
  @@index([domainApplicationId])
}
```

`Interview.status = Completed` is set when either interviewer submits the recommendation via "Mark Complete". The recommendation field is required to mark complete. The other interviewer can still add/edit their own notes after completion.

---

### 7. New `InterviewNoteVersion` model

Per-interviewer notes are versioned — each auto-save creates a new append-only record. Current notes = latest record by `createdAt`. Interviewers write only their own notes but can read each other's (both are visible during the interview).

```prisma
model InterviewNoteVersion {
  id        String   @id @default(cuid())
  createdAt DateTime @default(now())

  interviewAssignmentId String
  interviewAssignment   InterviewAssignment @relation(fields: [interviewAssignmentId], references: [id])

  content String

  @@index([interviewAssignmentId, createdAt])
}
```

`InterviewAssignment` has no `notes` field — current content is always the latest `InterviewNoteVersion`.

**Auto-save:** client calls `POST /api/interview-assignments/:id/notes` every few seconds when content has changed since the last save. Creates a new version record.

**History:** `GET /api/interview-assignments/:id/notes` returns versions ordered by `createdAt desc`. UI shows a history panel with timestamps; clicking any version restores it as the current editor content (which then auto-saves as a new version on next change).

---

### 8. New `Decision` model

Decisions are **immutable** and **append-only** — never updated, only created. Current state is always inferred from the most recently created record at a given stage.

```prisma
enum DecisionType {
  Rejected
  InvitedToInterview
  Accepted
  Waitlisted
}

enum DecisionStage {
  Draft     // visible only to domain lead / hiring lead
  Final     // locked, ready to release
  Released  // visible to applicant; triggers notification hook
}

model Decision {
  id        String   @id @default(cuid())
  createdAt DateTime @default(now())

  domainApplicationId String
  domainApplication   DomainApplication @relation(fields: [domainApplicationId], references: [id])

  type  DecisionType
  stage DecisionStage

  madeById String
  madeBy   DALIMember @relation(fields: [madeById], references: [id])

  notes        String?
  waitlistRank Int?    // only set when type == Waitlisted; current rank = latest record's value

  @@index([domainApplicationId, createdAt])
}
```

**Immutability:** A decision record is never updated. To change a Draft decision, create a new one (the new record supersedes the old by timestamp). This gives a full audit trail.

**Releasing:** When a Final decision is released, create a new record with `stage: Released` (copying `type`). This timestamps the release separately from when the decision was finalized.

---

### 9. New `ApplicationReview` model

Replaces `MentorReview`. Scoped to `DomainApplication` (not `Application`), authored by a `CycleReviewer` (not a raw `User`).

```prisma
model ApplicationReview {
  id        String   @id @default(cuid())
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt

  domainApplicationId String
  domainApplication   DomainApplication @relation(fields: [domainApplicationId], references: [id])

  cycleReviewerId String
  cycleReviewer   CycleReviewer @relation(fields: [cycleReviewerId], references: [id])

  scores                Json    @default("{}")   // { [criterionKey]: number }
  feedback              String  @default("")
  rejectionRationale    String  @default("")
  overallRecommendation String? // 'Strong Hire' | 'Hire' | 'Lean Hire' | 'Lean No Hire' | 'No Hire'
  annotations           Json    @default("[]")   // [{id, fieldKey, start, end, comment, color}]

  submittedAt DateTime?  // null = in progress; non-null = finalized (read-only after this)
  submittedById String?  // set on submit; records who actually authored the final review
  submittedBy   DALIMember? @relation(fields: [submittedById], references: [id])

  @@unique([cycleReviewerId, domainApplicationId])
}
```

**Assigning a reviewer to a DomainApplication** = `POST /api/domain-applications/:id/reviews { cycleReviewerId }` → creates a blank `ApplicationReview` with `submittedAt: null`.

**Submitting** = `POST /api/reviews/:id/submit` → sets `submittedAt = now()` and `submittedById = auth.user.memberId`. Read-only while submitted.

**Unsubmitting** = `POST /api/reviews/:id/unsubmit` → clears `submittedAt` and `submittedById`. Review becomes editable again. The reviewer can then re-submit, which re-stamps both fields.

**Changing assignment** (before submission): delete the blank record and create a new one for a different `cycleReviewerId`.

---

### 10. New `DelibsSession` model

Persisted so all domain reviewers can see and edit the same kanban board.

```prisma
enum DelibsType {
  Initial  // deliberating on applications with completed reviews, no decision yet
  Final    // deliberating after interviews; produces Accept/Waitlist/Reject decisions
}

enum DelibsStatus {
  Active
  Closed
}

model DelibsSession {
  id        String   @id @default(cuid())
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt

  domainId           String
  domain             Domain           @relation(fields: [domainId], references: [id])
  applicationCycleId String
  applicationCycle   ApplicationCycle @relation(fields: [applicationCycleId], references: [id])

  type   DelibsType
  status DelibsStatus @default(Active)

  // Ordered list of domainApplicationIds per column, used for kanban display.
  // Source of truth for within-column ordering. Which column a card belongs to
  // is authoritative from the latest Draft Decision — on reopen, columnOrder is
  // reconciled: Decision column takes precedence, existing relative order preserved,
  // newly-placed cards appended at bottom.
  // Column names vary by type:
  //   Initial: { "No Decision": [...], "Interview": [...], "Reject": [...] }
  //   Final:   { "Accept": [...], "Waitlist": [...], "Reject": [...] }
  columnOrder Json @default("{}")

  openedById String
  openedBy   DALIMember @relation(fields: [openedById], references: [id])

  @@unique([domainId, applicationCycleId, type]) // one session per type per domain+cycle, reopened not recreated
}
```

---

### 11. Add `rubricVersionId` to `DomainApplicationCycle`

Rubrics are assigned at the domain+cycle level, not per challenge version. Remove `rubricVersionId` from `ChallengeVersion`.

```prisma
model DomainApplicationCycle {
  // ...existing fields...
  rubricVersionId       String?
  rubricVersion         RubricVersion? @relation(fields: [rubricVersionId], references: [id])
  reviewersPerApplication Int          @default(2)
}
```

---

### 12. `ApplicationCycleStatusUpdate` — make `userId` nullable

Needed for system-generated status transitions (auto-close):

```prisma
model ApplicationCycleStatusUpdate {
  // ...existing fields...
  userId String?  // null = system-generated (e.g. auto-close at closeDate)
  user   User?    @relation(...)
}
```

---

### Summary of Model Changes

| Change | Detail |
|---|---|
| `MentorReview` | **Dropped**, replaced by `ApplicationReview` |
| `ChallengeVersion.rubricVersionId` | **Moved** to `DomainApplicationCycle.rubricVersionId` |
| `InterviewAssignment.cycleReviewerId` | **Replaced** with `cycleInterviewerId` → `CycleInterviewer` |
| `InterviewAssignment.notes` | **Removed** — replaced by `InterviewNoteVersion` records |
| `ReviewerAvailability` | **Renamed** to `InterviewerAvailability`, `cycleReviewerId` replaced with `cycleInterviewerId` → `CycleInterviewer` |
| `CycleReviewer` availability/interview relations | **Removed** — `CycleReviewer` is now purely for written reviews |
| `Interview.applicationId` | **Replaced** with `domainApplicationId` |
| `Interview.recommendation` / `recommendationNotes` | **Added** — joint outcome recorded by either interviewer at completion |
| `Application.interviews` | **Removed** (relation now on `DomainApplication`) |
| `Application.mentorReviews` | **Removed** (replaced by `ApplicationReview`) |
| `CycleReviewer` unique constraint | Changed to include `domainId` |
| `ApplicationCycleStatusUpdate.userId` | Made nullable |
| `ApplicationCycleStatus` enum | Values renamed |

---

## Per-DomainApplication Status Inference

These 8 statuses are **never stored** — they are derived at query time from: cycle status, application submission, decisions, and interview state.

### Status Decision Tree

```
1. cycle.status == Open AND application has no Submitted status update
   → ApplicationOpen

2. Application has a Submitted status update AND no Released Decision exists
   → Pending

3. Latest Released Decision type == Rejected
   → Rejected

4. Latest Released Decision type == InvitedToInterview AND no Interview exists
   → InvitedToInterview

5. Latest Released Decision type == InvitedToInterview AND Interview.status == Scheduled
   → InterviewScheduled

6. Interview.status == Completed AND latest Released Decision is still InvitedToInterview
   → PostInterviewPending

7. Latest Released Decision type == Accepted
   → Accepted

8. Latest Released Decision type == Waitlisted
   → Waitlisted
```

### Prisma query pattern (bulk status fetch)

```typescript
const domainApps = await prisma.domainApplication.findMany({
  where: {
    challengeVersion: { domainId },
    application: { applicationCycleId: cycleId }
  },
  include: {
    application: {
      include: { statusUpdates: { orderBy: { createdAt: 'desc' }, take: 1 } }
    },
    decisions: {
      where: { stage: 'Released' },
      orderBy: { createdAt: 'desc' },
      take: 1
    },
    interview: true
  }
})

function inferStatus(da, cycleStatus): DomainApplicationStatus {
  const submitted = da.application.statusUpdates.some(u => u.newStatus === 'Submitted')
  const latestDecision = da.decisions[0]
  const interview = da.interview

  if (cycleStatus === 'Open' && !submitted) return 'ApplicationOpen'
  if (!latestDecision) return 'Pending'
  if (latestDecision.type === 'Rejected') return 'Rejected'
  if (latestDecision.type === 'Accepted') return 'Accepted'
  if (latestDecision.type === 'Waitlisted') return 'Waitlisted'
  if (latestDecision.type === 'InvitedToInterview') {
    if (!interview) return 'InvitedToInterview'
    if (interview.status === 'Scheduled') return 'InterviewScheduled'
    if (interview.status === 'Completed') return 'PostInterviewPending'
  }
  return 'Pending'
}
```

---

## Phase-by-Phase Feature Detail

### Draft

**Goal:** Set up the infrastructure for the cycle before opening to applicants.

**Checklist to advance to Open (enforced — button greyed until complete):**
- [ ] `ApplicationCycle.closeDate` is set
- [ ] Every domain in `DomainApplicationCycle` has a `ChallengeVersion` linked via `ChallengeVersionApplicationCycle`

**Optional in Draft (can continue into Open):**
- Rubric version assigned per `DomainApplicationCycle` (one rubric per domain+cycle, shared across all challenge versions for that domain)
- `CycleReviewer` records added (by Domain Leads or Hiring Lead)
- `CycleInterviewer` records added (by Domain Leads or Hiring Lead)
- `InterviewConfig` set up (by Hiring Lead)

**Who can act:** HiringLead (cycle-level setup), DomainLeads (domain-specific setup for their domain)

**Transition to Open:**
- HiringLead clicks "Open Applications" (greyed with checklist until requirements met)
- `POST /api/cycles/:id/status { newStatus: 'Open' }`
- Side effect: challenge versions are now **locked** — any attempt to change `ChallengeVersionApplicationCycle` while `cycle.status != 'Draft'` returns 403

---

### Open

**Goal:** Applicants submit. DALI continues setup in parallel.

**Applicants:** Can create applications, fill out domain challenges, and submit.

**DomainLeads + HiringLead can:**
- Add/remove `CycleReviewer` records for their domain
- Add/remove `CycleInterviewer` records for their domain
- Set or update `InterviewConfig` (interview window, slot duration, etc.)
- Assign/update rubric version per `DomainApplicationCycle` (still mutable in Open)

**Auto-close (lazy evaluation):**
On any request that reads cycle status, check:
```typescript
if (cycle.status === 'Open' && cycle.closeDate && new Date() > cycle.closeDate) {
  await prisma.applicationCycleStatusUpdate.create({
    data: { newStatus: 'UnderReview', applicationCycleId: cycle.id, userId: null }
  })
}
```

**Manual close:**
HiringLead sees a "Close Applications" button. Creates the same status update with their `userId`.

---

### Under Review

The primary operational phase. Work is organized per-domain.

#### Reviewer Assignment

Domain lead views all `DomainApplication` records for their domain in this cycle, with:
- Current assigned reviewers (`ApplicationReview` records) and their submission status
- Button to add a reviewer (picker from `CycleReviewer` records for this domain)
- Button to remove an unsubmitted assignment

**Auto-assign all:**
Domain lead sets a "reviewers per application" count (default 2, stored on `DomainApplicationCycle.reviewersPerApplication Int @default(2)`). Clicking "Auto-assign" distributes reviewers across applications using a round-robin so each reviewer gets a roughly equal load, assigning exactly `reviewersPerApplication` reviewers to each application. Skips applications that already have the target number of submitted reviews. Idempotent — running it again fills gaps without duplicating existing assignments.

**Changing an assignment:**
- Review not yet submitted: allowed (delete + recreate for different reviewer)
- Review submitted: cannot remove, but can add additional reviewers

---

#### Reviewer Experience

Reviewer sees their `ApplicationReview` records (matched by `cycleReviewerId`). For each:
- Fills in rubric scores, feedback, rejection rationale, annotations
- Clicks "Submit Review" → `POST /api/reviews/:id/submit` → sets `submittedAt = now()`, `submittedById = memberId`
- While submitted: read-only, but reviewer can click "Unsubmit" → `POST /api/reviews/:id/unsubmit` → clears both fields, making it editable again

---

#### Initial Delibs

**Who qualifies:** DomainApplications where all assigned reviews are submitted (`submittedAt != null`), at least one review exists, and no Decision exists yet.

```typescript
// Prisma filter for "ready for initial delibs"
{
  challengeVersion: { domainId },
  application: { applicationCycleId },
  reviews: { every: { submittedAt: { not: null } }, some: {} },
  decisions: { none: { stage: { in: ['Final', 'Released'] } } }
}
```

This group appears in the domain pipeline with a "Start Initial Delibs" button (or "Reopen Initial Delibs" if a Closed session exists). Clicking upserts:
```typescript
prisma.delibsSession.upsert({
  where: { domainId_applicationCycleId_type: { domainId, applicationCycleId, type: 'Initial' } },
  create: { domainId, applicationCycleId, type: 'Initial', status: 'Active', openedById },
  update: { status: 'Active' }, // reopen if previously closed
})
```

There is exactly one session per type per domain+cycle.

**Reopening:** sets `status = Active` and reconciles `columnOrder` against current Draft Decisions:
- **Which column:** Draft Decision takes precedence — if a Decision contradicts where `columnOrder` places a card, the card moves to the Decision's column
- **Order within column:** existing `columnOrder` ordering is preserved where possible (same relative order for cards still in the same column); cards newly moved into a column by a Decision are appended at the bottom
- Applications with no Draft Decision remain in (or are moved to) `No Decision`

**Kanban board:**
Columns: `No Decision` | `Interview` | `Reject`

All cards start in `No Decision`. All domain reviewers see the same board. Clicking a card shows the application and its reviews.

**Moving a card** only updates `DelibsSession.columnOrder`. No Decision records are created during the session — the kanban is a scratch workspace.

**Closing delibs:**
Domain lead clicks "Close Delibs" → summary table derived from `columnOrder` (excluding `No Decision` column). Options:
- "Confirm All" → bulk-creates Draft `Decision` records from `columnOrder`
- Selectively confirm or skip individual applications
- `DelibsSession.status = 'Closed'`

Draft Decisions are only created at close time, not during card moves.

---

#### Final Delibs

**Who qualifies:** DomainApplications with `Interview.status == Completed` and no post-interview Released decision.

Same flow as Initial Delibs, but:
- `DelibsSession.type = 'Final'`
- Kanban columns: `Accept` | `Waitlist` | `Reject`
- Moving a card only updates `DelibsSession.columnOrder` — no Decisions created until close
- Columns support drag-to-reorder within column; order stored in `columnOrder`
- On close: Draft Decisions created from `columnOrder`; waitlist rank derived from position within the Waitlist column and stored as `Decision.waitlistRank Int?`

**Finalizing (Domain Lead only):** After closing delibs, domain lead reviews the Draft decisions and marks them as Final individually or in bulk. Finalizing = create a new `Decision` record with `stage: 'Final'` (copies `type`). This locks the decision — only a HiringLead can act on it from here.

**Releasing (HiringLead only):** HiringLead sees a "Release Decisions" panel across all domains showing all Final decisions. Can release individually or in bulk. Releasing = create a new `Decision` record with `stage: 'Released'` (copies `type`, new `createdAt` timestamp). Calls external email notification hook. Applicant can now see the decision in the applicant portal.

---

#### Interview Flow

**Setup** (can start in Open):
`InterviewConfig` defines window (start/end date), slot duration, buffer between slots, day hours, timezone. No slots are pre-generated — availability is computed from `InterviewerAvailability` blocks.

**Interviewer submits availability:**
`CycleInterviewer` adds `InterviewerAvailability` blocks covering when they're free within the interview window. Domain lead dashboard shows "X of Y interviewers have submitted availability."

**Invitation:**
When a Released `InvitedToInterview` Decision is created, the applicant is notified (external hook). They see available slots in the applicant portal.

**Computing available slots for an applicant:**
```
Available slots = time windows where:
  1. At least one CycleInterviewer for the applicant's domain has InterviewerAvailability covering the slot with no conflict (in-domain)
  2. At least one CycleInterviewer from any other domain has InterviewerAvailability covering the slot with no conflict (cross-domain)
  3. Slot fits within InterviewConfig window, respects bufferMinutes
```

**Applicant selects a slot:**
`POST /api/domain-applications/:id/schedule-interview { startTime }`

Creates:
1. `Interview { domainApplicationId, startTime, endTime: startTime + duration, status: Scheduled }`
2. `InterviewAssignment { interviewId, cycleInterviewerId, role: InDomain, status: Active }` — picks the first available `CycleInterviewer` for the applicant's domain with no conflict
3. `InterviewAssignment { interviewId, cycleInterviewerId, role: CrossDomain, status: Active }` — picks the first available `CycleInterviewer` from any other domain with no conflict

**Hiring lead interview dashboard:**
For all DomainApplications with a Released `InvitedToInterview` decision:
- Scheduled: shows interviewer name and interview time
- Not scheduled: shows count of available slot options

**Interviewer experience:**
`CycleInterviewer` → `InterviewAssignment` → `Interview`

For each assigned interview:
- Interview time, applicant name, and their own role (In-Domain or Cross-Domain)
- **Notes:** per-interviewer text field, auto-saved every few seconds as new `InterviewNoteVersion` records. Both interviewers' notes are visible to each other (read-only). A history panel shows past snapshots with timestamps; restoring a snapshot creates a new version.
- **Joint recommendation:** shared `Interview.recommendation` + `recommendationNotes` fields, editable by either interviewer
- **"Mark Complete":** requires `recommendation` to be filled in. Sets `Interview.status = Completed`. Either interviewer can do this; the other can still edit their own notes afterward.
- "Mark Unavailable":
  - For `InDomain`: checks for another available `CycleInterviewer` for the same domain with no conflict
  - For `CrossDomain`: checks for another available `CycleInterviewer` from any other domain with no conflict
  - If available: `InterviewAssignment.status = Replaced`, new `InterviewAssignment` created for replacement
  - If none available: button greyed out

**Hiring lead manual reassignment:**
For any `Interview` where `status == Scheduled` and `startTime > now()`: shows a picker of available `CycleInterviewer`s (respecting in-domain/cross-domain role of the assignment being replaced), updates assignment (`status = Replaced`, new assignment created). HiringLead can see which slot is `InDomain` and which is `CrossDomain`.

---

### Completed

**Normal transition conditions (both must be true):**
- All `DomainApplication` records with a Released `InvitedToInterview` decision have `Interview.status == Completed`
- All `DomainApplication` records in the cycle have a Released decision of type `Accepted`, `Waitlisted`, or `Rejected`

**Early completion:**
HiringLead can force transition with a confirmation dialog.

**Transition:** `ApplicationCycleStatusUpdate { newStatus: 'Completed' }`

---

## Key Non-Obvious Query Patterns

### "Are all checklist items met to open the cycle?"
```typescript
// 1. Check closeDate
const cycle = await prisma.applicationCycle.findUnique({ where: { id: cycleId } })
const hasCloseDate = !!cycle.closeDate

// 2. Check all domains have a challenge version
const domains = await prisma.domainApplicationCycle.findMany({ where: { applicationCycleId: cycleId } })
const challengeVersions = await prisma.challengeVersionApplicationCycle.findMany({
  where: { applicationCycleId: cycleId },
  include: { challengeVersion: { select: { domainId: true } } }
})
const coveredDomainIds = new Set(challengeVersions.map(cv => cv.challengeVersion.domainId))
const allCovered = domains.every(d => coveredDomainIds.has(d.domainId))

return hasCloseDate && allCovered
```

### "Which applications are ready for Initial Delibs?"
```typescript
prisma.domainApplication.findMany({
  where: {
    challengeVersion: { domainId },
    application: { applicationCycleId },
    reviews: { every: { submittedAt: { not: null } }, some: {} },
    decisions: { none: { stage: { in: ['Final', 'Released'] } } }
  }
})
```

### "How many slot options does an un-scheduled applicant have?"
Computed in application code (not a single query):
1. Fetch `InterviewConfig` for cycle
2. Fetch all `InterviewerAvailability` for `CycleInterviewer`s in the relevant domains (applicant's domain for in-domain, all other domains for cross-domain)
3. Fetch all existing `Interview` records in the window
4. Generate candidate slots from availability blocks, filter conflicts, deduplicate by start time
5. Return count

### "Can this interviewer mark themselves unavailable?"
```typescript
// role = 'InDomain' | 'CrossDomain' from the InterviewAssignment being declined
const domainFilter = role === 'InDomain'
  ? { domainId: interview.domainApplication.challengeVersion.domainId }
  : { domainId: { not: interview.domainApplication.challengeVersion.domainId } }

const alternatives = await prisma.cycleInterviewer.findMany({
  where: {
    applicationCycleId,
    ...domainFilter,
    id: { not: currentInterviewerId },
    availabilityBlocks: {
      some: {
        startTime: { lte: interview.startTime },
        endTime: { gte: interview.endTime }
      }
    }
  },
  include: { interviewAssignments: { include: { interview: true } } }
})
// Filter out interviewers with a conflicting active interview at the same time
const available = alternatives.filter(i =>
  !i.interviewAssignments.some(a =>
    a.status === 'Active' &&
    a.interview.startTime < interview.endTime &&
    a.interview.endTime > interview.startTime
  )
)
return available.length > 0
```

### "Is the cycle ready to move to Completed?"
```typescript
const pendingInterviews = await prisma.interview.count({
  where: { applicationCycleId, status: { not: 'Completed' } }
})
const undecided = await prisma.domainApplication.count({
  where: {
    application: { applicationCycleId },
    decisions: {
      none: { stage: 'Released', type: { in: ['Accepted', 'Waitlisted', 'Rejected'] } }
    }
  }
})
return pendingInterviews === 0 && undecided === 0
```

---

## Concurrency & Race Conditions

### Interview Scheduling

**Race condition:** Two applicants (or the same applicant double-clicking) both call `POST /api/domain-applications/:id/schedule-interview` at nearly the same time for the same slot. Both read the same availability state, both see no conflict, and both proceed to create `Interview` + `InterviewAssignment` records — leaving a `CycleInterviewer` double-booked.

**Plan:** Wrap the availability check and all `Interview`/`InterviewAssignment` creates in a single **serializable transaction with `SELECT FOR UPDATE`** on the `CycleInterviewer` rows being assigned. The second concurrent request blocks until the first commits. After acquiring the lock it re-checks availability; if the slot is now taken, it rolls back and returns `409 Conflict`. The client should show a message like "This slot was just taken — please refresh and choose another time."

```typescript
await prisma.$transaction(async (tx) => {
  // Lock the candidate interviewers for this slot
  await tx.$executeRaw`
    SELECT id FROM "CycleInterviewer"
    WHERE id = ANY(${candidateIds})
    FOR UPDATE
  `
  // Re-check for conflicts now that we hold the lock
  const conflicts = await tx.interviewAssignment.findFirst({
    where: {
      cycleInterviewerId: { in: candidateIds },
      status: 'Active',
      interview: {
        startTime: { lt: endTime },
        endTime: { gt: startTime }
      }
    }
  })
  if (conflicts) throw new ConflictError('Slot no longer available')

  // Safe to create
  await tx.interview.create({ ... })
}, { isolationLevel: 'Serializable' })
```

---

### Delibs Kanban Card Moves

**Race condition:** Two reviewers simultaneously move different cards on the same board. Both read `DelibsSession.columnOrder`, apply their change locally, and write the full JSON back. The second write overwrites the first, silently dropping one person's move.

**Plan:** Replace full `columnOrder` replacement with **patch-based move operations**. The client never sends the full `columnOrder` — it sends only what changed:

- **API:** `POST /api/delibs-sessions/:id/moves { cardId: string, toColumn: string, position?: number }`
- **Server:** inside a transaction, reads the latest `columnOrder`, removes the card from whichever column currently holds it, inserts it at the requested position (or appends to end of column), writes back.

Since each operation is scoped to a single card, two concurrent moves of **different cards** commute perfectly — both are applied without conflict. If two requests move the **same card** simultaneously, last-write-wins: both are intentional human actions (and the humans are likely in the same room), so this is acceptable.

The response returns the updated `columnOrder` so the client can reconcile its local state. If the UI polls or subscribes to session updates, all participants stay in sync automatically.

---

### Auto-Close Duplicate Status Updates

**Race condition:** Multiple concurrent requests all read `cycle.status === 'Open'` with `closeDate` in the past. Each creates a new `ApplicationCycleStatusUpdate { newStatus: 'UnderReview' }`, producing duplicate rows.

**Impact:** Low — since the current cycle status is always derived from the *latest* status update record, duplicates don't affect correctness.

**Plan:** Before inserting the auto-close update, check inside a transaction whether a `UnderReview` update already exists for this cycle:

```typescript
await prisma.$transaction(async (tx) => {
  const alreadyClosed = await tx.applicationCycleStatusUpdate.findFirst({
    where: { applicationCycleId: cycle.id, newStatus: 'UnderReview' }
  })
  if (!alreadyClosed) {
    await tx.applicationCycleStatusUpdate.create({
      data: { applicationCycleId: cycle.id, newStatus: 'UnderReview', userId: null }
    })
  }
})
```

This reduces duplicates to a very narrow window and keeps the status update table clean.

---

## Implementation Notes

No production data exists. All schema changes are clean replacements:

- **`MentorReview`**: drop entirely
- **`ApplicationCycleStatus`**: redefine enum values directly
- **`Interview`**: swap `applicationId` for `domainApplicationId`
- **`Application`**: remove `interviews` and `mentorReviews` relations
- **`CycleReviewer`**: drop old unique constraint, add new one including `domainId`
- **`ApplicationCycleStatusUpdate.userId`**: make nullable
- Dev workflow: `prisma db push --force-reset` + reseed
