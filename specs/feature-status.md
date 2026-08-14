# DALI OS — Feature Status Tracker

_Last reconciled: 2026-08-01. Built by auditing the actual code (routes, jobs, notification registry, MCP tools, auth, collab) against the planning specs. Where a spec's stated status disagreed with the code, **the code wins** — several specs are stale (see [§7](#7-stale--superseded-specs))._

**Legend:** ✅ shipped & working · 🟡 partial / in-flight · ⬜ planned, not built · 🐞 known bug

---

## 1. Core platform & cross-cutting systems

### Auth & identity ✅
- ✅ DB-backed sessions (`__dali_sid`, rolling 30-day TTL, RBAC: Core / DomainLead / Member / ProjectMember)
- ✅ Google OAuth 2.0 sign-in (OIDC ID-token verification)
- ✅ Dartmouth CAS SSO (ticket validation, links with Google for dual identity)
- ✅ Dartmouth API service JWT (People API / membership sync)
- ✅ DALI-as-OAuth-provider (authorization-code + PKCE, client registration, consent screen, scopes, revocation) — powers MCP & connected apps
- ✅ Applicant / portal auth (`user.type === "applicant"` → `/portal`)
- ✅ Partner portal auth (`PartnerUser`-row guard on `/partner`)
- ✅ Desktop device pairing (device-code claim + single-use handoff code)
- ✅ Public API shared-secret auth (`SHOWCASE_API_SECRET`, constant-time compare)
- ✅ Gmail send-as (Core-only OAuth for per-context send identities)
- ✅ Active-session management UI (Settings → Sessions)

### Background jobs ✅
In-process 60s runner, Postgres CAS lease on `ScheduledJob`, per-job toggles/intervals in Admin → Jobs. **14 jobs, all enabled by default:**
- ✅ `task-due-reminders`, `meeting-reminders`, `interview-reminders`
- ✅ `scheduled-announcements`, `form-windows` (auto publish/unpublish)
- ✅ `notification-digest-daily`, `notification-digest-weekly` (self-gate on wall clock)
- ✅ `session-feedback-sweep` (education feedback requests)
- ✅ `sprint-lifecycle` (auto-activate/close sprints, roll unfinished tasks, Slack summary)
- ✅ `standup-prompts` (weekday Slack standup per active project)
- ✅ `retention-janitor`, `task-auto-archive`
- ✅ `membership-status-sync` (Active/Alumni term-rollover sweep)
- ✅ `signing-issuance` (re-issue recurring per-term agreements)

### Notifications ✅
`notify()` dispatch across **3 channels** (in-app, email w/ Instant·Daily·Weekly·Off, Slack DM prod-only) + desktop native banners over SSE. **26 event types** registered:
- ✅ Meetings: invite / reminder / cancelled
- ✅ Tasks: due_reminder / assigned / comment / status_changed / github_update
- ✅ Documents: comment_reply / file.comment / file.new_version / pagedoc.mention / maintainer_assigned / sign_request
- ✅ Staffing: assigned / member.promotion (admin-only)
- ✅ Hiring: interview_assigned / fellowship_invite
- ✅ Announcements: announcement / general (legacy)
- ✅ Onboarding: member.onboarding / reminder
- ✅ Forms: form.submission
- ✅ Education: announcement / decision / assignment / discussion / feedback_request / certificate
- ✅ Settings-page preference matrix (per-event, per-channel), digest grouping
- ✅ SSE live delivery (`/api/notifications/stream`) + desktop urgency (`timeSensitive`)
- ⬜ Mobile push (deferred to sidekick app)
- ⬜ ICS attachment on meeting-invite emails (RFC 5545 builder exists in hiring, not integrated)

### AI ✅ / 🟡
- ✅ Doc writing assistant `POST /api/ai/doc` (streaming + non-streaming, replacement markdown)
- ✅ Dual provider resolution (first-party `ANTHROPIC_API_KEY` / Dartmouth Chat gateway)
- ✅ Rate limits (in-memory burst + Postgres `AiUsage` daily quota) + token accounting → Admin → AI Usage
- ✅ Editor AI UI: AiBar, slash "Ask AI…/Continue writing", formatting toolbar, streaming apply (opt-in per mount via `aiEnabled`)
- 🟡 Ships **dark** until a provider key is set server-side (503 `{aiEnabled:false}`)
- ⬜ Broader `/ai` slash suite (`summarize`, `extract tasks`) — roadmap

### Collaborative editor ✅
- ✅ BlockNote + Yjs + Hocuspocus realtime stack, one shared `<DocEditor>` (SSR-safe lazy wrapper)
- ✅ Capability presets in `features.ts` (`field` / `notes` / `agreement` / `guide` / `document`)
- ✅ Legacy TipTap content converts lazily on load; server reads via `read.ts` (clone-before-decode enforced)
- ✅ Embedded across ~37 surfaces (docs, projects, education, forms, hiring, mentorship, signing, partners/portal)
- ✅ Comments, find, @mentions, images, files/video, callout/table/toggle, page-break, signing fields
- ✅ BlockNote migration complete (PR #1098) + follow-ups A1–A8, B1–B7 (see [§7](#7-stale--superseded-specs))

### Search & navigation ✅
- ✅ ⌘K command palette (greenfield search infra, security-scoped results) — PR #923
- ✅ Tabless mode (opt-in direct-render shell, Settings → Workspace) — PR #923
- ✅ Hub-at-root navigation pattern across all areas
- ⬜ Full-text search engine (Meilisearch) — deferred until page-tree plaintext snapshots exist

### MCP server ✅
- ✅ Hand-rolled JSON-RPC 2.0 at `POST /mcp`, OAuth Bearer, per-tool scopes, 120/min rate limit, audit log
- ✅ **~72 tools**: identity/directory, tasks, sprints/epics/stories, projects, pages, files/doc-curation, calendar/meetings, notifications, staffing, timesheet/manual-blocks
- ✅ Resources (`dali://me`, announcements, forms, project board/backlog) + 6 prompts (digest, meeting-prep, project-status, sprint-planning, standup, retro)
- ⬜ MCP write coverage for forms / hiring / education / group membership (currently zero)

### External integrations ✅
- ✅ Public read-only API (`/api/public/team|offerings|projects|media`) for the marketing site
- ✅ Slack bot: signed webhook receiver, @mention → GitHub issue, DM channel for `notify()`, channel posts for jobs
- ✅ jobx-extension (Chrome ext) fills Dartmouth JobX timesheet via `GET /api/timesheets/export`
- ✅ GitHub two-way sync: link task ↔ issue, webhook ingestion, close/reopen → `task.github_update`
- ⬜ GitHub depth: PR events, commit-message task refs, bi-directional assignee sync
- ⬜ Figma task linking (Tier 1/2/3) — **not built** (spec: `figma-task-linking.md`)
- ⬜ Notion import — wishlist, not built

### Desktop app ✅
- ✅ Tauri v2 macOS shell (thin wrapper around hosted web app)
- ✅ Native banners, click-through, tray recents, urgency, SSE delivery, desktop pref channel
- ✅ Two signing layers (Apple Developer ID + Tauri updater minisign)
- ⬜ Offline reading, deeper deep-links (deferred items 5/6 from native-upgrades branch)

---

## 2. Member-facing areas

### Home ✅
- ✅ Dashboard: open tasks (by project/deadline), this-week events, pending forms/assignments, task invites w/ inline RSVP
- ✅ Conditional cards that collapse gracefully (hiring is role-gated / cyclical)

### My Tasks / Notifications ✅
- ✅ Open tab (tasks + invites, filtered) · History tab (Open/Cleared/All, paginated)
- ✅ Inline RSVP for meeting invites

### Documents hub ✅
- ✅ Aggregates lab + project docs; filter by workspace / project status / tags; search; pin; emoji icons
- ✅ Lab docs full-manage; project docs read+pin (creation stays in project hub)

### Members / directory ✅
- ✅ Browse w/ filters (term, domain eligibility, alumni vs active); profiles (roles, class year, staff flag, mentorship)
- ✅ Private Core-gated notes; groups view
- ✅ `/profile` → own member page

### Calendar ✅ / 🟡
- ✅ Availability (working hours, per-day in-person/remote, Google calendar linking, manual blocks)
- ✅ Schedule meeting (members/groups/projects, availability overlay, location, QR self-check-in)
- ✅ Timesheet (manual entries by role/project, edit history) + JobX export bridge
- 🟡 Recurring manual blocks can't yet be marked as "work"
- ⬜ Recurring-meeting exceptions (model exists, unreferenced)

### Settings ✅
- ✅ Profile, notification preferences (per-kind), calendar OAuth, connected apps (Slack/MCP/API), sessions, Slack link, workspace (tabless)

### Onboarding ✅
- ✅ Inline welcome form for un-onboarded members; stamps `onboardedAt`; clears onboarding task
- 🟡 Full onboarding checklist — MVP only (fuller version tied to Staffing)

### Help / guides ✅
- ✅ Static guide pages: getting-started, calendar, staffing, notifications, shortcuts, MCP
- ✅ Embedded "page docs" Guide button (v1, PR #929)
- ⬜ Guide v2 (drawer, URL video, coverage rollout, freshness loop) — planned

---

## 3. Projects & staffing

### Project workspace ✅
- ✅ Hub (browse Active/Paused/Archived, filter by term / showcase status, search)
- ✅ Task board (epics → stories → tasks; Todo/InProgress/InReview/Done/Archived)
- ✅ Document tree (pages/folders), file uploads + artifacts (task ↔ file links, PR #950)
- ✅ Sprints (create, assign, status) + auto lifecycle job
- ✅ GitHub linking, public showcase (publishable write-up + status), partner read-only view
- 🐞 Deleting an epic with stories → 500 (FK not checked)
- 🐞 Board doesn't reflect teammate edits live (`adoptServerItems:false` by design)
- 🟡 Web UI: create/PATCH don't accept sprint/epic fields (tasks disconnected from sprints in UI; MCP can)
- 🟡 No task delete in UI (drag→Cancelled only); comment UI not rendered in modal; no dirty-guard on modal close
- ⬜ Sprint picker + backlog/sprint-scoped board; checklist UI in modal; epic progress counts; activity feed

### Staffing ✅
- ✅ Staffing board (assign roles Dev/Design/PM/Mentor, dates, eligibility, level)
- ✅ Intent to Work, Project Bids, My Staffing
- ✅ Two-phase lock + auto-pairing on close (per staffing-flow design)
- ✅ Level Up (moved into Staffing per IA decision)
- ✅ `staffing.assigned` notification on publish

---

## 4. Hiring (recruitment)

### Shipped ✅
- ✅ Hub (personal work items, cycle health, confidentiality gate)
- ✅ Cycles (create/manage, interview config, statuses Draft→Open→UnderReview)
- ✅ Applications (browse pool, profiles, schedule interviews, assign reviewers)
- ✅ Interviews (schedule/reschedule/complete, notes, attendees) + 24h/1h reminder job
- ✅ Reviews (per-applicant per-domain, decisions), rubrics, challenges
- ✅ Deliberation boards (move candidates, finalize cohort)
- ✅ Domain-Lead & Lead tools; intern-to-full-cycle workflow
- ✅ Analytics (pipeline funnel, health) — Core-only
- ✅ Applicant portal (status, submit application, portal hiring tab)
- ✅ Email templates + library; waitlist management (cross-cycle view, Core accept/remove, auto-shift ranks)
- ✅ Confidentiality now handled by generalized signing service (replaces hiring-specific NDA)

### Not done ⬜
- ⬜ Hiring cycle redesign (PR #589 needs rewrite)
- ⬜ Double-booking detection, Zoom auto-provisioning, waitlist auto-suggestions

---

## 5. Education (LMS)

_Rebuilt from scratch July 2026 (PR #846 abandoned); Forms-system applications._

- ✅ Catalog / browse published offerings; apply or RSVP (miniseries + workshop share one flow, waitlists)
- ✅ Course hub (sessions, materials, assignments), assignment view + **in-app submissions**
- ✅ Manage offerings (create/edit/publish, roster, submissions) — Core/Instructor
- ✅ Two-lane instructor notes; certificates; CE credits (1/term); compliance view (Core)
- ✅ Full submission viewer; collab workshop docs; session feedback (auto-sweep job)
- ✅ Applicant portal education (browse/apply/enroll/submit)
- ✅ Education notifications (announcement, decision, assignment, discussion, feedback_request, certificate)
- ⬜ Deferred polish items from Education review (PR #1062) — see project memory

---

## 6. Partners, mentorship, internal processes, admin, signing

### Partner & client portal ✅
- ✅ Internal: browse orgs, org detail, projects, member counts, open applications
- ✅ Partner application (apply, status, token invites, onboarding)
- ✅ **Redesigned** tabbed project workspace + Overview dashboard + What's-new feed (`PartnerProjectVisit`) — PR #1063
- ✅ Lifecycle emails, decision notes, withdraw/archive/self-leave, file comments (polish pass)
- ✅ Partner settings (org profile, team, credentials)
- 🐞 Partner "Unlink" hard-deletes (softer server actions exist)

### Mentorship ✅
- ✅ Weekly mentor→mentee note grid, mark-complete, notes editor
- ✅ Core oversight dashboard (overdue mentors); lab-wide note templates
- ✅ Scheduling with dynamic + static groups, recurring v1, opt-in personal overlay
- 🐞 `?tab=mentorship` as non-mentor renders blank page

### Internal / lab processes ✅ / ⬜
- ✅ Lab Processes hub (animated term roadmap, Core-editable week content) — 784-line real UI
- ✅ Level-Up (11-line redirect → Staffing, which owns the live flow)
- ⬜ JobX flow — `<ComingSoon>` stub (32 lines)
- ⬜ Transfer flow — `<ComingSoon>` stub (32 lines)

### Admin console ✅
_Redesigned to nested hubs (PR #1102, current branch `admin-console-redesign`)._
- ✅ 5 clusters (People & Access, Communications, Documents, Finance, System & Insights) via `ADMIN_CLUSTERS` registry
- ✅ People & Access: role assignment per term, domains, member eligibility, attendance
- ✅ Communications: announcements (+ scheduled), email templates, email senders
- ✅ Documents: agreements authoring / signature fields / signatories
- ✅ Finance (Admin-only): payroll + payroll export (TimesheetX)
- ✅ System & Insights: activity/analytics, AI usage, jobs control
- ✅ ⌘K admin section

### Document signing service ✅
_Generalized e-sign (BUILT 2026-07-30), replaces hiring confidentiality._
- ✅ Placeable fields, multi-party, `{{term}}` merge vars, hard gate
- ✅ Admin authoring (templates, versions, bindings), member signing, public token signing
- ✅ Cadence config (Once/PerTerm/PerCycle), audience registry, `signing-issuance` job
  - ℹ️ Signing-configurability lives on branch `feat/signing-configurability` (unpushed per memory) — **confirm merged before ticking fully done**

---

## 7. Stale / superseded specs

These planning docs predate recent work; **their "not built" lists are largely obsolete.** Keep for history, don't trust their status columns:

| Spec | Real status |
|---|---|
| `feature-opportunities.md` (Jul 24) | ⬅️ Mostly **DONE**. Jobs runner, 14 jobs, notification layer, ⌘K search all shipped. Still open: Notion import, some form-builder depth, GitHub PR/commit sync, some hiring automation. |
| `notifications-wiring.md` (Jul 24) | ⬅️ **DONE**. All 6 emitters + 6 jobs it lists as "not wired" now exist. Remaining: ICS on emails, mobile push. |
| `rich-text-editor-consolidation.md` | ⬅️ Largely **DONE** via BlockNote migration — capability presets (`features.ts`) exist. Confirm toolbar tier. |
| `signing-configurability.md` | ⬅️ **BUILT** (job + cadence + audience registry exist); pending branch merge. |
| `blocknote-migration.md` / `blocknote-followups.md` | ✅ **BUILT** (PR #1098). Deliberate skips: docx export, audio blocks, h4–h6, suggested edits (B8 parked), mobile editing (B9 → sidekick). |
| `expansion_plan.md` / `roadmap.md` | Master vision docs; most foundational + near-term items now shipped. Use §1–§6 above as the current truth. |
| `project-hub-review.md` | Audit of bugs/UX gaps — bugs & gaps folded into §3 above. |
| `projects-hub-guide.md` | Draft page-guide content, not yet deployed. |
| `alumni_status_plan.md` | 🟡 Stored `membershipStatus` logic; sidebar variant + route guards + backfill sweep still pending. |
| `figma-task-linking.md` | ⬜ Not built (all 3 tiers). |
| `specs/archive/*` | Historical (cycle redesign, MCP plan, DRY audits, scheduling, session-auth, task-reminders, Tauri, v0 plans, easter-eggs). |

---

## 8. Notable still-open items (consolidated backlog)

- ⬜ Mobile "sidekick" app (attendance check-in, push, My Tasks, My Day AI) — parallel track, `LabEvent`/`MobilePushToken` schema pending
- ⬜ Lab Events (weekly all-lab + spontaneous social) surfacing
- ⬜ Core Hub (analytics + resources)
- ⬜ Lab graph / connections view (Phase 1 = entity Connections)
- ⬜ Full-text search (Meilisearch)
- ⬜ Notion import; Figma linking; GitHub PR/commit sync depth
- ⬜ MCP write coverage (forms/hiring/education/groups)
- ⬜ ICS on meeting emails; recurring-meeting exceptions
- ⬜ Alumni sidebar variant + access suppression + backfill sweep
- ⬜ JobX & Transfer internal-process flows (both still `<ComingSoon>` stubs)
- 🐞 Epic-delete 500; live board sync; partner hard-unlink; non-mentor `?tab=mentorship` blank
