# DALI OS Roadmap

_Last updated: July 4, 2026_

---

## Shipped & Working

| Area | Notes |
|---|---|
| **Hiring** | Full lifecycle — cycles, reviews, delibs, interviews, waitlists, decisions, analytics, CA, email templates |
| **Staffing** | Production-ready — cycle setup, member preference form, PM essentiality, auto-pairing algorithm, Slack/Google group sync |
| **Project workspace** | Kanban, epics, sprints, tasks, GitHub sync, files, pinned/preview tab workspace |
| **Members directory + Groups** | Searchable directory with term filter, view toggle, role pills; group management with static + dynamic groups |
| **Calendar** | Weekly view, scheduling modal, group availability, Google Calendar push, recurring meetings, personal overlay (opt-in) |
| **MCP server** | 37 tools (tasks, sprints, epics, pages, meetings, notifications, directory search), 5 resources, 6 AI prompts (standup, retro, sprint-planning, project-status, meeting-prep, weekly-digest) |
| **Desktop app** | Tauri 0.1.1 — macOS + Windows + Linux download page, auto-update, native menu, tray, device pairing |
| **Admin Console** | Members, domains, announcements, payroll export, activity log |
| **Forms system** | Folders, versioned forms, submissions, staffing cycle bindings |
| **Collab doc infra** | Hocuspocus + Yjs + Tiptap, doc versions, tags, comments, split-tab editor |
| **Internal processes** | Onboarding, transfer, level-up, JobX |
| **Partner applications** | PartnerApplication schema + review pipeline (separate from full partner portal) |
| **Notifications** | In-app inbox, RSVP to events |
| **Foundational schema** | All 40+ models: Term, Domain, DomainEligibility, ProjectAssignment, CoreAssignment, AdminMembership, MentorshipPair, StaffingCycle, Page, MentorNote, ScheduledMeeting, etc. |

---

## In-Flight PRs

| PR | Track | Priority |
|---|---|---|
| [#846](https://github.com/DALI-OS/dali-os/pull/846) | **Education (LMS)** — catalog → discussions → grading, @-mentions | High |
| [#828](https://github.com/DALI-OS/dali-os/pull/828) | **Mentorship** — weekly notes hub, templates, auto-pairing | High |
| [#805](https://github.com/DALI-OS/dali-os/pull/805) | **Calendar** — timesheet tab, month/day/agenda views | Medium |
| [#739](https://github.com/DALI-OS/dali-os/pull/739) / [#737](https://github.com/DALI-OS/dali-os/pull/737) | **Alumni** — isAlumni derivation + Dartmouth directory sync | Medium (foundation) |
| [#885](https://github.com/DALI-OS/dali-os/pull/885) | **MCP OAuth** — allow claude.ai web connector | Small fix |
| [#589](https://github.com/DALI-OS/dali-os/pull/589) | **Hiring cycle redesign** — workflow-aligned tabs + phase strip | Low (needs rewrite) |

---

## Near-Term (1–2 months)

### 1. Education (LMS) — PR #846

Ship the mini course management system, concurrent with Page Tree UX (they share the same collab doc primitives).

**Student-side (`/portal/education`)**
- Browse catalog of miniseries + workshops
- Application/RSVP flow with capacity limits and waitlist auto-promotion
- My Learning view — enrolled offerings, session materials, assignment submissions

**Instructor-side**
- Offering builder — structured metadata + collab doc syllabus
- Session-by-session content (each is a collab doc)
- Roster + attendance taking
- Assignment creation + grading
- Announcement broadcast (emits NotificationEvent)

**Education Lead**
- Offering CRUD, review/approve applications, analytics

---

### 2. Page Tree UX _(ship concurrently with Education)_

Workspace-level page tree inside Projects and Education Offerings. This is the Notion-replacement layer.

- 2-level nesting (workspace → top-level page → one level of children)
- Template picker — Empty, Project Brief, Sprint Retro, Sprint Goals, Meeting Notes, Decision Log, Onboarding Doc
- Slash commands + DALI-native blocks: member @-mention, project link, page link, deadline, poll, calendar embed, task list embed
- Breadcrumb integration (canonical path, not navigation history)
- Archive/restore with soft delete
- Plain-text snapshot extraction on save (pre-indexes content for future Search)

---

### 3. Mentorship UX — PR #828

- `/mentorship` hub — per-mentee card view with weekly note history
- Create/edit weekly note seeded from lab-wide template (one note per mentee per week)
- Template management for Core (`/mentorship/templates`)
- Visibility gating via `isLabMentor` (mentor collective — not mentee-readable)

---

### 4. Calendar Views — PR #805

- Month, Day, Agenda views (week is done)
- Personal Google Calendar overlay (opt-in, off by default)
- Timesheet tab + JobX export bridge

---

## Medium-Term (2–4 months)

### 5. Partner Portal

Full external-facing portal for sponsor orgs.

- Magic-link auth (primary) + Google OAuth (repeat sign-in) for PartnerUser accounts
- Scoped project view — projects their org funds: overview, sprint summaries, public docs
- Partner meeting calendar — meetings scoped to their org
- Partner tab inside project workspaces
- PartnerOrg + PartnerUser CRUD for the Partner Relations Lead

---

### 6. In-Editor AI Slash Commands

AI writing assistance embedded directly in the Tiptap collab editor — in-app via the Anthropic API (not MCP client, so it works for every member without external setup).

**Slash commands:**
- `/ai draft` — generate a doc from a plain-English description ("write a sprint retro outline for a mobile app project")
- `/ai continue` — continue writing from the current cursor position using surrounding context
- `/ai summarize` — condense the current page into 3–5 bullet points, suitable for sharing
- `/ai extract tasks` — parse a meeting notes doc and create real Task rows from action items (integrates with the Tasks schema)

**Implementation notes:**
- Trigger from the existing Tiptap slash command menu (`/` prefix)
- Stream response from Anthropic API via a new `POST /api/ai/collab` server action
- Respect document-level permissions (same auth as the collab doc itself)
- `extract tasks` needs `projectId` context — surface only when inside a Project workspace page

---

### 7. Core Hub

Lab-wide ops surface for Core members and Admins.

- **Analytics** — lab-wide dashboards: member stats by term, project health, education participation, hiring funnel. No new schema — pulls from existing data.
- **Resources** — Lab workspace page tree (policies, engineering guidelines, onboarding docs, templates). Managed by Core; this is the closest surface to pure Notion.

---

### 8. Desktop App Expansion

- Native push notifications wired to DALI NotificationEvents (task assigned, sprint deadline, meeting invite)
- Deep-link click-through: tray notification → opens the relevant task/project/document in the app
- Offline document reading (cached collab doc snapshots)

---

## Deferred / Later

| Track | Blocker / Notes |
|---|---|
| **Alumni full features** | PRs #739/#737 lay the foundation; directory, portfolio, opt-in newsletter deferred until foundation is merged |
| **Search (Meilisearch)** | Needs page-tree plain-text snapshots to exist first (ships with Page Tree UX track) |
| **Lab graph / connections view** | Experimental (PR #854 open). Revisit after Education + Mentorship land. |
| **Activity feed** | Only if user demand signals emerge |
| **Full onboarding checklist** | Deferred — MVO (minimum viable onboarding banner) ships with Staffing |

---

## AI Scope — Confirmed Decisions

| Feature | Decision |
|---|---|
| In-editor AI slash commands (`/ai draft`, `/ai continue`, `/ai summarize`, `/ai extract tasks`) | **In scope** — Medium-Term track |
| MCP prompts (standup, retro, sprint-planning, etc.) | **Shipped** — add more incrementally as features land |
| Hiring delibs AI synthesis | **Out of scope** |
| Mentor note AI prompts | **Out of scope** |
| Task generation from prose (sprint planning UI) | Revisit after page tree + partner portal land |
| Sprint-to-partner update generation | Revisit after partner portal lands |

---

---

## Mobile App (Parallel Track)

A sidekick app — not a 1-1 port of the web app. Designed for in-the-moment use: check in, get notified, triage tasks, glance at your day. Can be owned independently while web tracks continue.

**Tech stack**: React Native (Expo). Authenticates via the existing DALI OAuth server (`/oauth/*`).

### Architecture

MCP is designed for AI agents that discover and select tools dynamically — not for UI clients that already know what data they need. The mobile app calls a thin REST API layer instead. The MCP `run*` functions are already decoupled from the protocol layer, so they're reused directly:

```
Claude Desktop  →  POST /mcp           →  runListMyTasks()
Mobile app      →  GET /api/mobile/tasks  →  runListMyTasks()  ← same function
```

No business logic is duplicated. The mobile API layer is just auth + param parsing on top of the existing `run*` functions.

**Structured data** (tasks, meetings, notifications):
```
Mobile → GET /api/mobile/tasks
       → GET /api/mobile/meetings
       → GET /api/mobile/notifications
       → thin REST handlers calling existing run* functions from mcp/tools/
```

**AI-powered features** (My Day summary):
```
Mobile → POST /api/ai/mobile { prompt: "my-day" }
       → Server loads context directly (same DB queries as MCP resources)
       → Calls Anthropic API server-side
       → Streams natural language response back
```
Anthropic key stays on the server. Mobile renders a string. No LLM on the client.

**Push notifications**: Expo push token stored server-side; fires when `NotificationEvent` rows are created.

---

### v1 Features

**Attendance check-in (lab-wide events)**
- Replaces the current QR code → Google Form workaround
- When a lab event is active, members get a push: "Check in to [event name]"
- App verifies presence via WiFi SSID match (DALI network) *or* GPS radius of the building — no QR scan, no form
- One tap → attendance record written
- Manual "I'm here" fallback for ambiguous signal (visitors on network, GPS drift)
- Organizer sees live roster in the web app as people check in
- Schema: reuses `EducationAttendance` pattern; lab events need a lightweight `LabEventAttendance` model

**Push notifications**
- Task assigned / @mentioned / status changed on a watched task
- Sprint deadline in 24h
- Meeting in 15 min — with "On my way" / "Can't make it" quick reply
- @mention in a collab doc
- Lab event starting (triggers attendance check-in flow)

**My Tasks**
- Active sprint tasks assigned to me, grouped by status
- Swipe to update status (Todo → InProgress → Done)
- Quick comment with one tap
- Full task detail stays on desktop; mobile is triage only

**My Day at a Glance**
- AI-synthesized card at the top: "2 tasks in review, partner meeting at 2pm, sprint closes Friday"
- Calls `POST /api/ai/mobile { prompt: "my-day" }` using existing `project-board` + `list-my-upcoming-meetings` + `announcements-active` MCP context
- Below the summary: structured lists for meetings, tasks, and pending notifications

---

### Schema additions needed

```prisma
// Lightweight lab-wide event (distinct from EducationOffering + ScheduledMeeting —
// these are all-lab or social events: all-hands, demos, food events, etc.)
model LabEvent {
  id          String   @id @default(cuid())
  title       String
  startsAt    DateTime
  endsAt      DateTime
  locationHint String? // e.g. "Sudikoff 007"
  createdById String
  createdAt   DateTime @default(now())

  attendances LabEventAttendance[]
}

model LabEventAttendance {
  id         String              @id @default(cuid())
  eventId    String
  userId     String
  method     AttendanceMethod
  checkedInAt DateTime           @default(now())

  event LabEvent @relation(fields: [eventId], references: [id])
  user  User     @relation(fields: [userId], references: [id])

  @@unique([eventId, userId])
}

enum AttendanceMethod {
  Wifi      // matched DALI WiFi SSID
  Gps       // within GPS radius
  Manual    // tapped "I'm here" manually
}

// Device token for Expo push notifications
model MobilePushToken {
  id        String   @id @default(cuid())
  userId    String
  token     String   @unique  // Expo push token
  platform  String            // "ios" | "android"
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt

  user User @relation(fields: [userId], references: [id])
}
```

---

### Server additions needed

- `POST /api/mcp/call` — authenticated MCP tool proxy for mobile
- `POST /api/ai/mobile` — AI agent endpoint (Anthropic + MCP context, streamed)
- `POST /api/mobile/push-token` — register/update Expo push token
- `GET /api/mobile/lab-events/active` — active events for attendance check-in prompt
- `POST /api/mobile/lab-events/:id/checkin` — write attendance with method
- Push dispatch logic wired into `NotificationEvent` creation

---

### What stays on desktop / web only

- Full collab doc editing (complex Tiptap interactions)
- Staffing cycle management and assignment board
- Hiring review and delibs
- Admin Console
- Education instructor tools and course builder
- Calendar scheduling modal (complex free/busy grid)

---

## Open Questions / To Revisit

- **Hiring cycle redesign (PR #589)**: working but code quality needs a rewrite — revisit when there's bandwidth.
- **Lab graph (PR #854)**: keep experimental; evaluate interest once core platform tracks land.
- **Windows desktop build**: download page links `DALI-OS-windows.exe` — confirm CI pipeline is producing the artifact consistently.
