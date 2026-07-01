# DALI OS Expansion Plan

## Table of Contents

- [Context](#context)
- [User Tiers](#user-tiers)
- [Foundational Schema](#foundational-schema)
  - [Term](#term)
  - [Domain](#domain)
  - [DomainEligibility](#domaineligibility)
  - [ProjectAssignment](#projectassignment)
  - [MentorshipPair](#mentorshippair)
  - [DomainLeadAssignment](#domainleadassignment)
  - [CoreAssignment](#coreassignment)
  - [InstructorAssignment](#instructorassignment)
  - [AdminMembership](#adminmembership)
  - [Tier Resolution](#tier-resolution)
  - [`isLabMentor(userId, term)` Helper](#islabmentoruserid-term-helper)
  - [Job Code Lookup](#job-code-lookup)
- [Profile](#profile)
  - [Schema additions to existing `User` model](#schema-additions-to-existing-user-model)
  - [Alumni derivation](#alumni-derivation)
- [Navigation Structure](#navigation-structure)
  - [DALI Members — Collapsible Left Sidebar](#dali-members--collapsible-left-sidebar)
  - [Dartmouth Students — Minimal Top Bar (`/portal`)](#dartmouth-students--minimal-top-bar-portal)
  - [Partners — Partner Portal (`/partner`)](#partners--partner-portal-partner)
  - [Alumni](#alumni)
  - [Two-Layer Navigation Model](#two-layer-navigation-model)
  - [Global Path Bar (Breadcrumbs)](#global-path-bar-breadcrumbs)
- [Section Breakdown](#section-breakdown)
  - [1. Home / Dashboard](#1-home--dashboard)
  - [2. Projects](#2-projects)
  - [3. Education](#3-education)
  - [4. Hiring](#4-hiring)
  - [5. Core Hub](#5-core-hub)
  - [6. Admin Console](#6-admin-console)
  - [6.5. Settings (`/profile/settings`)](#65-settings-profilesettings)
  - [7. People](#7-people)
  - [8. Calendar](#8-calendar)
- [Cross-Cutting Systems](#cross-cutting-systems)
  - [Page Tree (Notion-style content within structured workspaces)](#page-tree-notion-style-content-within-structured-workspaces)
  - [Mentorship](#mentorship)
  - [Scheduling Component](#scheduling-component)
  - [Notifications](#notifications)
  - [Search](#search)
  - [Audit Log](#audit-log)
- [Partner Portal](#partner-portal)
- [Alumni Features](#alumni-features)
- [Onboarding](#onboarding)
  - [Minimum viable onboarding (ships with the Staffing track)](#minimum-viable-onboarding-ships-with-the-staffing-track)
- [Routing Structure](#routing-structure)
- [Admin / Core CRUD Surface Inventory](#admin--core-crud-surface-inventory)
- [v0: Foundational Migration (sequential, blocks everything)](#v0-foundational-migration-sequential-blocks-everything)
  - [v0 Deliverables](#v0-deliverables)
- [Post-v0: Independent Tracks](#post-v0-independent-tracks)
  - [Tracks](#tracks)
  - [Track-level guidance](#track-level-guidance)
  - [Track ownership](#track-ownership)

---

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

**Tier resolution** is derived (not stored) from active assignments — see Foundational Schema → Tier Resolution. There is one sub-tier — `MemberPendingSetup` — for new members who haven't linked a calendar + populated their profile yet. Treated as Member with reduced sidebar visibility until setup is done.

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
| `PM` | Product Management | no |
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
  // Actor: a Domain Lead, Core member, or Admin who promoted them.
  promotedBy String?

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
  // App-level constraint: assignment.level <= the matching
  // DomainEligibility.level for (userId, domainId).
  level     Level

  createdAt DateTime @default(now())

  user    User    @relation(fields: [userId], references: [id])
  project Project @relation(fields: [projectId], references: [id])
  term    Term    @relation(fields: [termId], references: [id])
  domain  Domain  @relation(fields: [domainId], references: [id])

  // Multiple rows per (user, term) is normal: a member can be on multiple
  // projects, and even multiple domains within the same project for
  // cross-training. The unique below prevents only literal duplicates of
  // the same (user, project, term, domain) row.
  @@unique([userId, projectId, termId, domainId])
  @@index([userId, termId])
  @@index([projectId, termId])
}
```

### MentorshipPair

Domain-scoped mentorship within a project's context. The mentor is **not required** to have a `ProjectAssignment` for that project — Domain Leads and PM Mentors mentor across the lab without project membership.

```prisma
model MentorshipPair {
  id           String @id @default(cuid())
  menteeUserId String
  mentorUserId String
  projectId    String   // mentee's project context
  termId       String
  domainId     String

  mentee  User    @relation("MenteePairs", fields: [menteeUserId], references: [id])
  mentor  User    @relation("MentorPairs", fields: [mentorUserId], references: [id])
  project Project @relation(fields: [projectId], references: [id])
  term    Term    @relation(fields: [termId], references: [id])
  domain  Domain  @relation(fields: [domainId], references: [id])

  // One mentor per (mentee, project, domain) per term. Cross-domain mentees
  // get separate rows (e.g., Fullstack mentor row + Data mentor row).
  @@unique([menteeUserId, projectId, termId, domainId])
}
```

### DomainLeadAssignment

A Core member who serves as mentor for an entire domain across the lab. Implicitly grants:
- Mentor scope for any mentee in that domain (regardless of project)
- Hiring authority for that domain in any cycle that term

Typically 1 per domain, but multiple is allowed. Should usually be paired with a `CoreAssignment` whose `leadTitle` reflects the position (e.g., "Graphics Domain Lead"). **Note:** this extends the existing `DomainLeadAssignment` model (which today is timeless — just `(member, domain)` with no time scoping). The v0 migration adds `termId` and backfills existing rows to the current term.

```prisma
model DomainLeadAssignment {
  id       String @id @default(cuid())
  userId   String
  domainId String
  termId   String

  user   User   @relation(fields: [userId], references: [id])
  domain Domain @relation(fields: [domainId], references: [id])
  term   Term   @relation(fields: [termId], references: [id])

  // Prevents inserting the same person twice as Domain Lead for the same
  // (domain, term). Multiple distinct users per (domain, term) is allowed
  // (rare but supported per the prose above).
  @@unique([userId, domainId, termId])
  @@index([domainId, termId])
}
```

**v0 migration**: existing rows use `memberId` (FK to DALIMember). Rename to `userId` (FK to User), populating from `DALIMember.userId`. Per the verification SQL — there are 2 existing rows pointing at DALIMembers with NULL userId; resolve manually before the rename (delete if stale, or create User rows from `daliEmail` if active).

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

  // No (userId, termId) unique — a member can hold multiple Core titles in
  // the same term (e.g., Hiring Lead + Education Lead). Each title is its
  // own row. App-level should still validate "no duplicate (user, term,
  // leadTitle)" rows on insert.
  @@index([userId, termId])
  @@index([termId, leadTitle])
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
tier(userId, term) =
  has AdminMembership                     → Admin
  has CoreAssignment(term)                → Core   (also has Member access)
  has any of: ProjectAssignment(term),
              InstructorAssignment(term),
              DomainLeadAssignment(term):
    if NOT setupComplete(userId)          → MemberPendingSetup  (sub-tier)
    else                                  → Member
  has past assignments, none current      → Alumni
  has Dartmouth account, no DALI history  → Student
  has PartnerUser record                  → Partner
```

`setupComplete(userId)` is **derived from existing tables** (not a stored flag). Returns true when both:
- A `UserCalendarLink` row exists for the user
- The user's Profile fields `classYear`, `pronouns`, and `photoUrl` are all non-null

Three small parallel queries; no denormalized fields. At lab scale (~100 active members) this is fast enough that no caching is needed.

#### Confidentiality agreements

CA signing is **NOT part of `setupComplete`** in v1. The existing `ConfidentialityAgreement*` system gates access to specific *cycle* data (an applicant's review materials, interview notes, etc.) and is enforced at the point of access by the existing `requireApiSignedOrForbidden` / `requirePageSignedOrRedirect` helpers in hiring routes. Staffing and other new features don't surface confidential cycle data, so they don't need a separate CA gate.

If a future feature does need a "this user has signed the lab's general CA" gate, it should either reuse the existing per-cycle CA or introduce a separate "Membership Agreement" model — but neither is needed for v0 or the initial track set.

- Partners and Alumni don't sign DALI's CA — they have separate agreements (out of scope here).
- Admins (full-time staff) sign their CA through Dartmouth HR, not DALI OS.

### `isLabMentor(userId, term)` Helper

Canonical check used by mentor-collective surfaces (mentor notes, mentor-only docs, future mentor-lounge features). Returns true for users with **active lab participation** at one of these mentor-shaped scopes:

- Current-term `ProjectAssignment` with `level = P3`
- Current-term `DomainLeadAssignment`
- Current-term `CoreAssignment`
- Current `DomainEligibility(domain=PM, level=P3)` (PM Mentor) **AND** at least one current-term role assignment of any kind (any `ProjectAssignment`, `CoreAssignment`, `DomainLeadAssignment`, or `InstructorAssignment`)

The PM-Mentor case requires a current activity check because `DomainEligibility` is monotonic and persists indefinitely — without the activity check, an alumnus from years ago who happened to be P3 PM would still pass `isLabMentor`.

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

A unified profile per user. **All fields live on `User`** — these are universal Dartmouth-style profile fields that apply to anyone with an account (members, students, applicants, alumni). Lab-member-specific operational fields stay on `DALIMember` (existing — `daliEmail`, `did`, etc.).

`PartnerUser` is a separate entity and doesn't share these fields; partners have their own minimal profile (name, displayRole, email — already in the PartnerUser schema).

### Schema additions to existing `User` model

```prisma
// All nullable — optional profile fields.

// Dartmouth class year (e.g., 2026). Solves "took a term off" ambiguity —
// the Dartmouth quarter system means members are commonly away for a term
// or two without graduating. Used for alumni derivation + display.
// Future enhancement: auto-populate from https://lookup.dartmouth.edu or
// equivalent Dartmouth API.
classYear     Int?

// Optional explicit graduation override for off-cycle graduations.
graduatedAt   DateTime?

pronouns      String?
photoUrl      String?

// Bio stored as a collab doc reference for rich formatting + future @mentions.
bioDocId      String?
major         String?
hometown      String?
linkedinUrl   String?
githubUrl     String?
personalSite  String?

// Display time zone for converting UTC DateTimes. Default
// "America/New_York" applied at render time when null.
timeZone      String?
```

**No onboarding-tracking fields.** `setupComplete` (see Tier Resolution) is derived from existing tables (`UserCalendarLink` row + the three required Profile fields above being non-null). No `caSignedForCycleId` / `calendarLinkedAt` / `profileCompletedAt` columns — denormalization isn't worth the cache-invalidation cost at lab scale.

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

(Alumni features ship in the Alumni features track — schema-light, derived from existing data.)

### Two-Layer Navigation Model

DALI OS does NOT mimic Notion's "everything is a page" approach. Projects, sprints, tasks, attendance, etc. are first-class structured features. Pages are a complementary surface for free-form content within those structures.

- **Layer 1 — App-level sidebar** (fixed sections): Home, Projects, Education, People, Calendar, Mentorship, Hiring, Core, Admin. The spine of the platform. Users can't add or remove sections.
- **Layer 2 — Workspace-level navigation**, inside a Project / Education Offering / Lab Resources. Renders as a sub-rail or tabs. Combines structured feature views with the page tree:

```
Project Alpha
├─ Overview              (structured)
├─ People                (structured)
├─ Sprints               (structured)
├─ Tasks                 (structured)
└─ 📄 Pages              ← page tree lives here
   ├─ Project Brief
   ├─ Partner Notes
   │  └─ Q1 Kickoff Notes
   ├─ Decisions Log
   └─ + Add page
```

The page tree is **scoped to its workspace** and sits alongside structured features. Page creation only happens here — never at the main sidebar level. There is no "personal scratchpad" page concept; every page lives in a workspace.

The Lab workspace's page tree lives under **Core Hub > Resources** (lab-wide policies, engineering guidelines, onboarding docs). This is the surface most resembling pure Notion.

### Global Path Bar (Breadcrumbs)

Every page renders a breadcrumb at the top of its content area, showing the **canonical hierarchy** from Home to the current page. Each segment is a link to its level.

```
Home > Projects > Project Alpha > Sprints
Home > Projects > Project Alpha > Pages > Sprint 3 > Sprint 3 Retro
Home > Education > Intro to ML > Manage > Sessions
Home > Core > Resources > Engineering Standards > Code Review Guidelines
Home > People > Jane Doe
Home > Mentorship > Bob Smith > Week of Mar 4
Home > Calendar
```

**Canonical, not navigation history.** The breadcrumb shows where the page lives in the tree, not how the user got there. Browser back/forward + sidebar handle history-style navigation.

**Multi-context entities pick a canonical home.** Member profile → People. Project page → Projects. A mentor note → Mentorship (not Projects > ... > People > Bob). Each entity declares its canonical breadcrumb path; cross-references happen via in-content links, not via breadcrumb routing.

**Implementation**: each route declares its breadcrumb segments via route config (or computes them from loader data). Rendered as a layout-level component reading matched-route metadata. No schema impact — derived from URL + entity data already available.

**Mobile**: when a trail has 5+ segments, elide middle segments with `…` (tap expands to full trail in popover):

```
Home > … > Sprint 3 > Sprint 3 Retro
```

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

**Project workspace navigation** (Layer 2 nav per Two-Layer Navigation Model — these are structured tabs, NOT page-tree pages):
- **Overview** — the project's top-level page in the workspace's page tree (auto-created on Project create from the "Project Brief" template). Editable as a collab doc; renders the project header (name, partners, current term, PM) above the doc body.
- **People** — current-term roster, mentor pairings, partner contacts (structured)
- **Sprints** — sprint board (structured)
- **Tasks** — task list / Kanban (structured)
- **Backlog** — tasks with `sprintId IS NULL` (structured)
- **History** — past terms, past teams, project audit log (structured)
- **📄 Pages** — the workspace's page tree (free-form collab pages — Project Brief, Partner Notes, Decisions Log, sprint retros, etc.). See Page Tree section.
- **Settings** (PM / Core only) — calendar email, continuing flag, role requests, archive

Overview is the ONLY structured-feature tab that's backed by a collab doc; everything else (People / Sprints / Tasks / Backlog / History) renders from schema entities.

**PM-specific UI**: surfaced only for users with `domain=PM` `ProjectAssignment` on this project (essentiality forms in staffing season, project settings).

#### Project lifecycle

A project moves through a small state machine:

- **Created** by Partner Relations Lead (or Core) during a `StaffingCycle` setup phase. Initially `status=Active` with a `firstTermId` set to the term it begins in.
- **Continuing** between terms: `ProjectTermStatus.isContinuing=true` for the upcoming term means the project rolls forward — same `Project` row, new `ProjectAssignment` rows for the next term. Set by PM or Partner Relations Lead.
- **Paused**: `status=Paused` — no current-term assignments, but project stays in the directory and history. Used when a project takes a term off but expects to resume. PMs and assignments don't auto-create for paused terms.
- **Archived**: `status=Archived` — project is finished; no future assignments, page tree becomes read-only, partner access ends. Members' historical `ProjectAssignment` rows persist on their profiles. Triggered by Core or Admin (PMs propose, Core confirms).

**PM transitions mid-term**: when a project's PM changes, the outgoing PM's `ProjectAssignment(domain=PM)` is closed and a new one created for the incoming PM. Page tree, settings, and partner-facing surfaces don't break — they reference the project, not the PM. Outgoing PM should hand off via a templated "PM Handover" page (Lab > Resources > Templates).

**Cross-term identity**: a project keeps its `Project.id` across all its terms. History views aggregate by `project.id`; per-term views filter `ProjectAssignment` / `Sprint` / etc. by `termId`.

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

  // Auto-created on Project creation: a top-level FreeForm Page in the
  // Project workspace, seeded from the "Project Brief" PageTemplate. The
  // workspace's Overview tab renders this page's contentDoc with a
  // structured project header (name, partners, current term, PM) above.
  // Nullable to allow Project creation in a transaction before the Page
  // row exists; populated immediately after.
  overviewPageId String? @unique
  overviewPage   Page?   @relation("ProjectOverview", fields: [overviewPageId], references: [id])

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

**For instructors**: offering builder (collab doc syllabus + structured metadata), session-by-session content (each is a collab doc), roster + attendance, assignment grading, announcement broadcast (emits a `NotificationEvent` via `emitEvent` + sends ad-hoc email through existing `lib/email.ts` while the Notifications delivery track is pending — once that ships, the email path goes through the unified delivery pipeline), office hours via scheduling component.

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

// Broadcast from instructor to all approved enrollees. On create, emits a
// NotificationEvent (type="education.announcement_posted") for each
// recipient. Email delivery is ad-hoc via existing lib/email.ts until the
// Notifications delivery track ships, after which the unified pipeline
// handles in-app + email per recipient prefs.
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

- `DomainLeadAssignment` is extended with `termId` (see Foundational Schema). Existing rows are backfilled to the current term; existing `isDomainLead(userId)` call sites continue to work because the new helper defaults to current term.
- Hiring emails route through the new notification system once the Notifications delivery track ships. Until then, hiring continues to use existing `lib/email.ts` directly.
- Application flow generalizes: the existing hiring application is one type alongside Standard / Intern / InternToFull / Transfer.

#### Schema additions to existing `Application` model

```prisma
// Addition to the existing Application model:

// Distinguishes the app's purpose. Standard = regular DALI hire cycle.
// Intern = shorter form for ERAS / EEJUST / WISP intern programs.
// InternToFull = shorter form taken by current interns applying for
// regular hire after their intern term. Transfer = informal internal
// domain transfer (no dedicated form yet — placeholder for later).
applicationType  ApplicationType  @default(Standard)

enum ApplicationType {
  Standard
  Intern
  InternToFull
  Transfer
}
```

The intern application's actual form questions / cycle settings differ from Standard but live on the same `Application` table — branching is per-`applicationType` in the form-rendering code, not per-table.

No other new tables for hiring.

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

#### Auto-pairing algorithm (v1)

Runs at the `Assigning` transition. Inputs: `StaffingPreference` rows, `DomainEligibility`, `ProjectRoleRequest` slots (net of `OpenToCoreFirst` confirmations), `EssentialityRating` rows.

Algorithm — **rank-respecting serial dictatorship**:

1. **Pin essentiality.** For each project's continuing-member essentiality form, members marked `Critical` are auto-confirmed onto the project at their most recent eligible level (subject to slot availability). These pin first, before any preference-driven matching.
2. **Process preferences in rank order.** For rank = 1 to N (max preferences per cycle):
   - For each member, look at their rank-N preference. If the requested `(project, domain, level)` slot is still open AND they're eligible at that level, assign them.
   - **Tie-breaking when multiple members want the same slot at the same rank**: prefer the member for whom this is the *earliest* rank (already handled by outer loop). Among truly tied members at the same rank, prefer (a) higher `EssentialityRating` for continuing projects, then (b) random.
3. **Backfill unassigned members.** After all rank passes, any unassigned members get matched to remaining open slots they're eligible for, minimizing further-rank distance from their preferences (i.e., if their rank-1 was taken, try rank-2, then rank-3, then any-eligible-open).
4. **Mentor pairing.** For each newly-assigned non-P3 member in a domain, find a mentor on the same project at P3 in that domain. If none, fall back to the project's PM, then to any P3 in that domain on another project (cross-project mentorship), then to the domain lead. Create a `MentorshipPair`.
5. **Output.** All assignments inserted as `StaffingAssignment` rows with `status=Proposed`. Core reviews the dashboard, makes manual overrides as needed, and bulk-confirms.

This is intentionally simple — not optimal, but predictable and explainable. If Core wants to override the algorithm's output, they edit a row's `(project, domain, level)` directly. Future versions may add weighted optimization (Hungarian algorithm, optimal matching) but v1 ships with the rank-respecting greedy approach.

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
  userId          String
  staffingCycleId String
  projectId       String
  domainId        String
  level           Level
  // 1-based ranking among the member's preferences (1 = top choice).
  preferenceRank  Int
  notes           String?

  user          User          @relation(fields: [userId], references: [id])
  staffingCycle StaffingCycle @relation(fields: [staffingCycleId], references: [id])

  // Prevents duplicate preferences for the same (user, project, domain,
  // level) combination. Members revise prefs by updating the existing row,
  // not by inserting another.
  @@unique([userId, staffingCycleId, projectId, domainId, level])
  @@index([staffingCycleId, userId])
}

model EssentialityForm {
  id              String    @id @default(cuid())
  projectId       String
  staffingCycleId String
  // PM only — not project mentors. App-level check: pmUserId must have an
  // active ProjectAssignment with domain=PM on this project.
  pmUserId        String
  submittedAt     DateTime?

  project       Project              @relation(fields: [projectId], references: [id])
  staffingCycle StaffingCycle        @relation(fields: [staffingCycleId], references: [id])
  pmUser        User                 @relation(fields: [pmUserId], references: [id])
  ratings       EssentialityRating[]

  @@unique([projectId, staffingCycleId])
}

model EssentialityRating {
  id                 String            @id @default(cuid())
  essentialityFormId String
  // The member being rated.
  userId             String
  rating             EssentialityLevel
  notes              String?

  form EssentialityForm @relation(fields: [essentialityFormId], references: [id])
  user User             @relation(fields: [userId], references: [id])

  @@unique([essentialityFormId, userId])
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
  userId          String
  staffingCycleId String
  projectId       String
  termId          String
  domainId        String
  level           Level
  status          AssignmentStatus @default(Proposed)
  assignedAt      DateTime         @default(now())
  // Actor: the Core member or Admin who created/confirmed this assignment.
  assignedById    String?

  user          User          @relation(fields: [userId], references: [id])
  staffingCycle StaffingCycle @relation(fields: [staffingCycleId], references: [id])

  @@index([userId, termId])
  @@index([projectId, termId])
}

enum AssignmentStatus {
  Proposed
  Confirmed
  Declined
}
```

#### Analytics

Lab-wide reporting: member stats, project health, education participation, hiring funnel. Surfaced as collab pages with embedded chart blocks (uses page tree). No new schema — pulls from existing data.

#### Resources

Documentation of Core and DALI policies, links to operational hubs. Lives entirely in the page tree under the Lab workspace.

### 6. Admin Console

Admins only. Existing `/admin-console/*` retained. Future expansions (system settings, permissions, audit views) are out of scope here.

### 6.5. Settings (`/profile/settings`)

Every authenticated user has a settings surface. Lives at `/profile/settings` (member/core/admin) with a parallel `/portal/settings` and `/partner/settings` for student and partner tiers (subset of options).

**Sub-sections** (sidebar within settings, or tabs):

- **Profile**: photo, bio, pronouns, major, hometown, class year, social links. Self-edit only — no one can edit another user's profile fields directly.
- **Notifications**: per-event-type prefs (matrix of in-app × email × digest frequency); see `NotificationPreference` schema.
- **Calendar**: link / unlink Google or Outlook account; pick which sub-calendars are read for free/busy + overlay; opt-in / opt-out of personal-calendar overlay on the DALI calendar.
- **Privacy**: opt-in flags for public profile visibility, alumni directory listing, "open to coffee chats" flag (alumni), bio in public showcase.
- **Auth**: linked auth methods (Google, CAS, magic-link for partners), passwordless login devices, sign-out everywhere. For alumni: add a personal email as a fallback auth method.
- **Account**: delete-account / data-export request (GDPR-style; routes to Admin for review).

No new schema beyond what's already in the doc — this is a UI surface aggregating existing settings.

### 7. People

All DALI members.

**Sidebar sub-items**: Directory, Teams, Feed (Feed deferred — Activity Feed track, only if signal).

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
  // Organizer can be any User — typically a Member or Core but Admins
  // (full-time staff) can also organize.
  organizerId        String
  organizer          User          @relation(fields: [organizerId], references: [id])
  title              String
  descriptionDocId   String?
  durationMinutes    Int

  // What this meeting is scoped to. Determines ownerCalendarEmail.
  scopeType          ScopeType
  // FK is untyped at the DB layer; dispatched in app code by scopeType:
  //   Project  → Project.id
  //   Group    → GroupDefinition.id
  //   Series   → EducationOffering.id
  //   UserList → null (ad-hoc list of participants)
  //   None     → null (no entity link)
  // Validity is enforced at the API boundary, not in Prisma. This avoids
  // a model with five nullable typed FKs at the cost of less query-time
  // type safety — acceptable since meetings are looked up by id, and
  // scope inspection happens in TypeScript.
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

#### Dynamic group query DSL

`GroupDefinition.dynamicQuery` is a colon-delimited identifier interpreted in app code. Each query maps to a registered resolver function `(currentTerm) => userId[]`.

Initial supported queries (extend by registering more resolvers):

| Query string | Resolves to |
|---|---|
| `core:current-term` | All current-term `CoreAssignment` users |
| `admins` | All `AdminMembership` users (no term arg) |
| `project:{id}:current-term` | All current-term `ProjectAssignment` users on that project |
| `domain:{code}:current-term` | All current-term users with any `ProjectAssignment` in that domain |
| `domain:{code}:p3:current-term` | Same, restricted to `level=P3` |
| `domain:{code}:lead:current-term` | Current `DomainLeadAssignment` users for that domain |
| `mentors:current-term` | Anyone returning true from `isLabMentor` |
| `series:{id}:enrolled` | Approved `EducationApplication` students for the offering |

Adding new dynamic groups = register a resolver in code + document the query string. No schema change. Validation: when a `GroupDefinition` is created with `type=Dynamic`, the API rejects unrecognized query strings.

#### Recurring meetings — cancel / edit semantics

`recurrenceRule` (RFC 5545 RRULE) generates an infinite or bounded series of occurrences. Editing/cancelling needs three modes:

1. **Cancel one occurrence**: append an `EXDATE` to the RRULE (or store separately) — series continues, that date is suppressed.
2. **Cancel all future occurrences**: set `recurrenceRule` `UNTIL` to yesterday, or transition `status=Cancelled`.
3. **Edit one occurrence** (different time, location, or title): create a `MeetingException` row that overrides fields for that single occurrence.

```prisma
model MeetingException {
  id                  String   @id @default(cuid())
  scheduledMeetingId  String
  // The original occurrence start time being overridden.
  originalStart       DateTime
  // Optional overrides — null = inherit from parent.
  overrideStart       DateTime?
  overrideDurationMin Int?
  overrideTitle       String?
  cancelled           Boolean  @default(false)

  meeting ScheduledMeeting @relation(fields: [scheduledMeetingId], references: [id])

  @@unique([scheduledMeetingId, originalStart])
}
```

Add reverse relation on `ScheduledMeeting`:

```prisma
exceptions  MeetingException[]
```

Edit propagation to Google: when a `MeetingException` is created or `recurrenceRule` changes, sync to Google via the corresponding event API (Google supports `RECURRENCE-ID` natively).

#### Calendar sync direction

**v1 is one-way: DALI → Google.** DALI is the source of truth for DALI-scheduled meetings. Pushes happen on create / edit / cancel. DALI does **not** read changes back from Google in real time.

What this means in practice:

- If the organizer edits the event directly in Google Calendar (changing time, title, attendees), DALI doesn't know. The next time DALI re-syncs (manual button, or a periodic re-fetch via `externalEventId`), it overwrites the Google version with DALI's source-of-truth.
- If a participant declines via Google, DALI doesn't auto-update its `participantUserIds`. Acceptance counts shown in DALI come from a periodic re-fetch (or are simply not surfaced in v1).
- If Google deletes the event (rare — usually only via user action), the next re-fetch detects the missing `externalEventId` and marks the DALI meeting as `Cancelled` with a "synced from external deletion" audit entry.

**Two-way sync is deferred** to a later phase if real demand emerges. It introduces conflict resolution complexity that's not worth it for v1.

#### Time zones

All `DateTime` columns store UTC. Display layer converts to the user's local time zone (default: America/New_York for Dartmouth-based members; configurable on profile). Recurring rules are interpreted in the organizer's time zone at create time, but stored UTC.

---

## Cross-Cutting Systems

### Page Tree (Notion-style content within structured workspaces)

DALI OS replaces Notion. Most free-form surfaces are collaborative documents (Tiptap + Yjs + Hocuspocus) organized in a 2-level page tree per workspace. See **Two-Layer Navigation Model** in the Navigation section for how the page tree fits into the broader app — it is a workspace-scoped surface, NOT a replacement for app-level navigation.

**Workspaces**: Lab (top-level, surfaced under Core Hub > Resources), Project, EducationOffering. Each has its own page tree.

**Nesting cap**: 2 levels (workspace → top-level page → one level of children, stop). Permissions inherit parent → child; no per-page override in v1. **Plan to revisit**: if real use cases require deeper nesting, expand to bounded N-levels later. Don't default to unbounded Notion-style nesting in v1.

**Page kinds**:
- **FreeForm**: collab Tiptap doc (Notion-like rich content)
- **Structured**: real schema views (sprint board, task list, attendance grid). Displayed inside the same tree but rendered from their underlying schema entities, not editable as docs.

**DALI-native blocks** (slash commands within FreeForm pages): member mention, project link, page link, deadline, poll, calendar embed, task list embed, attendance widget.

#### Page schema

```prisma
model Page {
  id            String        @id @default(cuid())
  workspaceType WorkspaceType
  // Null for Lab workspace. Otherwise FK to Project / EducationOffering.
  workspaceId   String?
  // Null for top-level pages. App-level constraint: parentPageId's parent
  // must itself be null (enforces 2-level cap). Belt-and-suspenders: a
  // Postgres CHECK trigger or BEFORE INSERT/UPDATE function gives DB-level
  // enforcement so a misbehaving caller can't sneak a 3-level page in.
  // Implementation defers to migration; document as a Page Tree UX track deliverable.
  parentPageId  String?
  title         String
  kind          PageKind      @default(FreeForm)
  // Collab doc reference for FreeForm pages. Null for Structured pages
  // (which render from their underlying schema entities).
  contentDocId  String?
  position      Int           @default(0)

  // Notion-style page metadata.
  iconEmoji     String?       // e.g., "📋", "🚀", "📚"
  coverImageUrl String?       // S3 URL for header image

  // Distinct from createdById; updated on every edit. Used in breadcrumb
  // tooltips, page lists ("Edited 2 hours ago by Jane"), and mention
  // previews.
  lastEditedById String?

  // Soft delete. Archived pages are filtered out of the tree by default
  // and surface only in the workspace's Archive view. Permanent deletion
  // happens after a grace period (TBD).
  archivedAt    DateTime?

  parent   Page?  @relation("PageTree", fields: [parentPageId], references: [id])
  children Page[] @relation("PageTree")

  createdById String
  createdAt   DateTime @default(now())
  updatedAt   DateTime @updatedAt

  @@index([workspaceType, workspaceId, parentPageId])
  @@index([archivedAt])
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

#### Page templates

Templates encode lab norms (Sprint Retro format, Project Brief structure, etc.) so new pages start with the right shape. The point of templates: reduce friction, capture institutional knowledge, ensure consistency across PMs / instructors / cycles.

```prisma
model PageTemplate {
  id             String          @id @default(cuid())
  name           String
  description    String?
  // Which workspace types this template is offered for. Empty array =
  // available everywhere. Common case: a "Sprint Retro" template only
  // makes sense in Project workspaces.
  workspaceTypes WorkspaceType[]
  // Template body. On Page create from this template, the new page's
  // contentDoc is initialized from a clone of this doc.
  contentDocId   String
  iconEmoji      String?
  isDefault      Boolean         @default(false)
  createdBy      String?
  createdAt      DateTime        @default(now())
}
```

**Seeded at deploy** (Core can edit anytime under Lab > Resources > Templates):
- Empty
- Project Brief
- Sprint Retro
- Sprint Goals
- Meeting Notes
- Decision Log
- Onboarding Doc

Workspace-specific templates can be added later (e.g., Education Lead seeds an "Office Hours Notes" template scoped to EducationOffering workspaces).

Notion's other template mechanisms (inline Template Button blocks, database-row templates) are **out of scope for v1** — page templates only.

#### Creation permissions

| Workspace | Create top-level page | Create child page | Archive |
|---|---|---|---|
| **Lab** (Resources) | Core | Core | Core |
| **Project** | Any project member | Any project member | PM or Core |
| **EducationOffering** | Instructor of that offering | Instructor | Instructor or Education Lead |

No "personal scratchpad" pages — every page lives in a workspace.

#### Creation flow

1. User in workspace's `📄 Pages` area clicks `+ New page` (at workspace root, or hover-affordance on a top-level page to create a child).
2. Modal: title input + template picker (default Empty) + optional icon emoji.
3. Submit creates `Page` row + (for FreeForm) `CollabDocument` row seeded from the chosen template's contentDoc → redirect to `/<workspace>/.../pages/:pageId`.
4. New page appears in the tree immediately; breadcrumb reflects its position.

**Inline `/page` slash command** in any FreeForm doc creates a child page reference at the cursor (Notion-style nested page links within content). Same effect as the modal flow, faster path.

**Backlinks** ("what pages link here"): deferred. Add a `PageReference` extraction pipeline as a follow-on to the Page Tree UX track, once page volume justifies it.

#### Mention / link reference shape

Slash blocks (`@member`, `[[page]]`, project-link, etc.) are stored as Tiptap mark/node attributes inside the doc. They reference target entities **by ID**, with a cached display string for offline-render scenarios.

Tiptap node attribute shape (for `MemberMention`):

```ts
type MemberMentionAttrs = {
  userId: string;          // canonical reference
  cachedDisplayName: string; // last-known display, for fallback rendering
};
```

**Survival rules:**
- **Rename** of the target entity → mention re-renders with the current name. The `cachedDisplayName` updates lazily (next save) or eagerly (mention-extension fetches on render).
- **Soft delete / archive** of the target → mention renders strikethrough with `cachedDisplayName`, links to a tombstone page ("This page was archived").
- **Hard delete** (rare for users; possible for pages) → same as archive.
- **Permission scoping** — if the viewer can't see the target (e.g., a partner viewing a member-only page mention), render as a non-link plain string with the cached name.

Same pattern for project links, page links, and series links — each has its own node type with `{entityId, cachedDisplay}` shape.

**Indexing for backlinks** (when implemented later): on collab doc save, walk the doc's mark tree, extract all mention nodes, and write to a `PageReference(sourcePageId, targetType, targetId)` table. Backlinks panel queries this table.

**Drag-to-reorder** (within a level): supported via `position` field. **Drag-to-reparent**: supported but constrained by the 2-level cap (can't drop a page that has children under another parent).

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

In-app inbox + email channel + per-event-type preferences. Confirmed in scope; producer stub (`emitEvent`) ships in v0 so feature tracks can emit events from day 1. Delivery (in-app inbox UI, email digest, prefs UI) is its own post-v0 track. Until the delivery track lands, events accumulate in the `NotificationEvent` table and tracks send any urgent emails directly via `lib/email.ts`.

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

Global search across people / projects / education / collab doc bodies. **Target**: Meilisearch self-hosted on Fly. **Priority**: deferred — not blocking initial release.

Initial release can ship without global search, or with rudimentary Postgres full-text search, and migrate to Meilisearch later. Yjs collab doc bodies require plain-text snapshotting on save regardless of backend (extract Tiptap plain text into a `searchText` column on `CollabDocumentVersion` or equivalent — same work whether using FTS or Meilisearch).

**Important: snapshotting starts in the Page Tree UX track, not the Search track.** Even though search itself ships later, the indexing pipeline (Tiptap → plain text on each save / version bump) needs to run as soon as collab pages exist, so that when the Search track lands, all historical content is already indexable. Implement the snapshot column + extraction job within the Page Tree UX track.

No new schema in the Search track itself; the snapshot column lives on the collab-doc model and ships with the Page Tree UX track.

### Audit Log

The existing `AuditLog` model is retained and extended with the new feature surface. Every privileged action that changes role state, project state, partner access, or staffing assignments writes an `AuditLog` row.

**Conventions** (apply to all new features):

- **Always log**: role grants/revokes (any of the assignment tables), tier changes, page archive/restore, project status changes (Active/Paused/Archived), partner invites + revocations, staffing cycle status transitions, staffing assignment confirms/declines, education application reviews, mentor note creation (not edits — Yjs handles version history), CA signing.
- **Never log** (out of scope for audit): doc edits (Yjs version history covers it), in-app navigation, search queries, dashboard pin changes.
- **Log shape**: `actorUserId` (who did it), `action` (string identifier — `staffing.assignment_confirmed`, `partner.invited`, `role.granted`, etc.), `targetType` + `targetId` (what was acted on), `metadata` (JSON payload), `createdAt`.

Audit log entries are surfaced in:
- Admin Console > Audit (existing — extend the filter set)
- Per-entity history views (e.g., a project's "History" tab shows project-scoped audit entries)

Log retention: indefinite for v1. Revisit if volume becomes a problem.

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
  // Circular FK with PartnerUser.partnerOrgId — Prisma supports this but
  // both relations need explicit names. Use onDelete: SetNull so removing
  // the contact user doesn't cascade-delete the org.
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

**Auth note**: Dartmouth NetID may persist post-grad but Google Workspace access can be revoked. Plan for **email migration** (alumni link a personal email to their existing User record). One profile, multiple auth methods. Implementation lands with the Alumni features track.

---

## Onboarding

Full post-hire onboarding track is deferred — not a priority for the first cycle. When designed, will likely be a checklist-track surfaced on the dashboard until complete. No schema changes anticipated for v1 (existing confidentiality agreement infra + the new Profile + UserCalendarLink + MentorshipPair models cover the touchpoints).

### Minimum viable onboarding (ships with the Staffing track)

The Staffing track requires every member to have:
- A linked Google Calendar (so free/busy works for staffing-driven meetings)
- A populated profile — at minimum `classYear`, `pronouns`, `photoUrl` set on User (staffing form references these)

To keep Staffing un-blocked without designing the full onboarding track, ship a **minimum onboarding banner** with the Staffing track: a persistent dashboard banner ("Complete your setup: 1 of 2") that links to the Settings sub-pages for the missing items. Tier resolution treats users with incomplete setup as `MemberPendingSetup` — a sub-tier of Member that has reduced sidebar visibility (Home + Settings only) until both items are done.

`setupComplete(userId)` is derived from existing tables — no new schema fields needed. See Tier Resolution.

CA signing is **not** part of minimum onboarding (the existing per-cycle CA system handles cycle-data access at the point of access, not as a general onboarding gate). Full onboarding checklist UI (with CA, mentor intro, project welcome doc, etc.) is deferred to a later track.

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

## Admin / Core CRUD Surface Inventory

Aggregated list of management UIs scattered across the doc. Each is a real page or modal that needs design + implementation. Surfaces them here so the team can scope admin work as a coherent block.

| Surface | Section | Tier | Where it lives |
|---|---|---|---|
| Term CRUD | Foundational | Admin | Admin Console > Terms |
| Domain CRUD (toggle active, edit display) | Foundational | Admin | Admin Console > Domains (existing route, extend) |
| DomainEligibility manage / promote | Roles | Domain Lead / Core / Admin | People > member profile > Eligibilities (with edit) |
| Member roster (add member, edit roles) | Admin | Admin | Admin Console > Members (existing route, extend) |
| AdminMembership grants | Admin | Admin | Admin Console > Members |
| CoreAssignment CRUD | Roles | Admin / Core | Core Hub > Setup > Core Members |
| DomainLeadAssignment CRUD | Roles | Admin / Core | Core Hub > Setup > Domain Leads |
| Project create / archive / pause | Projects | Partner Relations Lead / Core | Core Hub > Projects (or project's own settings) |
| ProjectTermStatus.isContinuing toggle | Projects | PM / Partner Relations Lead | Project Settings + Core Hub > Staffing setup |
| ProjectRoleRequest CRUD | Staffing | PM / Core | Project Settings > Roles + Core Hub > Staffing setup |
| StaffingCycle CRUD + state transitions | Staffing | Core | Core Hub > Staffing > Cycles |
| Staffing assignment dashboard (manual override) | Staffing | Core | Core Hub > Staffing > Cycles > {id} > Assignments |
| EducationOffering CRUD | Education | Education Lead / Instructor | Education > Manage |
| EducationApplication review | Education | Instructor / Education Lead | Offering > Roster |
| MentorNoteTemplate CRUD | Mentorship | Core | Mentorship > Templates |
| PageTemplate CRUD | Page Tree | Core | Lab > Resources > Templates |
| PartnerOrg + PartnerUser CRUD | Partner Portal | Partner Relations Lead / Core | Core Hub > Partners |
| ProjectPartner link / unlink | Partner Portal | Partner Relations Lead / Core | Project Settings + Core Hub > Partners |
| GroupDefinition CRUD (static groups) | Calendar | Core | Core Hub > Groups (or scheduling modal) |
| NotificationPreference (per-user defaults) | Notifications | self | Settings > Notifications |
| JobCodeLookup CRUD | Foundational | Admin | Admin Console > Payroll Codes |

This isn't an exhaustive list — implementation may add or split surfaces — but it's the starting set every team picking up an admin-shaped task should reference.

---

## v0: Foundational Migration (sequential, blocks everything)

**Strategy**: land the entire new schema, role-system refactor, and shared scaffolding in a single coordinated migration. After v0 ships, every remaining task is independently scoped — no track blocks another, no track requires its own migration, no track has to invent its own permission patterns.

v0 is the only sequential phase. It should be owned by one senior developer (or a tightly coordinated pair) and should land as a single PR (or a tight set of PRs in a feature branch) to avoid intermediate broken states.

### v0 Deliverables

**1. Full Prisma schema migration.** All ~40 new models documented in this plan, in one migration set:

- *Foundational role model*: Term, Domain (extend existing with `isInternProgram`), DomainEligibility, ProjectAssignment, MentorshipPair, DomainLeadAssignment (**extend** existing — add `termId`, backfill rows to current term), CoreAssignment, InstructorAssignment, AdminMembership, JobCodeLookup
- *Project workspace*: Project, ProjectTermStatus, ProjectRoleRequest, Sprint, Epic, Task, TaskAssignee, TaskComment (`ProjectRoleRequest` lives in the Projects schema but is consumed primarily by Staffing)
- *Education*: EducationOffering, EducationSession, EducationApplication, EducationApplicationQuestion, EducationApplicationAnswer, EducationAttendance, EducationAssignment, EducationSubmission, EducationAnnouncement
- *Staffing*: StaffingCycle, StaffingPreference, EssentialityForm, EssentialityRating, StaffingAssignment
- *Calendar*: UserCalendarLink, ScheduledMeeting, MeetingException, GroupDefinition
- *Page tree*: Page, PageTemplate
- *Mentorship*: MentorNote, MentorNoteTemplate
- *Notifications*: NotificationEvent, NotificationPreference
- *Partner*: PartnerOrg, PartnerUser, ProjectPartner
- *Existing-table extensions*: Profile fields on User (classYear, graduatedAt, pronouns, photoUrl, bioDocId, major, hometown, linkedinUrl, githubUrl, personalSite, timeZone); `Application.applicationType` enum

**2. Backfill scripts** (run as part of the migration):
- `DALIMember.roles[]` enum → `CoreAssignment` rows (for `Core` / `HiringLead` enum values) + `AdminMembership` rows (for `Admin`). Drop the column after backfill.
- Existing `DomainLeadAssignment` rows get `termId = currentTerm.id`.
- **Rename `memberId` → `userId` on `DomainLeadAssignment`, `CycleReviewer.daliMemberId`, `CycleInterviewer.daliMemberId`**. Backfill: each old `memberId` → corresponding `DALIMember.userId`. Per the verification SQL, 2 existing `DomainLeadAssignment` rows point at `DALIMembers` with NULL `userId` — resolve manually before the rename (the v0 owner inspects: delete if stale, or create User rows from `daliEmail` if active).
- The 116 `DALIMember` rows with NULL `userId` and no assignments stay as-is — `DALIMember` becomes "lab-member metadata" rather than "the lab-member entity," and these rows are just contact-info records until the person logs in.

**3. Full `lib/roles.ts` refactor.** Existing helpers (~90 LOC) are replaced — not augmented — with the new API:

```ts
// New canonical helpers
tier(userId, term?)                    // Admin | Core | Member | MemberPendingSetup | Alumni | Student | Partner
requireTier(request, "Core")           // route-level gate, throws redirect on mismatch
requireMember(request)                 // gate: any current-term role assignment OR Admin
requireScope(request, "PM", projectId) // action-level gate
isCore(userId, term?)                  // CoreAssignment(term) exists for this user
isLabMentor(userId, term?)             // mentor-collective check (see Foundational Schema)
loadActiveAssignments(userId, termId)  // batched loader for layout (parallel queries via Promise.all)
setupComplete(userId)                  // derived check: UserCalendarLink + Profile fields populated
currentTerm()                          // resolved from now() against Term.startDate/endDate

// Existing helpers rewritten (or replaced at call sites)
isAdmin(userId)        → AdminMembership query
isHiringLead(userId)   → isCore(userId) — title is NOT used. All Core members
                         have hiring-lead-equivalent access. Legacy ENV
                         override (ADMIN_USER_IDS) preserved. Helper name
                         kept for backward compat with existing hiring
                         routes; new code should prefer
                         requireTier(request, "Core") or isCore.
isDomainLead(userId)   → DomainLeadAssignment(current term) lookup, defaulting
                         to current term if `term` not passed
hasCycleAccess(userId, cycleId)  → unchanged shape, internals query new tables
```

**Note on the `isHiringLead` semantics change:** the old helper checked `DALIMember.roles[]` for the `HiringLead` enum value; the new helper resolves to "is Core for the current term." This is a deliberate broadening — Core has broad access (per the Roles & Terms model), and existing hiring routes that gate on `isHiringLead` should accept any Core member. If a specific route genuinely needs to restrict to *just* the Hiring Lead by title (rare), it can read `CoreAssignment.leadTitle` directly, but this should be the exception, not the rule.

All ~20 call sites of the existing helpers (`Layout.tsx`, `collabAuth.ts`, hiring routes, admin console, dev-login) get migrated as part of v0. Tests updated.

**4. `lib/notifications.ts` producer stub.** A small module exposing `emitEvent(type, recipients, payload)` that writes a `NotificationEvent` row. Delivery (in-app inbox UI, email digest, per-event preferences UI) is its own track post-v0; until that lands, events accumulate in the table and the existing `lib/email.ts` is used for any urgent emails. Feature devs in other tracks emit events from day 1.

**5. Empty route stubs** for new top-level sections — `/projects/*`, `/education/*`, `/people/*`, `/calendar/*`, `/mentorship/*`, `/core/*`, `/partner/*`. Each renders a placeholder. Gives feature tracks landing zones and avoids race conditions on `routes.ts`.

**6. Seed data:**
- `Domain` table seeded with the 17 domains documented in Foundational Schema → Domain.
- `Term` seeded with current term + next 4–8 terms.
- `JobCodeLookup` seeded with current Dartmouth payroll mappings.
- `PageTemplate` seeded with: Empty, Project Brief, Sprint Retro, Sprint Goals, Meeting Notes, Decision Log, Onboarding Doc.
- `MentorNoteTemplate` seeded with the lab's default note format.

**7. Documentation deliverables** (small written specs landing alongside v0):
- API endpoint conventions (where new endpoints live, naming, auth pattern)
- Notification event taxonomy registry (canonical list of event type strings + payload shapes)
- Audit log conventions (extending existing `AuditLog`)

**No user-facing changes** beyond placeholder pages. The existing app continues to function exactly as it does today.

---

## Post-v0: Independent Tracks

After v0 lands, every remaining piece of work is an **independent track**. No track blocks another. Tracks can be picked up in any order based on lab priority, and multiple tracks can run in parallel without colliding on schema or shared infrastructure.

### Tracks

| Track | What ships | Notes |
|---|---|---|
| **Intern→Full app** | `Application.applicationType=InternToFull` form variant; auto-fill from intern's existing profile; reuse existing review pipeline | Smallest track — schema delta is just an enum (already in v0); just builds the form variant |
| **Education — Miniseries** | Student catalog (`/portal/education`), apply flow with capacity + waitlist + auto-promote, instructor review interface, attendance taking, ad-hoc email via existing `lib/email.ts` | Workshop variant (`type=Workshop`, auto-approve) ships in same track |
| **Staffing flow** | Member preference form, PM essentiality form, Core assignment dashboard, rank-respecting auto-pairing algorithm (serial dictatorship — see Staffing section), manual override capability, UI-configurable cycles/role-requests, status state machine, minimum viable onboarding banner (calendar-linked + profile-complete checks) | |
| **Sidebar + layout shell** | Replace horizontal nav with collapsible sidebar; role-gated visibility per Navigation section; route stubs from v0 become real sidebar entries | Touches `Layout.tsx` — coordinate timing if multiple tracks are also editing layout |
| **Profile + People Directory** | Profile editing UI for v0 schema fields, member profile page (project history, eligibility matrix, education activity), directory with search/filter, Teams view | |
| **Project workspace UX** | Kanban board, sprint planning UI, task list, retros as templated collab docs, comments, history view | |
| **Page tree UX** | Per-workspace page tree, 2-level nesting, page templates picker, slash commands, DALI-native blocks (member mention, project link, page link, etc.), breadcrumb integration, archive/restore, collab-doc plain-text snapshot extraction (so Search has indexable history when it ships) | |
| **Calendar + scheduling** | Calendar view (Month/Week/Day/Agenda), scheduling modal, free/busy via Google API, event push via per-scope identities (domain-wide delegation), recurring meetings, personal overlay, calendar linking flow in Settings | |
| **Mentorship UX** | `/mentorship` section, weekly notes UI, template management UI, visibility gating via `isLabMentor`, weekly reminders | Reminders depend on Notifications delivery track |
| **Notifications delivery** | In-app inbox UI, email digest pipeline, per-event preferences UI in Settings, retrofit hiring emails to use the producer pattern | Producer stub exists from v0 — this track adds the consumers |
| **Partner portal** | PartnerOrg/User magic-link auth, partner-scoped project views, partner-tab in project workspaces, partner invite flow | |
| **Alumni features** | Alumni directory (gated), project portfolio, email migration flow, opt-in newsletter | |
| **Admin / Core CRUD surfaces** | The 20+ management UIs in Admin / Core CRUD Surface Inventory section — Term CRUD, Domain CRUD, eligibility promotion, role assignment management, etc. | Can be split: each surface is small enough to be its own sub-task |
| **Search (Meilisearch)** | Meilisearch deploy, indexing pipeline, global search UI | Plain-text snapshot pipeline ships with Page Tree UX track; this track wires up the search engine + UI |
| **Activity feed (if signal)** | Auto-events + member posts | Only proceeds if user demand emerges |

### Track-level guidance

**Soft sequencing (optional, not required):**
- *Page tree UX* before *Project workspace v2* lets retros use the page primitive natively. Without it, retros ship as raw collab docs and get migrated later.
- *Notifications delivery* before *Mentorship UX* gives weekly note reminders. Without it, reminders are deferred.
- *Sidebar + layout shell* before everything visible-to-members. Without it, new sections plug into the existing horizontal nav with temporary entries.

**Onboarding track** (full post-hire checklist) is **deferred** — confirmed not a priority. Minimum viable onboarding (banner + 3 setup checks) ships with the Staffing track.

**Activity feed** only proceeds if there's user signal that members want it.

### Track ownership

Each track is sized for one developer or a small team to own end-to-end. Track owners are responsible for:
- Implementing all UI + API endpoints for the track
- Using the v0 helpers (`requireTier`, `requireScope`, `emitEvent`, etc.) consistently
- Writing tests (unit + E2E for user-facing flows)
- Updating relevant docs

Tracks should not introduce new schema. If a track discovers it needs a model that's not in v0, that's a signal to (a) check whether the requirement was overlooked and amend the doc, or (b) propose it as a follow-up migration with team review — never just add it ad-hoc within a feature track.
