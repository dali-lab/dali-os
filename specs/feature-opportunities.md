# DALI OS — Feature Opportunities

_Compiled July 14, 2026, from a codebase-wide gap analysis (schema, forms, hiring, projects, calendar, collab, education, admin/internal-processes, notifications/Slack/MCP/email, specs + archive)._

Items already committed on [roadmap.md](roadmap.md) (page-tree templates/slash commands, AI slash commands, partner portal, Core Hub analytics, education polish, mobile app) are excluded, except where code evidence reinforces them.

---

## Two systemic patterns

1. **No background job / scheduler layer exists.** Nothing in the app runs on time-based triggers. Roughly a dozen wished-for features (reminders, digests, sprint auto-close, scheduled announcements, term rollover, form open/close windows) all die on this missing primitive.
2. **The notification *delivery* layer is half-built.** `NotificationEvent` (with `inAppDelivered`/`emailDelivered` fields) and `NotificationPreference` (with `digestFrequency`) both exist in the schema and are never written or read. Everything funnels through the older free-form `Notification` inbox, and email sending is ad-hoc per feature (hiring and education only).

Investing in these two pieces of infrastructure first makes most of the list below cheap.

---

## 1. Finish what's half-built (schema exists, last mile missing)

Highest-leverage items — the data model already committed to them.

| Feature | Evidence | Notes |
|---|---|---|
| **Task due-date reminders** | `Task.dueAt` exists; schema comment promises "assignees get a Slack DM 24h before and at the moment (see TaskReminder, added in a follow-up)" — but no `TaskReminder` model or job exists. Archived plan: `specs/archive/TASK_REMINDERS_PLAN.md` | Clearest "finish the sentence" item in the repo |
| **Notification preferences + digests** | `NotificationPreference` model (per-type toggles, `digestFrequency`) is never read anywhere | Settings page + digest email job + delivery tracking on `NotificationEvent`; resolves the `Notification` / `NotificationEvent` two-model split |
| **Meeting reminders** | `MeetingReminder` kind exists in the notification taxonomy but is never emitted — only `MeetingInvite` at creation | 15-min / 1-hour-before reminder (in-app + Slack DM); pairs with the mobile push plan |
| **Recurring meeting exceptions** | `MeetingException` model fully defined, completely unreferenced | No "edit/cancel this occurrence vs. whole series" today |
| **Task checklists** | `Task.checklist Json?` exists; `TaskModal.tsx` has no checklist editor | Lightweight subtasks for nearly free |
| **Rich profile bios** | `User.bioDocId` designed for collab-doc bio; no editor or renderer on profile/directory | |
| **Meeting notes linkage** | `ScheduledMeeting.descriptionDocId` exists but meetings are created without a doc | Auto-create a notes doc per meeting (optionally from template), linked both ways; feeds the MCP `meeting-prep` prompt real content |
| **Transfer and JobX flows** | Both render `<ComingSoon>` (`internal-processes.transfer.tsx:27`, `internal-processes.jobx.tsx:27`); dormant `ApplicationType.Transfer` enum value; "jobx" is on `specs/features.md` | Roadmap lists these as shipped — they aren't |
| **Scheduled announcements** | Announcements have a date field but always send immediately | Needs the job runner |

---

## 2. Automations ("oh, that would be cool")

- **Sprint lifecycle automation.** No auto-close when `endsAt` passes, no rollover of unfinished tasks to backlog/next sprint, no auto-generated sprint summary. A close-out flow — *close sprint → roll incomplete tasks → spawn retro doc from template → post summary to the project's Slack channel* — would be a signature feature built almost entirely from existing primitives.
- **Proactive Slack.** The Slack client only does invites, channel-ensure, and post/reply; channel creation happens only inside staffing finalize. Missing:
  - auto-channel on project creation
  - sprint start/close posts
  - RSVP buttons on meeting invites
  - standup prompts to project channels
  - extending the read-only `@mention` handler so the bot can create a task or mark one done from a thread
- **Education feedback loop.** Session feedback and instructor-exit forms are sent manually (`feedback.server.ts:87-105`). Trigger them automatically when attendance is marked or the session end time passes — the form bindings already exist.
- **Term rollover.** Term boundaries are all manual: closing offerings, refreshing eligibility, payroll readiness, group membership updates. A "term transition checklist" that runs the mechanical parts and surfaces the judgment calls.
- **Hiring scheduling automation.**
  - No interview reminder emails (24h/1h before)
  - No interviewer double-booking detection
  - Zoom auto-provisioning is commented out in `api.domain-applications.$id.schedule-interview.ts:95-103` pending the S2S app (needs ITC admin)
  - Waitlist "suggest next promotion" when an offer is declined — *suggest* rather than auto-act, since accept-off-waitlist stays Core-only
- **Email where it's conspicuously absent.** Meeting invites never send an `.ics` (external participants get nothing); form `notifyOnSubmission` is in-app only; no submission receipt to the respondent. Hiring already has ICS infrastructure to borrow from.
- **Onboarding provisioning dashboard.** Onboarding toggles (e.g. Figma invite) are manual with no audit view of who's fully provisioned across email/Slack/Figma/groups. A "provisioning status" grid in the admin console makes gaps visible even before automating the invites themselves.

---

## 3. Bigger genuine gaps

- **Global search / Cmd-K palette.** No cross-entity search anywhere — search is scattered per-area (members, projects, forms). The roadmap defers Meilisearch pending page snapshots, but a Cmd-K over *structured* entities (people, projects, tasks, forms, offerings, pages by title) needs only Postgres and would change daily navigation immediately. Full-text doc search layers in later.
- **Notion import.** On the `specs/features.md` wishlist, and strategically important: you can't be the Notion replacement without an escape hatch *from* Notion. Notion exports markdown/HTML zips; a parser that maps them into the page tree (headings, lists, images, nested pages) is tractable, and the collab layer already has markdown export to mirror.
- **My Tasks cross-project view.** The IA plan renames an area to "My Tasks," but no route aggregates a member's tasks across projects. Combined with due dates this becomes the personal home surface — the web counterpart to the mobile app's triage view.
- **Form builder depth.** Verified gaps:
  - no open/close scheduling window
  - no form duplication / templates
  - no conditional show/hide logic
  - no date-picker question type
  - no response analytics (even a per-question distribution chart for multiple-choice)
  - no anonymous mode

  Given forms now back staffing, education, and partner applications: scheduling windows + duplication first.
- **Attendance surfacing.** `specs/features.md` says "attendance tab (visible)". Education attendance drives CE credits but members can't see their own record, and there's no live organizer roster — also the web-side half of the mobile WiFi/GPS check-in plan (`LabEventAttendance`).
- **Hiring analytics depth.** The analytics route now just redirects to the hub. Missing: reviewer turnaround/completion metrics, funnel conversion by domain/cohort, year-over-year trends, rubric score benchmarking ("typical score for this criterion is 3.2"). All derivable from existing data, no schema changes.
- **GitHub sync depth.** The webhook only handles `issues` and `issue_comment` — no PR events, no commit-message task references (`fixes DALI-123`), no linking an *existing* GitHub issue to a task, and inbound assignee sync is single-login only.
- **Doc backlinks + mention notifications.** Comment @-mentions don't notify anyone, and there's no cross-doc link tracking. Backlinks ("what links here") are a core Notion-replacement expectation and pair with the planned plain-text snapshot work.
- **MCP write-coverage gaps.** 37 tools, but zero coverage for forms, hiring, education, or group membership. Given the AI slash-command track is coming: `create_form` (AI-drafts a survey), meeting scheduling, and group add/remove are natural next tools.

---

## 4. Quick wins

- **Form duplication** ("Clone form") — verified absent; probably the most-requested small thing forms admins hit
- **iCal feed/export** for personal meetings (pushes to Google exist, but no `.ics` subscribe URL)
- **"Show archived" filter** for projects — archived state exists but accumulates invisibly
- **Activity log CSV export** in the admin console
- **Bulk decision release** in hiring (currently one applicant at a time)
- **Colored doc tags** — `DocTag.color` is stored but never rendered
- **Meeting conflict warning** — availability is already fetched at creation time; it just doesn't warn on overlap

---

## Top three picks

1. **Background job runner + notification delivery/preferences layer** — unblocks reminders, digests, scheduled announcements, sprint automation, and the mobile push plan all at once.
2. **Cmd-K global search** — the most-felt daily gap.
3. **Sprint close-out automation** — visible, delightful, and built almost entirely from existing pieces.
