# DALI OS Navigation & UX Expansion Plan

## Context

DALI OS is expanding from a hiring-only platform into a comprehensive lab management system. Hiring becomes one section among many. This document captures the full navigation structure, user experiences, role model, and UX flows for the expanded platform.

---

## User Tiers

There are four distinct user tiers, each with a different experience:

| Tier | Who | Auth | Nav Style | Sees |
|---|---|---|---|---|
| **Dartmouth Student** | Any Dartmouth student (non-DALI) | CAS / Google | Minimal top bar | Homepage, Education catalog, Applications (when open), Profile |
| **DALI Member** | Active lab members | Google OAuth / CAS | Left sidebar | Home, Projects, Education, Profile |
| **Core Member** | Any lead (~20 rotating titles) | Same | Left sidebar + Core | Everything above + Core Hub |
| **Admin** | Full-time staff | Same | Left sidebar + Core + Admin | Everything above + Admin Console |

Additional **role overlays** that gate specific features:
- **Hiring roles** (hiring lead, domain lead, reviewer, interviewer) → Hiring section visible
- **Mentor** → Mentorship view visible
- **Education Lead** → Education management tools
- **Partner Relations Lead** → Project setup tools in Core Hub
- **Project Manager** → PM-specific tools within their project + essentiality forms in Core Hub/Staffing

---

## Navigation Structure

### DALI Members — Collapsible Left Sidebar

The sidebar replaces the current horizontal top bar. It is collapsible to icon-only mode.

```
┌──────────────────┬─────────────────────────────────┐
│ DALI             │                                 │
│                  │                                 │
│  🏠 Home         │                                 │
│  📁 Projects     │                                 │
│  📚 Education    │        Page Content             │
│  👤 People       │                                 │
│  📅 Calendar     │                                 │
│  👥 Hiring    *  │                                 │
│                  │                                 │
│  🔷 Core      *  │                                 │
│  ⚙  Admin     *  │                                 │
│                  │                                 │
│  [+ Schedule]    │  ← global quick action          │
│  👤 Jane D.      │                                 │
└──────────────────┴─────────────────────────────────┘

* = role-gated (only visible to qualifying users)
```

**Collapsed mode** — icons only, expands on hover or toggle:
```
┌────┐
│ D  │
│ 🏠 │
│ 📁 │
│ 📚 │
│ 👤 │
│ 📅 │
│ 👥 │
│ 🔷 │
│ ⚙  │
│ +  │
│ JD │
└────┘
```

**Sub-navigation** — clicking a section expands its sub-items inline. Only the active section is expanded:

```
┌──────────────────┬─────────────────────────────────┐
│ DALI             │                                 │
│                  │                                 │
│   Home           │                                 │
│ ▼ Projects       │        Page Content             │
│    My Projects   │                                 │
│    All Projects  │                                 │
│   Education      │                                 │
│   People         │                                 │
│   Calendar       │                                 │
│   Hiring         │                                 │
│   Core           │                                 │
│                  │                                 │
│   Jane D.        │                                 │
└──────────────────┴─────────────────────────────────┘
```

**Mobile** — sidebar becomes a hamburger menu / slide-out drawer.

### Dartmouth Students — Minimal Top Bar

Students do NOT get a sidebar. Clean, simple experience:

```
┌─────────────────────────────────────────────────┐
│ DALI Lab                        Jane D. [Logout]│
├─────────────────────────────────────────────────┤
│                                                 │
│  Welcome back, Jane                             │
│                                                 │
│  ┌─ Open Applications ────────────────────────┐ │
│  │ 25S Application – Apply by May 15       →  │ │
│  └────────────────────────────────────────────┘ │
│                                                 │
│  ┌─ Upcoming Miniseries ─────────────────────┐  │
│  │ Intro to React (May 12–26)    [Register]  │  │
│  │ Data Viz Workshop (Jun 2)     [Register]  │  │
│  └───────────────────────────────────────────┘  │
│                                                 │
│  ┌─ Your Progress ───────────────────────────┐  │
│  │ Intro to ML – 4/6 sessions attended       │  │
│  └───────────────────────────────────────────┘  │
│                                                 │
└─────────────────────────────────────────────────┘
```

**Student pages** (navigated via links/cards from homepage + breadcrumbs):
- **Homepage** — open applications, upcoming miniseries, progress summary
- **Education catalog** — browse all miniseries, register, see session details
- **Application flow** — multi-step application form (when hiring cycle is open)
- **Student profile** — education history, completed series, attendance record

---

## Section Breakdown

### 1. Home / Dashboard

**Who sees it**: All DALI members
**Default landing page** after login.

Auto-populated sections based on user's roles and activity:
- **Your Projects** — active project(s) with recent activity / upcoming deadlines
- **Upcoming** — calendar items: interviews, workshops, meetings, deadlines
- **Education** — series you're teaching or attending, next session
- **Hiring** (if applicable) — pending reviews, upcoming interviews
- **Announcements** — lab-wide updates

**Configurability**: Users can pin favorite pages/sections for quick access. Start with "smart defaults + pins" — system auto-populates, users add pins. Consider widget grid as a future enhancement.

### 2. Projects

**Who sees it**: All DALI members
**Sub-items in sidebar**:
- All Projects (directory of all DALI projects, current and past — user's projects highlighted)

**Clicking into a project opens a workspace** with its own internal tabs/pages:
- **Overview** — project description, partner info, timeline, key links
- **People** — current team roster, roles, mentor assignments
- **Sprints** — sprint board / timeline
- **Tasks** — task list with epics grouping
- **History** — past terms, past teams, project evolution

**Role-specific features within Projects**:
- **PMs**: Team essentiality forms (for continuing projects during staffing season), project settings
- **Mentors**: See mentee info and evaluation links within the People tab

**Project lifecycle**:
- Projects can span 1 term to many years
- Each term has a distinct team roster
- Historical data preserved (past terms, past team members)

### 3. Education

**Who sees it**: All DALI members (and Dartmouth students via their own view)

**For regular members** (sidebar sub-items):
- **Browse** — miniseries catalog, upcoming workshops
- **My Learning** ��� series you're enrolled in, progress, attendance
- **Teaching** — series you're teaching (if applicable)

**For Education Leads** (additional sub-items):
- **Manage Series** — create/edit miniseries, set schedules, manage curriculum
- **Attendance** — track attendance across all series
- **Analytics** — participation rates, completion stats

**Key features**:
- Miniseries registration and scheduling
- Session-by-session attendance tracking
- Progress linked to member/student profiles
- DALI members and Dartmouth students both participate (DALI members via sidebar, students via their own education catalog view)

### 4. Hiring

**Who sees it**: Only members with hiring roles (hiring lead, domain lead, reviewer, interviewer for active cycle)
**Not visible** to members not involved in hiring.

**Sub-items in sidebar** (role-gated as today):
- **Reviews** — all hiring-involved members
- **Domain** — domain leads only
- **Cycles** — hiring leads only
- **Library** — hiring lead, domain lead, admin
  - Challenges, Rubrics, Confidentiality Agreements
- **Emails** — hiring leads only

This is the existing hiring flow, largely unchanged. It just moves from "the whole app" to "one section in the sidebar."

### 5. Core Hub

**Who sees it**: Core members (any lead role — ~20 rotating titles, changes year to year)

The Core Hub is the operational center for student leaders running the lab.

**Sub-items in sidebar**:
- **Staffing** — the full staffing workflow:
  - Project setup (partner relations lead creates projects with role requirements)
  - Staffing form management (hiring lead creates/sends availability + preference forms)
  - PM essentiality forms (PMs indicate how critical each team member is)
  - Assignment dashboard (core members review preferences and assign members to projects)
- **Analytics** — lab-wide reporting: member stats, project health, education participation
- **Resources** — documentation of core and DALI policies, links to various operation hubs

**Role-specific visibility within Core Hub**:
- Partner Relations Lead: project setup tools
- Hiring Lead: staffing form creation
- PMs: essentiality form access
- All core members: assignment dashboard, analytics, resources

### 6. Admin Console

**Who sees it**: Admins only (full-time staff). Admin is a superset of Core — admins also see the Core Hub.

**Sub-items in sidebar** (as today, potentially expanded):
- **Members** — user management, role assignments
- **Domains** — domain configuration
- **Party** — party analytics
- (Future: system settings, permissions management, etc.)

### 7. People

**Who sees it**: All DALI members

The People section is the social/discovery layer of the platform — browse members, see who's working on what, and stay aware of lab activity.

**Sub-items in sidebar**:
- **Directory** — searchable/filterable list of all DALI members (by name, role, project, term, skills)
- **Teams** — browse current project teams and their rosters
- **Feed** — activity/social feed: project updates, achievements, announcements, milestones

**Member profile cards** (from directory/team views) link to full profiles showing:
- Current project(s) and role
- Education activity (teaching/attending)
- Term history
- Bio, skills, contact info

**Contextual integration**: People appear throughout the app — project team pages, education rosters, etc. The People section is the dedicated hub for browsing and discovery.

---

## Scheduling (Reusable Component)

Scheduling is a **platform-wide capability**, not a standalone section. It can be triggered from anywhere and optionally linked to any entity in the system.

### Entry Points

1. **Global quick action** — `[+ Schedule]` button in the sidebar (always visible). Opens the scheduling modal for ad-hoc meetings.
2. **Contextual triggers** — "Schedule meeting" buttons within:
   - Project workspace → pre-fills team members
   - People directory → pre-fills selected person
   - Education series → pre-fills teaching team or attendees
   - Mentorship → pre-fills mentor + mentee
   - Any group context

When triggered from context, participants and entity link are pre-filled.

### Scheduling Flow

```
┌─────────────────────────────────────────────┐
│ Schedule a Meeting                          │
│                                             │
│ Title: [Weekly sync________________]        │
│                                             │
│ Link to: [Project Alpha      ▼]  (optional)│
│                                             │
│ Add people: [search / select from team...]  │
│ ┌───────┬───────┬───────┬───────┬───────┐   │
│ │ Alice │ Bob   │ You   │       │       │   │
│ └───────┴───────┴───────┴───────┴───────┘   │
│                                             │
│ Finding mutual free time...                 │
│                                             │
│ ┌─────┬─Mon──┬─Tue──┬─Wed──┬─Thu──┬─Fri─┐  │
│ │ 9am │  ██  │  ░░  │  ░░  │  ██  │ ░░  │  │
│ │10am │  ░░  │  ██  │  ░░  │  ░░  │ ░░  │  │
│ │11am │  ░░  │  ░░  │  ██  │  ░░  │ ██  │  │
│ │12pm │  ██  │  ░░  │  ██  │  ░░  │ ░░  │  │
│ │ 1pm │  ░░  │  ░░  │  ░░  │  ██  │ ░░  │  │
│ └─────┴──────┴──────┴──────┴──────┴─────┘  │
│ ░░ = everyone free   ██ = conflict          │
│                                             │
�� Best available:                             │
│  ✓ Tue 9-10am  ✓ Wed 9-11am  ✓ Fri 9-10am │
│                                             │
│ [Select time and send invites →]            │
└─────────────────────────────────────────────┘
```

### Full Flow

1. **Trigger** — global button or contextual trigger
2. **Configure** — add title, select participants, optionally link to entity (project, series, etc.)
3. **Find time** — system reads linked calendars for all participants, shows availability grid
4. **Suggest** — system highlights best mutual free times
5. **Confirm** — organizer picks a time slot
6. **Create** — system creates a calendar event and sends invites to all participants

### Calendar Integration

- **Primary**: Google Calendar (most members use this)
- **Also supports**: Outlook/Microsoft 365
- **Multiple calendars per account**: Users can link multiple calendars (personal, school, work). Free/busy is computed across all linked calendars.
- Calendar linking happens in user Settings (one-time setup via OAuth)

### Entity Linking

Scheduled meetings can be linked to:
- A **project** — shows up in that project's workspace
- An **education series** — shows up in the series schedule
- A **mentorship pair** — shows up in mentor/mentee views
- **Nothing** (ad-hoc) — shows up only on the dashboard/calendar

Linked meetings surface in the relevant context so teams can see all their scheduled meetings in one place.

---

### 8. Profile (Bottom of Sidebar)

**Clicking user name/avatar** opens profile area:
- **My Profile** — personal info, photo, bio, roles, term history
- **Settings** — notification preferences, dashboard pins, account settings
- **Logout**

**Profile as a connected record** — a member's profile ties together:
- Project history (which projects, which terms, which role)
- Education history (series attended/taught, progress)
- Mentorship history (mentors and mentees, evaluations received/given)
- Hiring participation (if applicable)
- Staffing preferences (past availability/preference forms)

---

## Mentorship

Mentorship is project-scoped (each member has a mentor on their project team) but has lab-wide visibility needs for mentors.

**For mentees**: Mentor info appears on their project's People tab and on their profile.

**For mentors**: A mentor-specific view where they can:
- See all their current mentees (potentially across projects)
- Fill out evaluations for each mentee
- View past evaluations they've submitted

**Where this lives**:
- Mentor evaluations are accessible from the **project workspace** (People tab → mentee → evaluation)
- Mentors also get a **"Mentorship" sub-item** under their profile or as a dashboard widget, aggregating all their mentees in one place
- Core Hub may have a lab-wide mentorship overview (assign mentors, view all evaluations)

---

### 9. Calendar

**Who sees it**: All DALI members (top-level sidebar item)

A lab-wide calendar that aggregates all DALI events into a native, filterable view. DALI OS is the source of truth for DALI events; Google Calendar is the distribution channel (invites, reminders, mobile access).

**Views**: Month, Week, Day, and Agenda (scrollable list). User's last-used view is remembered.

**Event sources** (everything on the calendar):
- **Lab-wide events** — all-hands, socials, demos, deadlines, announcements
- **Project meetings** — standups, partner meetings, sprint reviews
- **Education sessions** — miniseries sessions, workshops, office hours
- **Personal/role events** — interviews, mentor check-ins, staffing deadlines

**Creating events**:
- **Via the scheduling component** (already designed) — for meetings with multiple people. Writes to DALI DB + pushes to Google Calendar via API.
- **Via quick-add** — streamlined modal for simple events (lab-wide announcements, deadlines) that don't need the full scheduling flow. Also syncs to Google Calendar.
- No drag-to-create or drag-to-resize on the calendar grid itself (avoids rebuilding Google Calendar).

**Filtering — two layers**:

1. **Category toggles** — show/hide broad event types, color-coded:
   - Lab Events (blue)
   - Projects (green)
   - Education (purple)
   - Hiring (orange)
   - Personal (gray)
   Preferences saved per user.

2. **Calendar subscriptions** — within categories, members subscribe to specific calendars:
   - Each project has its own calendar
   - Each education series has its own calendar
   - Lab-wide events are a single shared calendar
   - **Auto-subscribe** by default: your project(s), your education series, lab-wide events
   - Members can manually subscribe/unsubscribe to others (e.g., follow another project's calendar)

**Google Calendar integration**:
- DALI events are pushed to Google Calendar via API (write) so they appear on members' phones, get reminders, etc.
- Members can optionally overlay their personal Google Calendar events (read-only) for context when viewing the DALI calendar
- Supports multiple calendar providers (Google + Outlook) and multiple calendars per account
- Calendar linking happens in user Settings (one-time OAuth setup)

**Technical approach**:
- React calendar component via library (FullCalendar or react-big-calendar)
- Events stored in DALI DB with metadata (category, linked entity, participants)
- Google Calendar API for read (personal overlay) and write (push DALI events)
- Outlook Calendar API as secondary provider

---

## Role-Gated Sidebar Summary

What each user tier sees in the sidebar:

```
                        Student  Member  Core   Admin
                        (no bar) (sidebar)(sidebar)(sidebar)
─────────────────────────────────────────────────────────
Home / Dashboard                   ✓       ✓       ✓
Projects                           ✓       ✓       ✓
Education                          ✓       ✓       ✓
People                             ✓       ✓       ✓
Calendar                           ✓       ✓       ✓
Hiring              (apply flow)   *       *       ✓
Core Hub                                   ✓       ✓
Admin Console                                      ✓
Schedule (action)                  ✓       ✓       ✓
Profile                            ✓       ✓       ✓
─────────────────────────────────────────────────────────

* = only if user has an active hiring role (lead, reviewer, interviewer, domain lead)
```

---

## Routing Structure (High-Level)

```
/                           → Dashboard (members) or Student homepage (students)
/projects                   → All projects directory
/projects/:id               → Project workspace
/projects/:id/overview      → Project overview
/projects/:id/people        → Team roster
/projects/:id/sprints       → Sprint board
/projects/:id/tasks         → Task list
/education                  → Education hub (browse, my learning, teaching)
/education/series/:id       → Miniseries detail
/people                     → Member directory
/people/:id                 → Member profile (public view)
/people/teams               → Browse teams by project
/people/feed                → Activity / social feed
/calendar                   → Calendar (month view default)
/calendar/week              → Week view
/calendar/day               → Day view
/calendar/agenda            → Agenda / list view
/hiring/*                   → Existing hiring routes (unchanged)
/core                       → Core Hub
/core/staffing              → Staffing dashboard
/core/analytics             → Lab analytics
/core/resources             → Policies and links
/admin-console/*            → Existing admin routes (unchanged)
/profile                    → My profile
/profile/settings           → Account settings, calendar linking
/profile/mentorship         → Mentor view (mentees + evaluations)
/schedule                   → Scheduling modal (also accessible as overlay from anywhere)
/portal                     → Student homepage (Dartmouth students)
/portal/education           → Student education catalog
/portal/apply               → Application flow
/portal/profile             → Student profile
```

---

## Implementation Phases

### Phase 1: Sidebar + Layout Shell
- Build `Sidebar` component (collapsible, expandable sections, role-gating)
- Replace `Layout.tsx` horizontal nav with sidebar
- All existing routes continue to work — just navigation chrome changes
- Placeholder pages for new sections

### Phase 2: Dashboard
- Build the dashboard at `/`
- Auto-populated sections based on roles
- Pinning functionality (stored per user in DB)
- Update login redirect from `/hiring/reviewer` → `/`

### Phase 3: Role Model Expansion
- Extend `roles.ts` with core member detection (any lead = core)
- Add education lead, mentor, PM roles
- Update sidebar visibility based on expanded roles

### Phase 4: Student Experience Redesign
- Redesign applicant layout → student layout (minimal top bar)
- Student homepage with applications + education catalog
- Student profile with progress tracking

### Phase 5: People / Directory
- Member directory with search/filter
- Team browsing by project
- Activity / social feed
- Member profile public view

### Phase 6: Projects
- Project directory and workspace pages
- Project data model (epics, sprints, tasks, team rosters, term history)
- PM-specific tools

### Phase 7: Education
- Education routes for members (browse, my learning, teaching)
- Education lead management tools
- Miniseries CRUD, registration, attendance tracking
- Progress linked to profiles

### Phase 8: Calendar + Scheduling
- Calendar linking (Google Calendar + Outlook OAuth integration)
- Support for multiple calendars per provider and multiple providers per account
- Calendar view component (FullCalendar or react-big-calendar) with month/week/day/agenda views
- Event storage in DALI DB with metadata (category, linked entity, participants)
- Category toggles (Lab, Projects, Education, Hiring, Personal) with color coding
- Calendar subscription model (auto-subscribe to your project/series, manual subscribe to others)
- Google Calendar API write-back (push DALI events) + read (personal overlay)
- Scheduling modal component (reusable across all contexts)
- Free/busy computation across all participants' linked calendars
- Entity linking (associate meetings with projects, series, mentorship, etc.)
- Quick-add modal for simple events (lab-wide, deadlines)
- Full scheduling flow: find time → suggest → confirm → create event + send invites
- Contextual triggers (pre-filled from project pages, people, education, etc.)

### Phase 9: Core Hub
- Core Hub with staffing, analytics, resources
- Staffing workflow (project setup, forms, assignment)
- PM essentiality forms
- Policy docs and links

### Phase 10: Mentorship
- Mentor evaluation system
- Mentor view (all mentees, evaluations)
- Integration with project People tab and profiles

### Phase 11: Profiles
- Unified member profile tying together all data
- Project history, education history, mentorship, hiring participation
- Student profiles (education-focused)
