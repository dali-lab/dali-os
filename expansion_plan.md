# DALI OS Expansion Plan

## Context

DALI OS is expanding from a hiring-only platform into a comprehensive lab management system. Hiring becomes one section among many; the platform also covers projects, education, mentorship, staffing, calendar/scheduling, and partner relations. DALI OS is intended to **replace Notion** as the lab's knowledge layer (Slack remains the comms layer; hours tracking remains in Dartmouth's payroll system).

This document is **scoped to new and changed surfaces**. Existing hiring features (`/hiring/*`, `/admin-console/*`) remain in place largely unchanged and are not re-documented here. Where the role-model refactor affects existing tables (e.g., `DomainLeadAssignment`), it is called out under Foundational Schema.

---

## User Tiers

Six distinct user tiers, each with a different experience.

| Tier | Who | Auth | Nav Style |
|---|---|---|---|
| **Dartmouth Student** | Any Dartmouth student (non-DALI) | CAS / Google | Minimal top bar (`/portal`) |
| **DALI Member** | Active lab members | Google OAuth / CAS | Left sidebar |
| **Core Member** | Any Core (year-long lead positions) | Same | Left sidebar + Core Hub |
| **Admin** | Full-time staff | Same | Left sidebar + Core + Admin Console |
| **Partner** | External funders / stakeholders | Magic-link or Google | Partner portal (`/partner`) |
| **Alumni** | Past members | Google (with email migration support) | Alumni view (subset of member sidebar) |

**Tier resolution** is derived (not stored) from active assignments — see Foundational Schema → Tier Resolution.

---

## Foundational Schema

The role model is multi-axis: a member can simultaneously hold project roles, instructor roles, Core roles, and domain-lead roles. Almost any permutation is valid. These are stored as separate typed tables rather than one mega-grant table because each shape carries different fields.

### Term

```prisma
model Term {
  id        String   @id @default(cuid())
  code      String   @unique          // "26S", "26X", "27F", etc.
  year      Int                       // 2026
  season    Season
  // sortKey enables chronological sort. Alphabetical sort of `code` breaks
  // because within a year the seasons go W → S → X → F, not alphabetic.
  sortKey   Int      @unique          // year * 10 + (W=1, S=2, X=3, F=4)
  startDate DateTime
  endDate   DateTime

  projectAssignments    ProjectAssignment[]
  mentorshipPairs       MentorshipPair[]
  domainLeadAssignments DomainLeadAssignment[]
  coreAssignments       CoreAssignment[]
  instructorAssignments InstructorAssignment[]
  staffingCycles        StaffingCycle[]
  projectTermStatuses   ProjectTermStatus[]
  projectRoleRequests   ProjectRoleRequest[]

  @@index([sortKey])
}

enum Season {
  W   // winter
  S   // spring
  X   // summer
  F   // fall
}
```

### Domain

```prisma
model Domain {
  id              String   @id @default(cuid())
  // Stable code referenced from app code; keep in sync with seed data.
  code            String   @unique
  displayName     String
  // Intern programs (ERAS, EEJUST, WISP) are domains with isInternProgram=true.
  // After the intern term, members apply normally and get a fresh
  // DomainEligibility in their actual hire domain.
  isInternProgram Boolean  @default(false)
  active          Boolean  @default(true)

  eligibilities         DomainEligibility[]
  projectAssignments    ProjectAssignment[]
  mentorshipPairs       MentorshipPair[]
  domainLeadAssignments DomainLeadAssignment[]
  projectRoleRequests   ProjectRoleRequest[]
}
```

**Initial Domain seed** (from current `roles.csv`):

| Code | Display | Intern? |
|---|---|---|
| `Fullstack` | Fullstack Dev | no |
| `UIUX` | UI/UX Design | no |
| `ARVR` | AR/VR Dev | no |
| `Data` | Data Dev | no |
| `Engineering` | Engineering | no |
| `ThreeDModeling` | 3D Modeling | no |
| `Animation` | Animation | no |
| `Graphics` | Graphics | no |
| `Writing` | Writing | no |
| `Videography` | Videography | no |
| `Photography` | Photography | no |
| `Production` | Production | no |
| `PM` | Project Management | no |
| `DigitalArts` | Digital Arts Design | no |
| `ERAS` | ERAS Intern | **yes** |
| `EEJUST` | EE Just Intern | **yes** |
| `WISP` | WISP Intern | **yes** |

Active domains can be toggled via Admin Console without code changes.

### DomainEligibility

Tracks **qualifications**, independent of active assignments. A member can hold P3 eligibility in Graphics and Animation but be currently working only as Animation P3 — the Graphics P3 eligibility persists.

```prisma
model DomainEligibility {
  id         String   @id @default(cuid())
  userId     String
  domainId   String
  // Eligibility is monotonic in v1: only goes up (no demotions). To preserve
  // a simple one-row-per-(user,domain) shape, we update `level` in place and
  // store the most recent promotion metadata here. If full promotion history
  // is ever needed, add a separate event log table — don't widen this one.
  level      Level
  promotedAt DateTime @default(now())
  promotedBy String?  // user id of promoter; Domain Lead, Core, or Admin

  user   User   @relation(fields: [userId], references: [id])
  domain Domain @relation(fields: [domainId], references: [id])

  @@unique([userId, domainId])
}

enum Level {
  P1   // Learner
  P2   // Doer
  P3   // Mentor
}
```

### ProjectAssignment

Active project work for a term. Drawn from the member's `DomainEligibility` rows.

```prisma
model ProjectAssignment {
  id        String @id @default(cuid())
  userId    String
  projectId String
  termId    String
  domainId  String
  // App-level constraint: must reference an existing DomainEligibility
  // for (userId, domainId) at this level or higher.
  level     Level

  createdAt DateTime @default(now())

  user    User    @relation(fields: [userId], references: [id])
  project Project @relation(fields: [projectId], references: [id])
  term    Term    @relation(fields: [termId], references: [id])
  domain  Domain  @relation(fields: [domainId], references: [id])

  // Multiple rows per (user, term) is normal: a member can be on multiple
  // projects, and even multiple domains within the same project for
  // cross-training. No unique constraints across these dimensions.
  @@index([userId, termId])
  @@index([projectId, termId])
}
```

### MentorshipPair

Domain-scoped mentorship within a project's context. The mentor is **not required** to have a `ProjectAssignment` for that project — Domain Leads and PM Mentors mentor across the lab without project membership.

```prisma
model MentorshipPair {
  id        String @id @default(cuid())
  menteeId  String
  mentorId  String
  projectId String   // mentee's project context
  termId    String
  domainId  String

  mentee  User    @relation("MenteeRelation", fields: [menteeId], references: [id])
  mentor  User    @relation("MentorRelation", fields: [mentorId], references: [id])
  project Project @relation(fields: [projectId], references: [id])
  term    Term    @relation(fields: [termId], references: [id])
  domain  Domain  @relation(fields: [domainId], references: [id])

  // One mentor per (mentee, project, domain) per term. Cross-domain mentees
  // get separate rows (e.g., Fullstack mentor row + Data mentor row).
  @@unique([menteeId, projectId, termId, domainId])
}
```

### DomainLeadAssignment

A Core member who serves as mentor for an entire domain across the lab. Implicitly grants:
- Mentor scope for any mentee in that domain (regardless of project)
- Hiring authority for that domain in any cycle that term

Typically 1 per domain, but multiple is allowed. Should usually be paired with a `CoreAssignment` whose `leadTitle` reflects the position (e.g., "Graphics Domain Lead"). **Note:** this replaces and consolidates the existing cycle-scoped `DomainLeadAssignment`; the Phase 0 migration moves existing rows into the new term-scoped shape.

```prisma
model DomainLeadAssignment {
  id       String @id @default(cuid())
  userId   String
  domainId String
  termId   String

  user   User   @relation(fields: [userId], references: [id])
  domain Domain @relation(fields: [domainId], references: [id])
  term   Term   @relation(fields: [termId], references: [id])

  @@index([domainId, termId])
}
```

### CoreAssignment

Year-long elected lead position. `leadTitle` is **display-only** — Core has broad access to everything; the title affords UI surfacing but does not gate permissions.

```prisma
model CoreAssignment {
  id        String   @id @default(cuid())
  userId    String
  termId    String
  // Display label only (e.g., "Hiring Lead", "Education Lead",
  // "Partner Relations Lead"). Never appears in permission checks.
  leadTitle String?

  user User @relation(fields: [userId], references: [id])
  term Term @relation(fields: [termId], references: [id])

  @@unique([userId, termId])
}
```

### InstructorAssignment

Authority to teach a specific education offering. Any DALI member can become an Instructor; project membership is not required.

```prisma
model InstructorAssignment {
  id         String @id @default(cuid())
  userId     String
  offeringId String
  termId     String

  user     User              @relation(fields: [userId], references: [id])
  offering EducationOffering @relation(fields: [offeringId], references: [id])
  term     Term              @relation(fields: [termId], references: [id])

  @@unique([userId, offeringId])
}
```

### AdminMembership

Permanent (until revoked). Maps to the lab's full-time staff. Admin is a superset of Core. The CSV's "Staff" entries map directly to this.

```prisma
model AdminMembership {
  id        String   @id @default(cuid())
  userId    String   @unique
  grantedAt DateTime @default(now())
  grantedBy String?

  user User @relation(fields: [userId], references: [id])
}
```

### Tier Resolution

Derived at request-time from the above tables:

```
tier(user, term) =
  has AdminMembership                     → Admin
  has CoreAssignment(term)                → Core   (also has Member access)
  has any of: ProjectAssignment(term),
              InstructorAssignment(term),
              DomainLeadAssignment(term)  → Member
  has past assignments, none current      → Alumni
  has Dartmouth account, no DALI history  → Student
  has PartnerUser record                  → Partner
```

### `isLabMentor(user, term)` Helper

Canonical check used by mentor-collective surfaces (mentor notes, mentor-only docs, future mentor-lounge features). Returns true for:

- Any current-term `ProjectAssignment` with `level = P3`
- Any current-term `DomainLeadAssignment`
- Any current `DomainEligibility(domain=PM, level=P3)` (PM Mentors)
- Any current-term `CoreAssignment` (Core members are implicit mentors)

### Job Code Lookup

Each (assignment_type × level × domain) maps to a Dartmouth payroll job code with a different pay rate. DALI OS does **not** track hours, but it surfaces job codes for payroll mapping/export. Derived at query time, not stored on assignment rows.

```prisma
model JobCodeLookup {
  id             String         @id @default(cuid())
  // Match against (assignmentType, level, domainId). Nullable fields act
  // as wildcards in the lookup.
  assignmentType AssignmentType
  level          Level?
  domainId       String?
  jobCode        String
  payRateUsdHour Decimal?
  notes          String?
}

enum AssignmentType {
  Project
  Core
  Instructor
  DomainLead
  Admin
}
```

---

## Profile

A unified profile per user, additive to the existing `User` / `DALIMember` models.

### Schema additions

```prisma
// Additions to the existing User (or DALIMember — match existing convention).
// Fields below are nullable since they're optional and not all users will
// fill them in. classYear is the only one that participates in derived state.

// Dartmouth class year (e.g., 2026). Solves "took a term off" ambiguity
// — Dartmouth quarter system means members are commonly away for a term
// or two without graduating. Used for alumni derivation + display.
// alternativly could integrate with https://lookup.dartmouth.edu or other 
// Dartmouth API to autopopulate value - future TODO
classYear     Int?

// Optional explicit graduation override for off-cycle graduations.
// Populate from form? Should think about this 
graduatedAt   DateTime?

// these are mostly (except bioDocId) cosmetic and can be changed 
pronouns      String?
photoUrl      String?

// Bio stored as a collab doc reference for rich formatting + future @mentions.
bioDocId      String?
major         String?
hometown      String?
linkedinUrl   String?
githubUrl     String?
personalSite  String?
```

### Alumni derivation

Alumni state is **derived**, not flagged:

```
isAlumni(user) =
  (graduatedAt < now())
  OR (classYear's standard graduation date < now())
  AND has past assignments AND has no current-term assignments
```

A member with no current assignments who is **before** their class year graduation is **not** Alumni — they're "on leave" / "off term." Don't show them as Alumni.

---

## Navigation Structure

### DALI Members — Collapsible Left Sidebar

The sidebar replaces the current horizontal top bar. Collapsible to icon-only mode.

```
┌──────────────────┬─────────────────────────────────┐
│ DALI             │                                 │
│                  │                                 │
│  🏠 Home         │                                 │
│  📁 Projects     │                                 │
│  📚 Education    │        Page Content             │
│  👤 People       │                                 │
│  📅 Calendar     │                                 │
│  💬 Mentorship*  │                                 │
│  👥 Hiring    *  │                                 │
│                  │                                 │
│  🔷 Core      *  │                                 │
│  ⚙  Admin     *  │                                 │
│                  │                                 │
│  [+ Schedule]    │  ← global quick action          │
│  🔔 (inbox)      │  ← notifications                │
│  👤 Jane D.      │                                 │
└──────────────────┴─────────────────────────────────┘

* = role-gated
```

Sub-navigation expands inline for the active section. Mobile collapses to a hamburger drawer.

### Dartmouth Students — Minimal Top Bar (`/portal`)

Students see no sidebar. Top-bar layout for:
- Open application (when a hiring cycle is open)
- Education catalog (browse miniseries / workshops)
- Their applications + RSVPs (status, progress)
- Profile (education history, completed offerings)

The applicant layout is generalized into a **student layout**: the same account persists across cycles and is used for both DALI applications and education registration.

### Partners — Partner Portal (`/partner`)

External users see a minimal portal scoped to projects their org funds:
- Projects funded by their org (overview, sprint summaries, public docs)
- Calendar of meetings with their org
- Profile / org info

No lab-wide visibility, no hiring, no other partners.

### Alumni

Alumni see a reduced sidebar:
- People (alumni directory access)
- Profile / project portfolio
- Newsletter (opt-in)

(Alumni features are deferred to later phases — schema-light.)

---

## Section Breakdown

### 1. Home / Dashboard

All DALI members. Default landing page. Auto-populated based on roles + activity:
- Your projects (active project(s), recent activity, upcoming deadlines)
- Upcoming (interviews, sessions, meetings, deadlines)
- Education (series you teach or attend)
- Hiring (if applicable — pending reviews, upcoming interviews)
- Announcements
- Pinned pages (user-configurable)

### 2. Projects

All DALI members.

**Sidebar sub-items**: All Projects (directory, current + past, your projects highlighted).

**Project workspace** (per-project pages, organized in a 2-level page tree):
- Overview, People, Sprints, Tasks, Backlog, Retros, History
- Settings (PM / Core only)

**PM-specific UI**: surfaced only for users with `domain=PM` `ProjectAssignment` on this project (essentiality forms in staffing season, project settings).

#### Project schema

```prisma
model Project {
  id            String        @id @default(cuid())
  name          String
  // Project-owned Google Workspace identity (e.g.,
  // "projectalpha@dali.dartmouth.edu"). Calendar events for this project
  // are owned by this identity, not the organizer's personal calendar.
  // See "Calendar" section.
  calendarEmail String?
  // Term the project was first activated. Used for history views.
  firstTermId   String?
  status        ProjectStatus @default(Active)

  partners        ProjectPartner[]
  termStatuses    ProjectTermStatus[]
  assignments     ProjectAssignment[]
  roleRequests    ProjectRoleRequest[]
  mentorshipPairs MentorshipPair[]
  sprints         Sprint[]
  epics           Epic[]
  tasks           Task[]

  createdAt DateTime @default(now())
}

enum ProjectStatus {
  Active
  Paused
  Archived
}

// Continuing-or-not flag per project per term. Both PM and Partner Relations
// Lead can write to this — UI surfaces in Core Hub > Staffing setup AND in
// the project's settings page.
model ProjectTermStatus {
  id           String   @id @default(cuid())
  projectId    String
  termId       String
  isContinuing Boolean
  setBy        String?
  setAt        DateTime @default(now())

  project Project @relation(fields: [projectId], references: [id])
  term    Term    @relation(fields: [termId], references: [id])

  @@unique([projectId, termId])
}
```

#### Sprints / Epics / Tasks

```prisma
model Epic {
  id               String     @id @default(cuid())
  projectId        String
  title            String
  // Description as collab doc — Notion-style rich content.
  descriptionDocId String?
  status           EpicStatus @default(Open)
  // Optional target term for cross-term epics that span multiple sprints.
  targetTermId     String?
  position         Int        @default(0)

  project Project @relation(fields: [projectId], references: [id])
  tasks   Task[]

  createdAt DateTime @default(now())
}

enum EpicStatus {
  Open
  InProgress
  Done
  Cancelled
}

model Sprint {
  id        String       @id @default(cuid())
  projectId String
  name      String
  startsAt  DateTime
  endsAt    DateTime
  // Sprint goal as collab doc. Retros also live as collab pages in the
  // project's page tree, attached to the sprint via the page.workspaceId.
  goalDocId String?
  status    SprintStatus @default(Planned)

  project Project @relation(fields: [projectId], references: [id])
  tasks   Task[]

  // Multiple Active sprints per project allowed (parallel tracks like
  // design vs. dev). Sprint length is project-configurable; no lab-wide
  // standard duration.
  @@index([projectId, status])
}

enum SprintStatus {
  Planned
  Active
  Closed
}

model Task {
  id               String     @id @default(cuid())
  projectId        String
  // Null sprintId = backlog.
  sprintId         String?
  // Optional epic linkage for cross-sprint grouping.
  epicId           String?

  title            String
  descriptionDocId String?
  status           TaskStatus @default(Todo)
  priority         Priority   @default(Normal)
  position         Int        @default(0)

  // Subtasks: simple checklist field rather than hierarchical Task→Task
  // children (Linear/Notion style). If real demand for hierarchical
  // subtasks emerges later, add a `parentTaskId` column — non-breaking.
  // JSON shape: [{ "text": "...", "done": false }]
  checklist        Json?

  project   Project        @relation(fields: [projectId], references: [id])
  sprint    Sprint?        @relation(fields: [sprintId], references: [id])
  epic      Epic?          @relation(fields: [epicId], references: [id])
  assignees TaskAssignee[]
  comments  TaskComment[]

  createdById String
  createdAt   DateTime @default(now())
  updatedAt   DateTime @updatedAt

  @@index([projectId, sprintId])
}

enum TaskStatus {
  Todo
  InProgress
  InReview
  Done
  Cancelled
}

enum Priority {
  Low
  Normal
  High
  Urgent
}

// Multi-assignee per task (solo or multi both supported).
model TaskAssignee {
  taskId String
  userId String

  task Task @relation(fields: [taskId], references: [id])
  user User @relation(fields: [userId], references: [id])

  @@id([taskId, userId])
}

model TaskComment {
  id        String   @id @default(cuid())
  taskId    String
  authorId  String
  // Plain text or markdown — small comments, not collab doc.
  body      String
  createdAt DateTime @default(now())

  task Task @relation(fields: [taskId], references: [id])
}
```

### 3. Education

All DALI members; Dartmouth students access via `/portal`.

DALI OS includes a **mini course management system**. Education Leads manage offerings, instructors publish content and run sessions, students enroll and submit work.

**Two offering types** share one infrastructure:
- **Miniseries**: longer-form, has a short application (~2 written questions), instructor (and optionally Education Lead) manually approves
- **Workshop**: RSVP-only, uses the same application infrastructure but auto-approves up to capacity

Both have **capacity limits + waitlists with auto-promotion** when a spot opens.

**For members** (sidebar sub-items):
- Browse, My Learning, Teaching (if Instructor)

**For Education Leads**: Manage Offerings, Attendance, Analytics.

**For students** (`/portal/education`): browse catalog, apply / RSVP, "My Learning", per-session materials, assignment submission.

**For instructors**: offering builder (collab doc syllabus + structured metadata), session-by-session content (each is a collab doc), roster + attendance, assignment grading, announcement broadcast (writes to email + in-app via notification system), office hours via scheduling component.

#### Education schema

```prisma
model EducationOffering {
  id                   String         @id @default(cuid())
  type                 OfferingType
  title                String
  descriptionDocId     String?
  capacity             Int
  registrationOpensAt  DateTime
  registrationClosesAt DateTime
  startsAt             DateTime
  endsAt               DateTime
  status               OfferingStatus @default(Draft)
  // True for typical miniseries (instructor-reviewed), false for typical
  // workshops (auto-approve up to capacity, waitlist after).
  // Configurable per-offering — workshops can opt into review without
  // requiring a model change.
  requiresReview       Boolean
  // Optional per-offering Google Workspace identity. Falls back to a
  // shared education identity if not set.
  calendarEmail        String?

  instructors          InstructorAssignment[]
  sessions             EducationSession[]
  applications         EducationApplication[]
  applicationQuestions EducationApplicationQuestion[]
  assignments          EducationAssignment[]
  announcements        EducationAnnouncement[]

  createdAt DateTime @default(now())
}

enum OfferingType {
  Miniseries
  Workshop
}

enum OfferingStatus {
  Draft
  Published
  Archived
}

model EducationSession {
  id             String   @id @default(cuid())
  offeringId     String
  sequence       Int
  datetime       DateTime
  location       String?
  // Materials as collab doc — slides, notes, pre-reads.
  materialsDocId String?
  recordingUrl   String?

  offering    EducationOffering     @relation(fields: [offeringId], references: [id])
  attendances EducationAttendance[]
  assignments EducationAssignment[]

  @@index([offeringId, sequence])
}

model EducationApplication {
  id          String               @id @default(cuid())
  studentId   String
  offeringId  String
  status      EduApplicationStatus
  submittedAt DateTime             @default(now())
  reviewedAt  DateTime?
  reviewedBy  String?

  student     User                         @relation(fields: [studentId], references: [id])
  offering    EducationOffering            @relation(fields: [offeringId], references: [id])
  answers     EducationApplicationAnswer[]
  attendances EducationAttendance[]
  submissions EducationSubmission[]

  // One application per (student, offering). Student may withdraw and re-apply
  // by transitioning status, not by creating a second row.
  @@unique([studentId, offeringId])
}

enum EduApplicationStatus {
  Submitted
  Approved
  Rejected
  Waitlisted
  Withdrawn
}

model EducationApplicationQuestion {
  id         String  @id @default(cuid())
  offeringId String
  prompt     String
  position   Int
  required   Boolean @default(true)

  offering EducationOffering            @relation(fields: [offeringId], references: [id])
  answers  EducationApplicationAnswer[]

  @@index([offeringId, position])
}

model EducationApplicationAnswer {
  id            String @id @default(cuid())
  applicationId String
  questionId    String
  content       String

  application EducationApplication         @relation(fields: [applicationId], references: [id])
  question    EducationApplicationQuestion @relation(fields: [questionId], references: [id])

  @@unique([applicationId, questionId])
}

model EducationAttendance {
  id            String           @id @default(cuid())
  applicationId String
  sessionId     String
  status        AttendanceStatus

  application EducationApplication @relation(fields: [applicationId], references: [id])
  session     EducationSession     @relation(fields: [sessionId], references: [id])

  @@unique([applicationId, sessionId])
}

enum AttendanceStatus {
  Present
  Absent
  Excused
}

model EducationAssignment {
  id                String         @id @default(cuid())
  // Assignment can be scoped to the offering as a whole or to a specific
  // session. Exactly one of offeringId/sessionId should be set.
  offeringId        String?
  sessionId         String?
  title             String
  // Instructions as collab doc — supports embeds, links, rich content.
  instructionsDocId String?
  dueAt             DateTime?
  submissionType    SubmissionType

  offering    EducationOffering?    @relation(fields: [offeringId], references: [id])
  session     EducationSession?     @relation(fields: [sessionId], references: [id])
  submissions EducationSubmission[]
}

enum SubmissionType {
  Text
  File
  Mixed
}

model EducationSubmission {
  id            String    @id @default(cuid())
  assignmentId  String
  studentId     String
  // Submission body as collab doc + optional file attachments (S3 URLs in JSON).
  contentDocId  String?
  files         Json?
  submittedAt   DateTime?
  gradedAt      DateTime?
  // Feedback as collab doc — instructor can leave rich, structured feedback.
  feedbackDocId String?

  assignment EducationAssignment @relation(fields: [assignmentId], references: [id])

  @@unique([assignmentId, studentId])
}

// Broadcast from instructor to all approved enrollees. Triggers notifications
// (in-app + email) via the notification system.
model EducationAnnouncement {
  id         String   @id @default(cuid())
  offeringId String
  authorId   String
  body       String
  sentAt     DateTime @default(now())

  offering EducationOffering @relation(fields: [offeringId], references: [id])
}
```

### 4. Hiring

Existing `/hiring/*` routes and schema retained largely unchanged. Only impact from this expansion:

- `DomainLeadAssignment` migrates from cycle-scoped to **term-scoped** (see Foundational Schema). Hiring routes that reference it shift to a term-based lookup.
- Hiring emails route through the new notification system once that ships (Phase 5).
- Application flow generalizes: the existing hiring application is one type alongside Standard / Intern / InternToFull / Transfer (`Application.applicationType` enum on the existing `Application` model).

No new tables for hiring.

### 5. Core Hub

Visible to Core members and Admins.

**Sidebar sub-items**: Staffing, Analytics, Resources.

#### Staffing

The full term-by-term staffing workflow.

**Member-side flow:**
1. Member opens form. System queries their `DomainEligibility` rows.
2. System loads `ProjectRoleRequest` rows for the current `StaffingCycle.termId`.
3. Form filters to options where `eligibility.domain == request.domain` AND `eligibility.level >= request.level`.
4. Member picks up to N (project, role) pairs and ranks them.
5. Members can edit prefs anytime before close.

**PM-side flow:** PM (only — not project mentors) fills `EssentialityForm` for each current team member, marking how critical they are for next term.

**Continuing flag:** PM and Partner Relations Lead can both write to `ProjectTermStatus.isContinuing` for the upcoming term — UI lives in both Core Hub > Staffing setup and in the project's settings.

**Two-phase lock state machine:**

```
Draft               ─ Core sets up term: defines projects, role requests,
                      partner relations confirms continuing projects.
   ↓
OpenToCoreFirst     ─ Core/Domain Lead positions confirmed (CoreAssignment,
                      DomainLeadAssignment), plus pre-known project commits
                      (StaffingAssignment.status=Confirmed). Locks capacity.
   ↓
OpenToMembers       ─ Regular members fill staffing form. PMs fill
   + OpenToPMs        essentiality forms in parallel. Available role
                      requests reflect Core-confirmed capacity already
                      subtracted.
   ↓
Assigning           ─ Forms close. Pairing algorithm runs automatically;
                      Core reviews and adjusts manually.
   ↓
Closed              ─ Confirmed StaffingAssignments promoted to canonical
                      ProjectAssignment + MentorshipPair rows.
```

**UI configurability** (no code changes needed):
- Core CRUD for `StaffingCycle` (term, name, max prefs, dates)
- PM/Core CRUD for `ProjectRoleRequest` per project per term
- Form copy / instructions stored as collab docs

**Mentor pairing**: assigned together with project assignments as part of the pairing algorithm — not a separate post-staffing pass.

#### Staffing schema

```prisma
model StaffingCycle {
  id                      String         @id @default(cuid())
  termId                  String
  name                    String
  opensAt                 DateTime
  closesAt                DateTime
  // Member preference limit (UI-configurable per cycle, default 3).
  maxPreferencesPerMember Int            @default(3)
  status                  StaffingStatus @default(Draft)

  term              Term                 @relation(fields: [termId], references: [id])
  preferences       StaffingPreference[]
  essentialityForms EssentialityForm[]
  assignments       StaffingAssignment[]
}

enum StaffingStatus {
  Draft
  OpenToCoreFirst
  OpenToMembers
  Assigning
  Closed
}

// Per-project per-term role requirements. Defines the slots staffing
// needs to fill — a project might need 2 P1 Fullstack, 1 P3 Fullstack
// Mentor, 1 P1 UIUX, etc. CRUD-able from the project's settings or from
// Core Hub > Staffing setup.
model ProjectRoleRequest {
  id         String  @id @default(cuid())
  projectId  String
  termId     String
  domainId   String
  level      Level
  slots      Int
  // Optional collab doc explaining what this role entails on this project.
  notesDocId String?

  project Project @relation(fields: [projectId], references: [id])
  term    Term    @relation(fields: [termId], references: [id])
  domain  Domain  @relation(fields: [domainId], references: [id])

  @@index([projectId, termId])
}

model StaffingPreference {
  id              String  @id @default(cuid())
  memberId        String
  staffingCycleId String
  projectId       String
  domainId        String
  level           Level
  // 1-based ranking among the member's preferences (1 = top choice).
  preferenceRank  Int
  notes           String?

  staffingCycle StaffingCycle @relation(fields: [staffingCycleId], references: [id])

  @@index([staffingCycleId, memberId])
}

model EssentialityForm {
  id              String    @id @default(cuid())
  projectId       String
  staffingCycleId String
  // PM only — not project mentors.
  pmUserId        String
  submittedAt     DateTime?

  staffingCycle StaffingCycle        @relation(fields: [staffingCycleId], references: [id])
  ratings       EssentialityRating[]

  @@unique([projectId, staffingCycleId])
}

model EssentialityRating {
  id                 String            @id @default(cuid())
  essentialityFormId String
  memberId           String
  rating             EssentialityLevel
  notes              String?

  form EssentialityForm @relation(fields: [essentialityFormId], references: [id])

  @@unique([essentialityFormId, memberId])
}

enum EssentialityLevel {
  Critical
  Important
  NiceToHave
  NotNeeded
}

// Output of the staffing assignment process. On Confirm, promoted to
// a canonical ProjectAssignment row; this row retains the proposal/audit
// trail and can be referenced for future analysis.
model StaffingAssignment {
  id              String           @id @default(cuid())
  memberId        String
  staffingCycleId String
  projectId       String
  termId          String
  domainId        String
  level           Level
  status          AssignmentStatus @default(Proposed)
  assignedAt      DateTime         @default(now())
  assignedById    String?

  staffingCycle StaffingCycle @relation(fields: [staffingCycleId], references: [id])

  @@index([memberId, termId])
  @@index([projectId, termId])
}

enum AssignmentStatus {
  Proposed
  Confirmed
  Declined
}
```

#### Analytics

Lab-wide reporting: member stats, project health, education participation, hiring funnel. Surfaced as collab pages with embedded chart blocks (uses page tree). No new schema in this phase — pulls from existing data.

#### Resources

Documentation of Core and DALI policies, links to operational hubs. Lives entirely in the page tree under the Lab workspace.

### 6. Admin Console

Admins only. Existing `/admin-console/*` retained. Future expansions (system settings, permissions, audit views) are out of scope here.

### 7. People

All DALI members.

**Sidebar sub-items**: Directory, Teams, Feed (Feed deferred — Phase 16).

**Directory**: searchable / filterable list of members by name, role, project, term, skills (DomainEligibility), class year. Filters use the role-model tables directly.

**Teams**: browse current project teams and rosters by term.

**Profile cards** link to full profiles showing project history, eligibility matrix, education activity, term history, bio, contact info.

No new schema; consumes the foundational role-model tables + Profile additions.

### 8. Calendar

All DALI members. Lab-wide calendar aggregating all DALI events.

**Views**: Month, Week, Day, Agenda. Last-used view remembered per user.

**Event sources**:
- Lab-wide events (all-hands, socials, demos, deadlines)
- Project meetings (standups, partner meetings, sprint reviews)
- Education sessions (miniseries, workshops, office hours)
- Personal/role events (interviews, mentor check-ins, staffing deadlines)

**Filtering**:
1. Category toggles (Lab, Projects, Education, Hiring, Personal) — color-coded, preferences saved per user.
2. Calendar subscriptions — auto-subscribe to your project, your education series, lab-wide events. Manually subscribe to others.

**Personal calendar overlay**: opt-in display of user's full Google Calendar events within DALI's calendar view (off by default for privacy).

**Recurring meetings**: supported in v1.

**Members without linked Google Calendar**: skipped in availability calculations. Calendar linking is mandated; absence is treated as a setup gap, not a feature requirement.

#### Per-scope Google Workspace identities

DALI provisions per-project email addresses (e.g., `projectalpha@dali.dartmouth.edu`). Calendar events are owned by the relevant scope's identity, not the organizer's personal calendar:

| Scope | Owning identity |
|---|---|
| Project meeting | `Project.calendarEmail` |
| Lab-wide event | lab-wide identity (system config) |
| Education session | `EducationOffering.calendarEmail` (or shared edu identity) |
| Group / UserList / ad-hoc | DALI scheduling identity fallback |

**Auth**: Google Workspace **domain-wide delegation** via service account is the assumed approach. DALI OS authenticates once with service-account credentials and impersonates the relevant `dali.dartmouth.edu` identity per event. No per-mailbox OAuth required.

**Why per-scope identities**: events outlive organizer turnover (PMs change, project email persists); invites come from meaningful identities ("Project Alpha" not the organizer's name); members can subscribe to project calendars in their personal Google account.

#### Calendar / Scheduling schema

```prisma
model UserCalendarLink {
  id             String      @id @default(cuid())
  userId         String      @unique
  provider       CalProvider
  externalEmail  String
  // Encrypted at rest; never logged. Used only to query free/busy and
  // overlay personal events (read-only, opt-in).
  oauthTokens    String
  primary        Boolean     @default(true)
  // Subset of the user's Google calendars to read for free/busy + overlay.
  subCalendarIds String[]
  linkedAt       DateTime    @default(now())

  user User @relation(fields: [userId], references: [id])
}

enum CalProvider {
  Google
  Outlook
}

model ScheduledMeeting {
  id                 String        @id @default(cuid())
  organizerId        String
  title              String
  descriptionDocId   String?
  durationMinutes    Int

  // What this meeting is scoped to. Determines ownerCalendarEmail.
  scopeType          ScopeType
  // FK varies by scopeType (Project.id, GroupDefinition.id,
  // EducationOffering.id, or null for ad-hoc UserList/None).
  scopeId            String?

  participantUserIds String[]
  selectedAt         DateTime?
  // Google Calendar event ID after push (for cancel/edit later).
  externalEventId    String?
  status             MeetingStatus @default(Searching)

  // Recurring meetings (v1). RFC 5545 RRULE format.
  recurrenceRule     String?

  // Resolved at create-time from scopeType/scopeId. Stored so the meeting
  // can be edited/cancelled even if the scope's calendarEmail later changes.
  ownerCalendarEmail String

  createdAt DateTime @default(now())
}

enum ScopeType {
  Project
  Group
  UserList
  Series
  None
}

enum MeetingStatus {
  Searching
  Confirmed
  Cancelled
}

// Saved groups for scheduling. Static = manually curated user lists;
// Dynamic = computed from role data ("Core current term", "Project Alpha
// team current term", "Domain X members current term").
model GroupDefinition {
  id              String    @id @default(cuid())
  name            String
  type            GroupType
  // For dynamic groups: structured query identifier (interpreted in app
  // code; e.g. "core:current-term", "project:<id>:current-term").
  dynamicQuery    String?
  // For static groups: explicit member list.
  staticMemberIds String[]

  createdAt DateTime @default(now())
}

enum GroupType {
  Static
  Dynamic
}
```

---

## Cross-Cutting Systems

### Page Tree (Notion replacement)

DALI OS replaces Notion. Most surfaces are collaborative documents (Tiptap + Yjs + Hocuspocus) organized in a 2-level page tree per workspace.

**Workspaces**: Lab (top-level), Project, EducationOffering. Each has its own page tree.

**Nesting cap**: 2 levels (workspace → top-level page → one level of children, stop). Permissions inherit parent → child; no per-page override in v1. **Plan to revisit**: if real use cases require deeper nesting, expand to bounded N-levels later. Don't default to unbounded Notion-style nesting in v1.

**Page kinds**:
- **FreeForm**: collab Tiptap doc (Notion-like)
- **Structured**: real schema views (sprint board, task list, attendance grid). Displayed inside the same tree but not editable as docs.

**DALI-native blocks** (slash commands within FreeForm pages): member mention, project link, deadline, poll, calendar embed, task list embed, attendance widget.

```prisma
model Page {
  id            String        @id @default(cuid())
  workspaceType WorkspaceType
  // Null for Lab workspace. Otherwise FK to Project / EducationOffering.
  workspaceId   String?
  // Null for top-level pages. App-level constraint: parentPageId's parent
  // must itself be null (enforces 2-level cap). Don't try to encode this
  // in Prisma — handle in the create/update path.
  parentPageId  String?
  title         String
  kind          PageKind      @default(FreeForm)
  // Collab doc reference for FreeForm pages. Null for Structured pages
  // (which render from their underlying schema entities).
  contentDocId  String?
  position      Int           @default(0)

  parent   Page?  @relation("PageTree", fields: [parentPageId], references: [id])
  children Page[] @relation("PageTree")

  createdById String
  createdAt   DateTime @default(now())
  updatedAt   DateTime @updatedAt

  @@index([workspaceType, workspaceId, parentPageId])
}

enum WorkspaceType {
  Lab
  Project
  EducationOffering
}

enum PageKind {
  FreeForm
  Structured
}
```

### Mentorship

`/mentorship` is the mentor's hub. Mentors write **weekly notes** for each of their mentees.

**Cadence**: strictly weekly (one note per mentee per week).

**Visibility**: the author mentor + ALL Core members + ALL other mentors in the lab (any active P3, PM Mentor, or Domain Lead, regardless of project — i.e., `isLabMentor` returns true). NOT mentee-readable. Treats lab mentors as a collective.

**Templates**: lab-wide default template managed via UI by Core. Editable in `/mentorship/templates` (not per-domain).

**End-of-term formal evaluation**: in scope but tabled — design later.

**Reverse evaluations** (mentee → mentor): not in scope.

```prisma
model MentorNote {
  id           String   @id @default(cuid())
  mentorId     String
  menteeId     String
  projectId    String
  termId       String
  domainId     String
  // Start-of-week date (Monday) the note covers. App enforces one row
  // per (mentor, mentee, project, term, domain, week).
  weekOf       DateTime
  // Note body as collab doc — instructor template seeded on create.
  contentDocId String

  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt

  @@unique([mentorId, menteeId, projectId, termId, domainId, weekOf])
}

model MentorNoteTemplate {
  id            String   @id @default(cuid())
  name          String
  // Template body as collab doc; new MentorNote contentDocs are seeded
  // from this on create.
  contentDocId  String
  isDefault     Boolean  @default(false)
  lastUpdatedBy String?
  updatedAt     DateTime @updatedAt
}
```

### Scheduling Component

Reusable scheduling primitive triggerable from anywhere (global `[+ Schedule]` button + contextual triggers from project / people / series / mentorship).

**Flow**:
1. Trigger (global or contextual). Contextual triggers pre-fill scope + participants.
2. Configure: title, duration, scope (Project / Group / UserList / Series / ad-hoc), participants.
3. System computes participant set from scope + pulls free/busy from each linked Google Calendar.
4. Show grid of mutual free slots within search window.
5. Organizer picks slot.
6. Push event to the resolved owner calendar (per-scope identity), invite participants, store `externalEventId`.

Backed by `ScheduledMeeting` + `UserCalendarLink` schema. Existing `lib/google-calendar.ts` and `api.google-calendar.busy.ts` provide the foundation; generalize for non-hiring scopes.

### Notifications

In-app inbox + email channel + per-event-type preferences. Confirmed in scope but **not a super-soon phase** — primitives ship before consumers (Education / Calendar / Mentorship) need them. Hooks added incrementally as those phases land.

```prisma
model NotificationEvent {
  id             String    @id @default(cuid())
  // Typed event identifier, e.g., "interview_scheduled", "sprint_due",
  // "miniseries_session_reminder", "mentor_eval_requested",
  // "staffing_assignment_published".
  type           String
  recipientId    String
  // Event-specific payload (links, names, IDs). Structured per type.
  payload        Json
  readAt         DateTime?
  inAppDelivered Boolean   @default(false)
  emailDelivered Boolean   @default(false)
  createdAt      DateTime  @default(now())

  recipient User @relation(fields: [recipientId], references: [id])

  @@index([recipientId, readAt])
  @@index([recipientId, createdAt])
}

model NotificationPreference {
  id              String     @id @default(cuid())
  userId          String
  // Matches NotificationEvent.type, or "*" for the user's global default.
  eventType       String
  inApp           Boolean    @default(true)
  email           Boolean    @default(true)
  digestFrequency DigestFreq @default(Instant)

  user User @relation(fields: [userId], references: [id])

  @@unique([userId, eventType])
}

enum DigestFreq {
  Instant
  Daily
  Weekly
  Off
}
```

### Search

Global search across people / projects / education / collab doc bodies. **Target**: Meilisearch self-hosted on Fly. **Priority**: deferred to Phase 15 — not blocking initial release.

Initial release can ship without global search, or with rudimentary Postgres full-text search, and migrate to Meilisearch later. Yjs collab doc bodies require plain-text snapshotting on save regardless of backend (extract Tiptap plain text into a `searchText` column on `CollabDocumentVersion` or equivalent — same work whether using FTS or Meilisearch).

No new schema in this phase.

---

## Partner Portal

External users (corporate sponsors, partner orgs) get a scoped portal at `/partner` showing only the projects their org funds.

**Auth**: magic-link email primary (lowest friction); Google OAuth optional for repeat sign-in. Not CAS (partners aren't Dartmouth).

**Scope** (read-mostly):
- Projects funded by their org (overview, sprint summaries, public docs)
- Calendar of meetings with their org
- Optional: comment on shared collab docs

**Partner data model is nested**: org-level entity with multiple users under it. Project ↔ Org link grants user access via org membership.

```prisma
model PartnerOrg {
  id               String   @id @default(cuid())
  name             String
  logoUrl          String?
  website          String?
  // Optional designated primary contact (FK to PartnerUser within this org).
  primaryContactId String?
  // True for solo-individual partners (e.g., a Dartmouth professor funding
  // a one-off project, no real organization). Modeled as a single-user org
  // to avoid a second code path.
  isIndividual     Boolean  @default(false)

  users    PartnerUser[]
  projects ProjectPartner[]

  createdAt DateTime @default(now())
}

model PartnerUser {
  id           String              @id @default(cuid())
  partnerOrgId String
  name         String
  // Unique across all partner users in v1. If a partner contact ever needs
  // to belong to two orgs simultaneously, revisit.
  email        String              @unique
  // Free-text display role, e.g. "VP Engineering", "Technical PM".
  // Not a permission — visibility derives entirely from org membership.
  displayRole  String?
  authProvider PartnerAuthProvider

  partnerOrg PartnerOrg @relation(fields: [partnerOrgId], references: [id])

  createdAt DateTime @default(now())
}

enum PartnerAuthProvider {
  MagicLink
  Google
}

// Many-to-many: projects can have multiple partners, and partners can fund
// multiple projects. Both directions are uncommon but must remain possible
// (consortium projects, repeat partners).
model ProjectPartner {
  id           String    @id @default(cuid())
  projectId    String
  partnerOrgId String
  startedAt    DateTime?
  endedAt      DateTime?

  project    Project    @relation(fields: [projectId], references: [id])
  partnerOrg PartnerOrg @relation(fields: [partnerOrgId], references: [id])

  @@unique([projectId, partnerOrgId])
}
```

---

## Alumni Features

No new schema. Alumni state is **derived** from `classYear` / `graduatedAt` + assignment history (see Profile section).

**Surfaces (deferred)**:
- Alumni directory (filtered by class year, optional opt-in for coffee chats)
- Project portfolio (member's project history, opt-in public)
- Newsletter (opt-in feed of public lab updates)
- Optional contributions (review applications, give office hours, mentor remotely) — TBD

**Auth note**: Dartmouth NetID may persist post-grad but Google Workspace access can be revoked. Plan for **email migration** (alumni link a personal email to their existing User record). One profile, multiple auth methods. Implementation deferred to Phase 14.

---

## Onboarding

Post-hire onboarding track is in scope but deferred — not a priority for the first cycle. No schema changes anticipated for v1 (existing confidentiality agreement infra + the new Profile + UserCalendarLink + MentorshipPair models cover the touchpoints). When designed, will likely be a checklist-track surfaced on the dashboard until complete.

---

## Routing Structure

```
/                           Dashboard (members) or Student homepage (students)
/projects                   All projects directory
/projects/:id               Project workspace (overview)
/projects/:id/people        Team roster
/projects/:id/sprints       Sprint board
/projects/:id/tasks         Task list / Kanban
/projects/:id/pages/*       Project page tree (collab docs)
/projects/:id/settings      PM/Core settings (incl. continuing flag)
/education                  Education hub (browse, my learning, teaching)
/education/offering/:id     Offering detail
/education/offering/:id/manage   Instructor view
/people                     Member directory
/people/:id                 Member profile
/people/teams               Browse teams by project
/calendar                   Calendar (default Month view)
/calendar/(week|day|agenda) View modes
/hiring/*                   Existing hiring routes (unchanged)
/core                       Core Hub
/core/staffing              Staffing dashboard
/core/staffing/cycles/:id   Cycle setup + assignment dashboard
/core/analytics             Lab analytics
/core/resources             Lab page tree (policies, links)
/admin-console/*            Existing admin routes
/profile                    My profile
/profile/settings           Account settings, calendar linking, notifications
/mentorship                 Mentor hub (your mentees, weekly notes)
/mentorship/templates       Note templates (Core CRUD)
/schedule                   Scheduling modal (also overlay from anywhere)
/portal                     Student dashboard (Dartmouth students)
/portal/education           Student education catalog
/portal/apply               Application flow
/portal/profile             Student profile
/partner                    Partner portal
/partner/projects/:id       Partner project view
/alumni                     Alumni hub (deferred)
```

---

## Phase Roadmap

The original phase ordering is superseded by the following. Phases 0–4 are the load-bearing critical path to a working staffing tool.

| Phase | Title | What ships |
|---|---|---|
| **0** | Foundational schema | Term, Domain, DomainEligibility, ProjectAssignment, MentorshipPair, DomainLeadAssignment, CoreAssignment, InstructorAssignment, AdminMembership, JobCodeLookup, PartnerOrg/User. Refactor `lib/roles.ts` with backwards-compat shims. No user-facing changes. |
| **1** | Sidebar + layout shell | Replace horizontal nav with sidebar; role-gated visibility; placeholder pages for new sections. |
| **2** | Profile + Directory (basic) | classYear, pronouns, photo, bio, eligibility display; member profile page; basic People directory + filters. |
| **3** | Project schema + lightweight workspace | Project, ProjectTermStatus, ProjectRoleRequest, Sprint, Epic, Task, TaskComment models; project listing + workspace skeleton (just enough to be referenced by Staffing). |
| **4** | **Staffing flow (high priority)** | StaffingCycle, StaffingPreference, EssentialityForm, StaffingAssignment; member preference form, PM essentiality form, Core assignment dashboard, auto-pairing on close, UI-configurable cycles/role-requests. |
| **5** | Notification primitives | NotificationEvent, NotificationPreference, in-app inbox, email channel, producer/router pattern. Hook into staffing first; retrofit hiring emails. |
| **6** | Project workspace v2 | Kanban board, sprint planning UI, retros as templated collab docs, comments. |
| **7** | Collab page tree | Page tree per workspace (2-level nesting), templates, slash commands, DALI-native blocks. |
| **8** | Education student-side | Generalize `/portal` → student dashboard, catalog, EducationOffering / Application / RSVP flow, capacity + waitlist (auto-promote). |
| **9** | Education instructor-side | Offering builder, sessions, attendance, assignments, submissions, announcements. |
| **10** | Calendar + scheduling | UserCalendarLink, ScheduledMeeting, GroupDefinition; calendar view; scheduling modal; free/busy via Google API; event push via per-scope identities (domain-wide delegation); recurring meetings; personal overlay. |
| **11** | Mentorship | `/mentorship` section, MentorNote weekly notes, lab-wide templates, visibility gating via `isLabMentor`. |
| **12** | Core Hub (analytics + resources) | Lab-wide analytics dashboards; policies/resources via page tree. |
| **13** | Partner portal | PartnerOrg/User auth (magic-link primary), scoped project views, partner-tab in project workspaces. |
| **14** | Alumni features | Alumni directory access (gated), project portfolio views, opt-in newsletter, email migration support. |
| **15** | Search (Meilisearch) | Index pipeline, Yjs plain-text snapshots, global search UI. |
| **16** | Activity feed (if signal) | Auto events + member posts. |

**Onboarding track** (post-hire checklist) is deferred — confirmed not a priority and doesn't touch schema. Activity feed (Phase 16) only proceeds if there's user signal.
