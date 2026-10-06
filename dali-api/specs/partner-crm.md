# Partner CRM

Design spec for the partner hub revamp. One PR. Replaces the `/partners` area with a Core-only Partner CRM.

Direction (Kiran, 2026-10-06): the hub is unused and thin. Build a full CRM. No ownership: one person works the pipeline. Main interaction is a four-column kanban that behaves like the task board. Move it into Core. Expose the calendar free/busy scheduler. Add a meeting request feature. Reuse before building.

## 1. What exists and what we reuse

| Need | Reuse | Where |
|---|---|---|
| Kanban | `KanbanBoard`, `useOptimisticBoardMove`, `pointerFirstCollision` | `app/components/board/` |
| Board chrome | `SearchInput`, filter-panel kit (`FilterField`, `FilterPill`, `FilterToggleRow`, `customizeButtonClass`), `Menu`, `Popover`, `ViewToggle` | `app/components/ui/` |
| Card look | `TaskCard` layout and status accent CSS vars | `app/projects/components/TaskBoard.tsx` (private today, lift) |
| Modal shell | `Modal`, `ModalHeader`, `ModalFooter`, `modalCardClass`, `useDialog` guarded close | `app/components/Modal.tsx`, `os-chrome.ts` |
| Modal fields | `Field`, `FieldPair`, `ModalSection`, `PropRow` | `TaskModal.tsx` (private today, lift to `app/components/ui/modal-fields.tsx`) |
| Full-page escape | "Open full page" pinned footer link | `OfferingDetailPanel.tsx` precedent |
| Timeline | `PartnerActivityFeed`, `logPartnerActivity`, `setApplicationStatus` | `app/partners/` |
| Comments | `MentionTextInput` composer, activity `Note` type | existing |
| Status pills | `PARTNER_APPLICATION_STATUS_PILL`, `StatusPill` | `app/partners/lib/partner-application.ts` |
| Scheduling | `ParticipantPicker`, `ScheduleWeekGrid`, `OptimalTimePills`, `ParticipantAvailabilityList`, `findOptimalSlots` | `app/calendar/components/scheduling.tsx`, `lib/optimal-times.ts` |
| Meetings | `createScheduledMeeting({ guestEmails, organizerCalendarLinkId, addMeet })` | `app/lib/scheduled-meeting.ts` |
| Board ordering | `moveTaskInBoard`, `nextPositionInColumn` | `app/projects/lib/task-board.ts` (generalize) |
| Email capture | `MailAccount`, `MailMessageIndex`, `indexMessages`, `getSharedInboxToken`, `runApplicantEmailIndex`, `ApplicantEmailPanel`, `ApplicantEmailThreadModal` | `app/email/lib/`, `app/jobs/`, `app/hiring/components/` |
| Outbound | `enqueueOutbound({ purpose: "Partners" })`, `renderFramedEmail`, `EMAIL_TEMPLATES` + `interpolateVars` | `app/lib/outbound.server.ts`, `app/email/lib/` |
| Notifications | `notify()`, `EVENT_TYPES` registry | `app/lib/notify.server.ts`, `notification-events.ts` |
| Jobs | claim/send shape of `task-due-reminders` | `app/jobs/` |
| Contract | `SigningDocument` + `SigningBinding` engine, `recordSignature(variables)` | `app/signing/` |
| Funding | `ProjectFundingType` enum, `ProjectChartString` | schema |
| Core move | thin re-export route + `coreHandle()`, `regroupRedirect()` | `app/core/routes/`, `app/core/lib/regroup-redirect.server.ts` |
| Forms | bound Form via per-surface binding table + `formUsages()` registry | `app/forms/lib/` |

Gaps that need new code: a shared card and modal-field module, org and contact level timeline, partner mail linking (contacts may have no `User`), a non-member slot-pick flow, partner notification area, partner jobs, deal terms and invoices, reporting.

## 2. Information architecture

Core is process, Admin is system. The CRM is a process, so it lives under Core.

Routes (all `isCore`, read and write):

| Path | Page |
|---|---|
| `/core/partners` | Board. Default landing. |
| `/core/partners/directory` | Orgs and contacts list, `ViewToggle` card/list, search. |
| `/core/partners/orgs/:orgId` | Org 360. |
| `/core/partners/contacts/:contactId` | Contact 360. |
| `/core/partners/applications/:id` | Full-page application record (the modal's "View all" target). |
| `/core/partners/reports` | Funnel and relationship reporting. |
| `/core/partners/settings` | Application form binding, email templates link, stale threshold. |

Old `/partners*` paths redirect with `regroupRedirect`, sub-path and query preserved. Nav: remove the General-area Partners entry and the `partners` area; add Core subtab "Partner CRM" with children Board, Directory, Reports. `navbar-routes.ts` updated. Portal paths under `/partner/*` do not move.

The route files move to `app/partners/routes/core.partners.*.tsx` and register directly under `/core/partners` with `coreHandle("partners")`. The thin re-export pattern is for aliasing a page that also lives elsewhere; here the page has one home.

## 3. Pipeline: four stages

`PartnerApplicationStatus` is replaced by a new enum `PartnerStage { New, Interview, Accepted, Rejected }` on a new column `stage`. Migration: add column, backfill from the old status, drop the old column and the old enum type (a `CREATE TYPE` + `UPDATE` + `DROP` sequence, so the eleven legacy values disappear rather than linger).

Backfill map:

| Old | New |
|---|---|
| Inquiry, Triaged, ApplicationSubmitted, Submitted | New |
| Meeting, UnderReview, LearnMore, OnHold | Interview |
| Accepted, Promoted | Accepted |
| Rejected | Rejected |

"Promoted" becomes derived: `resultingProjectId != null`. Accepted cards with a project show a Project chip and link. Learn-more and hold become actions, not stages: "Request more info" sends the existing email and logs an activity; a `holdUntil DateTime?` field parks a card with a Paused chip without leaving its column.

New fields on `PartnerApplication`: `nextStep String?`, `nextStepDueAt DateTime?`, `lastActivityAt DateTime` (written by `logPartnerActivity`), `holdUntil DateTime?`, `rejectReason PartnerRejectReason?` (`NotAFit, NoCapacity, Funding, Timing, Withdrawn, Other`) alongside the existing free-text `decisionReason`. `source` gains `Renewal`. Removed: `assignedMeeterId` (no ownership).

Derived sets in `partner-application.ts`: `PROJECTING_STAGES = [Interview, Accepted]`, `OPEN_STAGES = [New, Interview]`, `PARTNER_EDITABLE_STAGES = [New]`. Partner-facing progress track becomes four nodes: Submitted, Interview, Decision, Project.

Stage transitions and side effects (all through `setApplicationStatus`, which stays the chokepoint and now also stamps `lastActivityAt`):

| Move | Primary CTA label | Side effect offered |
|---|---|---|
| New to Interview | Schedule interview | Opens the scheduler (section 6). Moving without scheduling is allowed. |
| Interview to Accepted | Accept | Accepted email, acceptance fields, Create project button appears. |
| Any to Rejected | Reject | Reason enum + note, rejected email. |
| Accepted to project | Create project | Existing promote action, unchanged. |
| Drag on the board | none | Silent stage move, activity logged, no email. Same as the task board. |

## 4. The board

`/core/partners` renders `PartnerBoard`, built the way `TaskBoard` is built:

- `KanbanBoard id="partner-board"` with four `KanbanColumn`s from `PARTNER_STAGES`. Column `title` is the stage pill, `headerExtra` is count plus a `Menu` (Add, Collapse), `listHeader` is the dashed "Add new" button that opens the modal in create mode.
- Column header accents use the task board's `StatusAccent` CSS vars so the two boards read as one system.
- Sortable, exactly like the task board. `PartnerApplication.position Float` orders cards inside a column. `moveTaskInBoard` and `nextPositionInColumn` in `app/projects/lib/task-board.ts` are generalized over `{ id, status, position }` into `app/components/board/board-order.ts` so both boards share them. New cards land at the top of New.
- Drag within or between columns calls `useOptimisticBoardMove` and `POST /api/partner-applications/:id/move` with `{ stage, position }`. Dropping on a card inserts at its index; dropping on a column appends.
- Card (`PartnerCard`, lifted from `TaskCard`): title, org or contact name, domain pills, target term chips, next step with due date (red when overdue), stale badge when `lastActivityAt` is older than the stale threshold, Paused chip, Project chip, meeting-requested badge, unread email dot, source icon.
- Filters: `SearchInput`, then a Customize `Popover` with term, domain, source, "Stale only", "Show paused", "Show rejected from past terms". Rejected hides cards older than the current term by default so the column does not grow forever. Filter state persists in the URL the way Hiring Applications does.
- Card click sets `?application=<id>` and opens `PartnerApplicationModal`. Deep links work. Opening marks related emails and the request badge as seen.
- A `Projected headcount` strip above the board keeps the existing chart, now reading `PROJECTING_STAGES`.

## 5. The application modal

`PartnerApplicationModal` follows `TaskModal` conventions (type badge, record mode with pencil to edit, `useDialog` guarded close) but is wide: `modalCardClass("max-w-4xl")`, body is a two-column grid.

Header: badge "Partner application", title, stage `Select` (any to any), close.

Left, two thirds, `UnderlineTabButtons`:

| Tab | Shows | View all target |
|---|---|---|
| Activity | Timeline (`PartnerActivityFeed`) with emails merged in, note composer (`MentionTextInput`) | full page `?tab=activity` |
| Details | Pitch summary, form answers (first eight rows), domains with expected members and challenges, target terms | `?tab=details` |
| Meetings | Upcoming and past meetings, debrief and outcome per meeting, Schedule button, pending request and offered slots | `?tab=meetings` |
| Evaluation | Eight-criteria rubric card (existing `discovery-rubric.ts`), ratings | same tab |
| Email | Threads with partners@ (section 8) | `?tab=email` |

Right, one third, property rail using `PropRow`: Stage, Contact (link to contact 360), Organization (link or "Not yet, created at project"), Source, Next step + due (`DateField`), Paused until, Target terms, Domains, Funding type (`ProjectFundingType` `Select`), Fee, Legal entity, Contract status, SOW link.

Footer: stage-aware primary CTA from section 3, secondary Request more info, Reject as a destructive text link, and "Open full page" (`buttonClasses("ghost","sm")`) at the far left. Create mode is the same modal with Details only, like `TaskModal` create.

The full page `/core/partners/applications/:id` is the slimmed existing detail route: same tabs, no row limits, plus the SOW collab editor and the signing panel, which do not belong in a modal.

## 6. Scheduling and the request feature

### Core schedules an interview

Partner meetings become real `ScheduledMeeting` rows. `PartnerMeeting` is kept as the CRM link row: it gains `scheduledMeetingId String? @unique` and keeps `debrief` and `outcome`. Legacy rows without a linked meeting keep their `scheduledAt`. New meetings always create a `ScheduledMeeting` with `scopeType: UserList`, `participantUserIds` from the picker, `guestEmails: [contact.email]`, the current user's enabled calendar link as organizer, and `addMeet` on. Google emails the partner a real invite with the Meet link. `scheduledAt` on the link row mirrors `startTime` for sorting.

The scheduler UI is `CreateEventModal` refactored to accept `mode: "meeting-only"`, `fixedGuestEmails`, `context: { partnerApplicationId }`, and `onCreated(meetingId)`. A server helper `loadSchedulingData(request)` returns the subset of calendar `LoaderData` the modal needs (users, working hours, invite destinations) so the CRM route can mount it without the whole calendar loader. Event mode and group selection are hidden in this mode. The partner shows in `ParticipantAvailabilityList` under "No calendar", which is already the right state.

`manage_partner_meeting` (MCP) `create` routes through the same helper and gains `guestEmails`. `schedule_meeting` gains `guestEmails` as a by-product.

### Partner requests a meeting with the real scheduler

The portal gets the same scheduling component Core uses, scoped to what a partner may see. On the application page (Interview stage) and on a project page, "Request a meeting" opens `ScheduleWeekGrid` showing the team's mutual availability, a duration picker, and a note field. The partner picks a slot and submits a request.

Who the team is:

| Context | Participants |
|---|---|
| Application | the interview panel: Core members chosen in `/core/partners/settings` (`interviewPanelUserIds`), default all active Core |
| Project | the project's active `ProjectAssignment` members |

Privacy: the partner must never see per-member calendars. A new portal endpoint `POST /api/partner/availability` takes `{ applicationId | projectId, weekStartIso, weekEndIso, durationMinutes, timezone }`, resolves the participant set server-side, runs `computeUserFreeBusy` and `intersectFreeIntervals`, and returns only the merged free intervals (`days` with `matches`, no `perUser`). `ScheduleWeekGrid` gets an `availabilityUrl` prop (default the existing group-availability route) and renders the aggregate view when `perUser` is absent. `ParticipantPicker`, `ParticipantAvailabilityList` and optimal-time pills are not mounted in the portal.

Submitting creates `PartnerMeetingRequest { id, applicationId?, projectId?, contactId, startTime, durationMinutes, participantUserIds String[], note, status PartnerMeetingRequestStatus { Pending, Accepted, Declined, Expired }, respondedByUserId?, respondedAt, scheduledMeetingId? }`, logs `MeetingRequested`, and fires `partner.meeting_requested`. The card shows a "Meeting requested" badge.

Core responds from the modal Meetings tab, where pending requests sit at the top with Accept and Decline. Accept runs the same `createScheduledMeeting` path as the Core scheduler (participants, guest email, organizer link, Meet), links the request, logs `MeetingScheduled`, and the partner receives the Google invite. Decline takes an optional note, emails the partner, and the portal shows the outcome with a link to request again. A slot that became busy between request and acceptance surfaces as a conflict warning on Accept, not a hard block.

Portal also gains a Meetings section on the application and project pages listing upcoming `ScheduledMeeting`s whose `guestEmails` contains the contact's email, with the Meet link, plus pending and declined requests.

## 7. Account 360

### Org record `/core/partners/orgs/:orgId`

Header: logo, name, type pill, relationship status pill (derived: Active when an active `ProjectPartner` exists, Past when only ended ones, Prospect otherwise, Dormant when Past and no activity in 12 months), website, Edit.

Tabs: Timeline, Contacts, Applications, Projects, Finance, Settings.

New `PartnerOrg` fields: `type PartnerOrgType? { DartmouthDepartment, FacultyResearch, Startup, Nonprofit, Company, Alumni, Other }`, `address String?`, `legalEntityName String?`, `tags String[]`, `notes String?`, `showcaseConsent Boolean @default(false)`, `referredByContactId String?`.

### Contact record `/core/partners/contacts/:contactId`

New `PartnerContact` fields: `title`, `phone`, `linkedinUrl`, `affiliation`, `notes`, `preferredChannel PartnerChannel? { Email, Phone, Slack, Other }`. Page shows memberships, applications, meetings attended, email threads, timeline.

### Org and contact timeline

`PartnerActivity` gains nullable `orgId` and `contactId`, both indexed. `logPartnerActivity` fills them from the application. Backfill migration sets them for existing rows. New activity types: `MeetingRequested`, `MeetingRequestDeclined`, `EmailReceived` is not stored (emails merge at read time from `MailMessageIndex`), `ContractSent`, `ContractSigned`, `InvoiceIssued`, `InvoicePaid`, `ProjectLinked`, `ProjectEnded`, `SurveyReceived`, `OrgUpdated`. Org-level actions (link project, edit details, invite member) log an activity with `orgId` and no application, replacing the audit-log-only trail. Audit events stay for Admin.

### Directory `/core/partners/directory`

`SegmentedTabButtons` Organizations / Contacts, `SearchInput`, `ViewToggle`, type and status filters, "Include individuals" toggle. Replaces the hand-rolled toggle on today's `partners.tsx`. Duplicate hint: creating a contact with an email that exists links to the existing one; creating an org whose name matches case-insensitively shows a warning with a link. Merge is an action on the org page: pick a survivor, memberships, applications, project links and activities repoint, the other row is deleted.

## 8. Email capture

- A `MailAccount { kind: Shared, address: partners@dali.dartmouth.edu }` row is created in Admin → Email like applications@.
- `runApplicantEmailIndex` is generalized into `runSharedInboxIndex(address, ctx)`; two registry entries, `applicant-email-index` and `partner-email-index`, call it with their address. `getMailboxReader(address, purpose)` takes the purpose. Error strings lose the word Hiring.
- `MailMessageIndex` gains `linkedPartnerContactId String?` with an index. `indexMessages` matches counterpart addresses against `PartnerContact.email` after the `UserEmail` match. Manual link and unlink reuse `setThreadLink` with a contact target.
- Engagement reads take an `accountId` scope so applicant mail and partner mail never mix.
- `ApplicantEmailPanel` and `ApplicantEmailThreadModal` are generalized to `SharedInboxPanel` and `SharedInboxThreadModal` taking a thread list and an access checker. Hiring keeps its wrappers. The CRM Email tab and the contact page use them.
- Compose from the record: a "Send email" action opens a template picker over `EMAIL_TEMPLATES` entries with `purpose: "Partners"`, resolves tokens with a new `resolvePartnerVariables(application)` (`partnerName`, `orgName`, `projectTitle`, `nextMeetingDate`, `portalLink`), and sends via `enqueueOutbound`. The seven hard-coded lifecycle emails in `partner-emails.server.ts` move into `EMAIL_TEMPLATES` so Core can edit them (matches the email standardization work).
- Flag `partner-email` gates the Email tab and the index job.

## 9. Notifications and jobs

`EventDef["area"]` gains `"Partners"`. Recipients are all active Core members, which is what no ownership means operationally.

| eventType | Trigger | defaults |
|---|---|---|
| `partner.inquiry_received` | new application from the portal or email | inApp, desktop, email Daily |
| `partner.meeting_requested` | partner request | inApp, desktop, slackDm, timeSensitive |
| `partner.stale` | open card past the stale threshold | inApp, email Daily |
| `partner.next_step_due` | next step due today | inApp, desktop |
| `partner.renewal_due` | renewal card auto-created | inApp |
| `partner.contract_signed` | signature recorded | inApp, slackDm |
| `partner.survey_received` | post-project survey submitted | inApp |

Jobs (registry entries, handlers under `app/jobs/`):

| name | interval | work |
|---|---|---|
| `partner-email-index` | 10 min, off by default | section 8 |
| `partner-stale-sweep` | 60 min | claim/send `partner.stale` once per card per week when `lastActivityAt` older than `staleDays` (setting, default 14) and stage open and not paused |
| `partner-next-step-reminders` | 5 min | claim/send `partner.next_step_due` the morning a next step is due |
| `partner-renewal-sweep` | daily | for each `ProjectPartner` ending within the current term with no open application for the org, create a New application with `source: Renewal`, title "Renew: <project>", and notify |
| `partner-request-expiry` | 60 min | mark `PartnerMeetingRequest` rows whose `startTime` has passed while Pending as Expired, log an activity |

## 10. Contract, SOW, finance

### Contract

A `SigningDocument` kind `PartnerContract` authored in Core → Agreements. Per application, the Acceptance panel fills legal entity, fee, funding type and sends: creates a `SigningBinding` with scopeKey `partner-app:<id>`, `PartnerApplication.contractBindingId`. The partner signs at `/partner/applications/:id/sign-contract` using `SigningFillView` with roleKey `member` and `resolvePartnerContractVariables`. Status is read from the binding, shown in the rail and on the card as a Contract chip (Not sent, Sent, Signed). This is the #1114 design rebuilt on the current engine.

### SOW

`sowState PartnerSowState { Draft, Shared, Accepted } @default(Draft)` on the application. Shared makes the SOW readable in the portal; Accepted locks the editor (read-only `DocEditor` preset) and snapshots a version via `name_collab_version`. Partner comments on the SOW stay out of scope (CRDT-sensitive, noted before).

### Deal terms and invoices

On `PartnerApplication`: `fundingType ProjectFundingType?` replaces free-text `fundingModel` (migration maps nothing, old text copied into `decisionReason` notes if present), `feeCents Int?`, `legalEntityName`, `legalEntityAddress`, `paymentSchedule String?`. These flow into the contract variables.

New `PartnerInvoice { id, orgId, projectId?, applicationId?, amountCents, issuedAt, dueAt, paidAt?, status PartnerInvoiceStatus { Draft, Issued, Paid, Void }, reference, note }`. Manual entry on the org Finance tab. Chart strings join through `ProjectPartner` to `ProjectChartString` with no new FK. Finance tab shows fee, funding type, chart strings per term, invoices, outstanding total.

## 11. Post-project

- Survey: a bound Form via `PartnerSurveyFormBinding` (one row, same pattern as the application binding, registered in `formUsages()`). When `ProjectPartner.endedAt` is set, an email with a portal link goes out; the submission logs `SurveyReceived` on the org timeline and the answers render on the org page.
- Showcase: `ProjectShowcase.partners String[]` stays, but the editor offers a picker from `PartnerOrg` names and `showcaseConsent` is shown next to each.
- Referral: `referredByContactId` on org and `source: Referral` on applications.
- Dormant list on the Directory: relationship status Dormant filter.

## 12. Reporting `/core/partners/reports`

Term selector plus:

- Funnel: New, Interview, Accepted, Rejected counts and conversion by term and by source.
- Cycle time: median days from `Created` to Accepted and to project creation, from activity timestamps.
- Rejection reasons breakdown.
- Partner mix: new versus returning orgs per term (returning means a prior `ProjectPartner`).
- Capacity: projected headcount by domain per term versus staffed assignments.
- Revenue by org and term from invoices when present.

Charts use the dataviz conventions already in the repo (Recharts with the OS palette tokens).

## 13. Hygiene in the same PR

- Drop `PartnerUser` table and the `PartnerOrg.users` relation.
- Drop `assignedMeeterId`, `fundingModel` after migration.
- `canViewStaffing` reads on partner routes become `isCore`.
- MCP: `list_partner_applications` and `manage_partner_application` speak stages; `manage_partner_meeting` creates `ScheduledMeeting`s; new `list_partner_contacts`, `manage_partner_contact`, `respond_partner_meeting_request`; `get_partner_org` returns the 360 shape.
- CSV export of orgs and contacts from the Directory.
- ⌘K search indexes orgs and contacts.
- Seed: four-stage data, a partners@ `MailAccount`, one pending request, one invoice.
- E2E: `partner-portal.spec.ts` updated for four nodes, request via the grid, contract sign; new `partner-crm.spec.ts` for board drag, modal, scheduler open, directory.

## 14. Migrations

All additive first, then destructive, in this order:

1. `partner_crm_stage`: new enum and column, backfill, drop old column and enum.
2. `partner_crm_fields`: new columns on application (incl. `position`), org, contact, activity; `MailMessageIndex.linkedPartnerContactId`; `PartnerMeeting.scheduledMeetingId`.
3. `partner_crm_tables`: `PartnerMeetingRequest`, `PartnerInvoice`, `PartnerSurveyFormBinding`, `PartnerCrmSettings` (one row: `interviewPanelUserIds`, `staleDays`).
4. `partner_crm_activity_backfill`: fill `orgId` and `contactId` on existing activities.
5. `partner_crm_drop_legacy`: drop `PartnerUser`, `assignedMeeterId`, `fundingModel`.

Data-losing steps (1, 5) are called out in the PR description. `ALTER TYPE ADD VALUE` and use of the value never share a migration.

## 15. Feature flags

- `partner-crm-v2`: gates the Core route set and the redirect. Off means `/partners` keeps working as today.
- `partner-email`: Email tab and index job.
- `partner-finance`: Finance tab, invoices, deal terms in the rail.

## 16. Build order inside the PR

1. Schema and migrations, stage vocabulary, `setApplicationStatus`.
2. Lift `TaskCard` and modal-field helpers to shared modules; task board imports them (no visual change).
3. Core route move, nav, redirects, guards.
4. Board and modal.
5. Scheduler refactor and Core-side meetings.
6. Portal scheduler, request, Core accept/decline, portal meetings.
7. Org and contact 360, directory, merge.
8. Email capture.
9. Notifications and jobs.
10. Contract, SOW state, finance.
11. Post-project and reports.
12. MCP, seed, e2e, hygiene drops.

Each step is a separate commit on one branch so review can follow it.

## 17. Decisions log

- 2026-10-06 Kiran: request feature = the partner uses the real calendar scheduling component from the portal (not a Core-offers-slots loop). Manual card ordering inside columns is important; the board is sortable like the task board.
- Assumed, not yet confirmed: finance (invoices, deal terms, contract) stays in behind `partner-finance`; Rejected cards older than the current term hide by default.

## 18. UI review (2026-10-06, after the first build)

Kiran: "Add new in taskboard doesn't really make sense. Let's not have rows upon rows of navigation. The modal that opens is good in theory but looks very rough rn." Plus: audit CTAs and accents against the rest of the app.

### Board page

- One navigation row only. Left: the Partner CRM pills (Board, Directory, Reports, Settings). Right, same row: `SearchInput`, the Customize button, the shared `ViewToggle` (board/list icons, like the Directory page), and the `os-add-btn` "New application". No h1 (the breadcrumb already says Partner CRM), no List/Board text toggle row, no count line in board view.
- The board starts directly under that row.
- Remove the per-column dashed "Add new" list header and the "Add application" column menu item. One create affordance, the top-right button.
- Move the Application form binding block to `/core/partners/settings` (it is configuration). Remove the headcount chart from the board page; the Reports page's Capacity section owns it, and the Customize panel is the only other control on the page.
- Column headers: plain label in the header ink (done), count pill, collapse menu.

### Modal

- Header: type badge gets a fill. Add `.os-type-badge--partner` (coral family: `--os-partner-fill` / `--os-partner-ink` defined next to the epic/story/task tokens in both light and dark blocks). Remove the stage `Select` from the header; the rail already has Stage. Header is badge, title (record caps as the task modal does), pencil, close.
- Tabs: `UnderlineTabButtons` across the left column, not a floating pill container. Content sits directly under the underline with the standard 16px gap.
- Activity tab: no nested bordered card. The feed is flat; the note composer sits under it the way the task modal's comment composer does (`MentionTextInput` + one small primary button).
- Rail: every editable value uses the borderless `PROP_CONTROL` style inside `PropRow` (next step text, fee, legal entity). `DateField` and `Select`/`MultiSelect` keep their shared look. Read-only values are plain `text-sm`. Links use the app link treatment the full page already uses.
- Footer: left "Open full page" ghost link; right the stage-aware primary (`Button variant="primary"`, which the OS shell renders in the OS accent) and the secondary actions. Reject stays a destructive text link. Nothing else in the footer.
- Width `max-w-4xl`, body scrolls as one region, rail column `lg:w-72` fixed so the tab column does not jump between tabs.

### Everywhere

- CTA: `Button`/`buttonClasses("primary")` for the one primary action per surface, `os-add-btn` only for "make a new record" on list pages, `secondary` for cancel, `ghost` for links that look like buttons. No hand-rolled button classes.
- Accents: coral is the brand primary (links, focus), the OS shell paints primary buttons in `--color-os-accent`; teal appears only where the shell's accent is teal. Do not introduce ad-hoc Tailwind colour classes (`text-amber-700` etc.) in partner components; use the chip tones in `BoardCardChip` and the stage pill map.
- Copy: no em dashes anywhere in partner UI strings.
