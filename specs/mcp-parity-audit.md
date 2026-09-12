# MCP ↔ Web Parity Audit

**Status:** Audit complete · **Date:** 2026-09-11 · **Branch:** `feat/mcp-parity` · **Owner:** Kiran

Holistic comparison of what a member can do in the **web UI** vs the **MCP server**. The
target model (per `specs/mcp-expansion.md`): MCP should give a member the *same abilities
they have in the web*, gated by the same internal role checks, minus a short list of
deliberate exclusions. This audit checks whether that still holds ~5 weeks after the MCP
expansion shipped (~2026-08-05), during which a lot of new web surface landed.

## Scope model recap (unchanged, correct)

- `mcp:read` — all reads, **permission-filtered per user** (never "read everything").
- `mcp:write` — the user's own work + role-scoped duties (PM task mgmt, instructor grading, mentor notes, staffing edits, member sign/submit).
- `mcp:admin` — elevated / high-blast (provision access, change roles/money, broadcast). Only granted to Core/Admin at consent; re-checked in `run()` per call.

The two-axis design (scope = client blast radius; role gate = whether the user may act) is sound. The gaps below are about **coverage** and a handful of **filter/behavior divergences**, not the model.

---

## Headline scorecard

| Area | Read parity | Write parity | Biggest issue |
|---|---|---|---|
| Projects / Tasks | Good | Partial | Missing task `description`/`startsAt` writes; story fields stale; board resource unfiltered |
| Sprints / Epics / Stories | Good | Partial | Epic collab-doc not provisioned; `update_story` missing 7 fields |
| Staffing | Good | **Broken behavior** | `set_staffing_assignment` roster-leak repro (P0); no member self-service inputs |
| Calendar / Meetings | Partial | Weak | No class CRUD, no organizer-attendance, thin `schedule_meeting`, no calendar search |
| Drive / Docs / Pages | Good | Partial | No Lab-page / personal-note **body** writes; PageShare grants absent; typography/trash gaps |
| Comments / Notes / Tags / Versions | Good | Good | No comment resolve/reopen; no version labeling |
| Forms | Good | Good (admin) | Solid |
| Education | Good | **Major gaps** | No `submit_assignment`, no grading, no session check-in, stale assignment-type enum (bug) |
| Mentorship | Good | Good | Only missing single-template read + batch pair delete |
| Partners (internal) | Shallow read | Partial | CRM (eval/meetings/notes/emails) absent; status writes skip activity log |
| Signing | Good | Partial | No "get doc to sign" body, no batch-issue, no archive/remind |
| Notifications / Profile / Settings | Partial | Partial | `update_profile` covers 6 of ~15 fields; no mark-all-read; thin `get_member_profile` |
| Hiring (read-only by design) | Partial | N/A (correct) | **Anonymization bypass (P0 security)**; waitlist filter gap; several read gaps |
| Admin / Operations | Partial | Partial | Activities layer 0% covered; no list-jobs; infra/outbox/AI-usage reads absent |

---

## Category A — Correctness & security divergences (fix to match web; no product decision needed)

These are places where MCP does **not** faithfully mirror the web's behavior/filter. They are bugs, not policy questions.

| # | Sev | Finding | Evidence |
|---|---|---|---|
| A1 | **P0 security** | **Hiring `get_application` skips blind-review anonymization.** Web `full-context` blinds the applicant (`blindUser` / `anonLabelMapForCycle`) on Standard cycles with `anonymizeReview` on, until a decision is Released. The MCP tool imports no anonymization and always returns the real name → reviewers see real identities they must not see. | `app/mcp/tools/hiring/get-application.ts` (none) vs `app/hiring/routes/api.domain-applications.$id.full-context.ts:148-157` |
| A2 | **P0 privacy** | **`list_waitlist` missing the non-admin-Core filter.** Web hides Core-cycle waitlisters from non-Admin Core members; MCP only checks `isCore` and returns Core-cycle entries to any Core member. | `app/mcp/tools/hiring/list-waitlist.ts` vs `hiring/routes/waitlists.tsx` loader |
| A3 | **P0 correctness** | **`set_staffing_assignment` leaks the roster.** MCP only mutates `StaffingAssignment`; the web assign route also `deleteMany`s the canonical `ProjectAssignment` on move/leave (the PR #1533 fix). MCP reproduces the exact roster-leak bug (payroll/jobx/profile roster left stale). | `app/mcp/tools/staffing.ts` (no `projectAssignment`) vs `api.staffing.assign.ts:147-165` |
| A4 | P1 correctness | **`add_board_member` missing the DALI-member guard.** Web enforces `daliMember: { isNot: null }`; MCP does a bare `findUnique` → non-member user IDs can be board-placed via MCP. | `projects-extra/manage-staffing.ts` vs `api.staffing.board-member.ts` |
| A5 | P1 audit | **Partner `update_status` + `promote_partner_application` bypass `setApplicationStatus`** → no `StatusChanged` PartnerActivity row (web board-drag logs it). MCP status changes leave no timeline/audit trail. | `partners/manage-partner-application.ts`, `partners/promote-partner-application.ts` |
| A6 | P1 bug | **`manage_education_assignment` submission-type enum is stale.** Enum = `[Text, File, Mixed]`; schema added `Link, Doc, Complete` (PR #1458). Creating those types via MCP throws a validation error. | `education/manage-education-assignment.ts` |
| A7 | ~~P1~~ **no change** | **`dali://projects/{id}/board` resource has no project-membership filter** — but the web `projects.$id.tsx` loader gates only on `requireAuth` (any member sees any project's board; `isPrivate` is returned as data, not an access gate) and `list_projects` filters nothing either. The resource is **at parity**; confirmed intended. | `app/mcp/resources/project-board.ts` vs `projects.$id.tsx:286` |
| A11 | ~~P3~~ **deferred** | `submit_education_application` skips the `versionUpdatedAt` fingerprint. The shared server fn tolerates its absence, and an MCP agent has no reliable way to obtain the fingerprint — forcing it would cause spurious 409s. Left as-is. | `education/submit-education-application.ts` |
| A8 | P2 audit | **`manage_staffing set_mentor_role` drops the `staffing.mentorRole.set` audit log** the web route writes. | `projects-extra/manage-staffing.ts` vs `api.staffing.mentor-role.ts` |
| A9 | P2 consistency | **`list_agreement_signatures` scope-tag is `mcp:read` but runtime requires Core** → a non-Core `mcp:read` token passes the scope check then 403s. Should be `mcp:admin`. | `signing/list-agreement-signatures.ts` |
| A10 | P2 stale-gate | **`add_task_comment` gate is now *more restrictive* than web.** MCP allows assignees-or-Core; the web comment route was broadened to project-members-or-Core. Non-assignee project members get 403 from MCP. | `add-task-comment.ts` vs `api.tasks.$id.comments.ts` |
| A12 | P2 divergence | **`close_out_education_offering` requires `mcp:admin`** but the web gate is `isOfferingManager` (instructor OR Core). An instructor who owns the course can close it on the web but not via MCP. Recommend align to `mcp:write` + `isOfferingManager` (its outbound blast is already guarded by a `preview`/confirm path). | `education/close-out-education-offering.ts` |

---

## Category B — Clear parity gaps (in-scope for member/role parity; build them)

Grouped by area. Each is a capability a permitted user has in the web with **no MCP tool**.

### Projects / Tasks / Sprints / Epics / Stories
- `update_task` missing **`description`** and **`startsAt`**; `create_task` missing `startsAt`.
- `update_story` missing **priority, startsAt, endsAt, successMetric, acceptanceCriteria, category, dependsOn** (model grew; tool exposes only title/notes/status).
- Bulk **archive terminal tasks** (`api.projects.$id.tasks.archive.ts`); **list archived tasks**.
- **Epic collab description doc** never provisioned by `create_epic`/`update_epic` (only the plaintext column) → UI shows plaintext stacked over an empty editor.
- Move page to **EducationOffering** workspace (manage_page move only does Lab/Project).

### Project files
- Upload **new version** of an existing file; **rename** a file; get **signed download URLs** for versions (`list_project_files` returns metadata only).

### Drive / Docs / Pages
- **Page typography** action (font/fullWidth/smallText/nesting-guides).
- **Comment resolve / reopen** (manage_comment lacks both).
- **Collab version labeling** (name/clear a version).
- **List page templates** for a workspace (create accepts `fromTemplatePageId` but nothing enumerates them).
- **Drive trash**: list / restore / purge.
- **File & form cross-folder move** (manage_page moves Pages only).
- **Lab-scope / Member-scope file upload** (`upload_project_file` is project-only).

### Education (largest gap set)
- **`submit_assignment`** — students cannot submit in any mode (Text/File/Mixed/Link/Doc/Complete). Highest-impact student gap.
- **`grade_submission`** — instructors cannot score/grade.
- **Session self check-in** (`api.education.sessions.$sessionId.check-in.ts`) — no MCP mirror.
- **Set-session-check-in-open** toggle; **duplicate offering**; **external instructor** invite/remove.
- **Offering pages/materials tree** (create-page, move-page, set-material-session, move-file); **read_education_page**.
- **Discussion / announcements** read+write.
- **Form-binding** & **decision-email binding** to offering slots.
- **CE compliance** (Core): `complianceForTerm`, manual `grant-credit`, `remind-non-compliant`.
- **`get_certificate`** read.

### Calendar / Meetings
- `schedule_meeting` too thin: no **Group scope**, **projectId/meetingType/isCoreMeeting/noteLocation**, **attendanceMode (SelfCheckIn)**, **organizerCalendarId**.
- **Organizer marks attendance** (`{userId, present}`) — entirely absent.
- **Meeting detail metadata** (`get_meeting_attendance` returns roster only — no time/URL/note link/Core flag).
- **Calendar search** (`api.calendar.search`).
- **Dartmouth class CRUD** + **timetable course search**.
- **Calendar-link remove/toggle** + per-calendar visibility.
- **Wallet-pass scan check-in** (operator).

### Mentorship
- **`get_mentor_note_template`** single-template body read (list exists; single-read doesn't).
- **Batch pair delete** (web accepts multiple ids; MCP one per call).

### Partners (internal CRM)
- **Application title** update; **assign meeter**; **eval rubric** (8-criteria + interviewRating) read & write; **acceptance metadata** (ambiguityRating/fundingModel); **meetings** (create/debrief); **internal notes**; **`expectedChallenges`** per-domain block doc; **SOW** collab doc.
- CRM status-with-email actions (accept/reject/triage/offer-meeting/learn-more) → **policy question** (Category C).
- `get_partner_application` read payload is shallow (no eval/CRM state).

### Signing
- **Get document-to-sign body + field defs** (can't inspect what you're signing; `sign_document` needs field IDs discovered out-of-band).
- **List my signed documents** (`listMySignedDocuments` exists, unexposed).
- **Delete draft version**, **archive agreement**, **remind outstanding signers**, **batch issue term agreements**, **list agreements/console**, Core **get another member's signed copy**.

### Notifications / Profile / Settings
- **Mark all read**; notification **history + filters (status/kind/q) + pagination**; **unread/dismiss** intents.
- **`update_profile`** covers 6 of ~15 fields — missing **classYear, linkedinUrl, githubUsername, personalSite, major, hometown, birthday, dietary, phone, personalEmail** (bio is collab — intentional).
- **`get_member_profile`** thin — missing photo/handle/github/timezone/projects/achievements/education/CE standing.
- **Directory browse-all** (`search_directory` requires a query — no `list_members`).
- **Onboarding / tour completion**; **hide-activity** presence write.

### Admin / Operations
- **`manage_job` list action** (can configure/run but not enumerate jobs).
- **Cancel / list scheduled announcements**; **send-test email**; **disable sender / rate-cap**; **outbound-messages** (list/retry/cancel).
- **Activities layer** (PR #1532) — 0% MCP coverage (explicitly deferred).
- **AI-usage / analytics** reads; **admin attendance grid** (cross-meeting).
- **Infrastructure dashboard** read (write likely stays excluded).

---

## Category C — Policy divergences (RESOLVED 2026-09-11)

These were genuine product decisions. Owner's calls, now locked:

- **C1 — Hiring member-facing self-reads → DECIDED: keep hiring fully excluded.** No member-facing hiring over MCP (no applicant self-status/answers, no internal Core/Fellowship apply). Applicants/members use the web portal exclusively. *Effect:* the existing reviewer/admin hiring **reads** keep their P0 security fixes (A1, A2 — those run on already-exposed tools), but **no new member-facing hiring tools** are built. Reviewer/admin hiring read-gaps (coverage detail, rosters, pipeline, rubric) are lowest priority and only in-scope insofar as they extend the *existing* D2 reviewer/admin read model — not the member surface.
- **C2 — Member self-service staffing → DECIDED: keep web-form-only.** No MCP surface for members to read/prefill/submit intent-to-work, project-bids, or level-up. The guided bound-form UX stays the only path. *Effect:* dropped from the plan entirely.
- **C3 — Collab body writes → DECIDED: allow both (full parity).** Add Lab-page body writes and personal-note body writes via the collab pipeline (clone rule, `replaceCollabDocContent`), same as project pages. *Effect:* personal-note body write → Phase 1 (member self); Lab-page body write → Phase 2 (shared surface).
- **C4 — Partner CRM writes with outbound email → DECIDED: silent writes only.** MCP may perform the **data** writes (status set, eval rubric, meetings, internal notes, title, `expectedChallenges`) but **not** the actions that email the partner (accept/reject/triage/offer-meeting/learn-more) or the **PageShare per-user/group grants**. Those outbound/access-granting actions stay web-only. *Effect:* Phase 2 partner CRM excludes the email-transition actions and PageShare grants; the raw status write must still be fixed to log the activity row (A5).
- **C5 — Forms anonymous submit:** keep `submit_form` auth-required (agents are always authenticated). No change.
- **C6 — Infra read-only over MCP:** read-only fleet tool worth building (Phase 3); infra writes stay web-only.

---

## Category D — Confirmed intentional exclusions (no action)

SSE streams (notifications/comments/staffing/activities); GitHub webhook; CSV/PDF exports; drag-only reorder endpoints; field-placement canvas UIs; Gmail-OAuth authorize; member **role grants** (`api.members.$memberId.roles`); **domain create/delete**; payroll upload/export/budget; external **partner portal** (`/partner`, PartnerUser auth); calendar OAuth connect flow.

---

## Proposed phased plan

**Phase 0 — Correctness & security (ship first, no new surface).** Fix A1–A3 (P0), then A4–A6, then A7–A12. These make existing MCP tools faithful to the web; several are security/privacy. Each reuses the web's shared server fn (anonymization helper, `deleteMany` roster cleanup, `setApplicationStatus`, the assignment-type enum, `isOfferingManager` gate). Add regression tests.

**Phase 1 — Close member/self-service read+write gaps (Category B, member tier).** Task `description`/`startsAt`, story fields, `update_profile`/`get_member_profile` field expansion, notifications mark-all/history, `submit_assignment` + session check-in + `get_certificate`, `get_binding_to_sign` + `list_my_signed_documents`, directory browse, file re-version/rename/download-URL, **personal-note body writes (C3)**. These are the highest-value, lowest-ambiguity items and are exactly the "a member should be able to do this via MCP" cases.

**Phase 2 — Role-scoped writes (Category B, PM/instructor/Core tier).** Education grading/offering-pages/CE-compliance, calendar richer scheduling + organizer attendance + class CRUD, partner CRM **data** writes (eval rubric / meetings / notes / title / `expectedChallenges` / raw status — **excludes** email-transition actions & PageShare grants per C4), signing batch-issue/archive/remind, admin list-jobs/announcements/outbox, epic collab doc, drive trash/move, **Lab-page body writes (C3)**.

**Phase 3 — New-surface coverage.** Activities layer, infrastructure read-only (C6), AI-usage/analytics reads. Reviewer/admin hiring read-gaps (coverage detail, rosters, pipeline, rubric) optional within the existing D2 read model. **No member-facing hiring, no staffing self-service (C1, C2).**

Faceting stays the pattern: extend `manage_*(action)` tools rather than adding many discrete tools. Reuse the web's extracted server fns; where logic is inline in an action, extract a shared fn first (benefits both surfaces).
