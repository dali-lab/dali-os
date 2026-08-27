import { type RouteConfig, index, layout, route } from "@react-router/dev/routes";

export default [
  // UI routes wrapped in the app layout (navbar + view toggle)
  layout("routes/layout.tsx", [
    index("routes/home.tsx"),
    route("profile", "routes/profile.tsx"),
    route("onboarding", "routes/onboarding.tsx"),
    route("calendar", "calendar/routes/calendar.tsx"),
    // One meeting surface: details, note link, and attendance (roster + self
    // check-in QR + wallet scan) in one place.
    route("calendar/meeting/:id", "calendar/routes/calendar.meeting.$id.tsx"),
    // Standalone self-check-in surface for meetings without a meeting note.
    route("calendar/check-in/:id", "calendar/routes/calendar.check-in.$id.tsx"),
    // Organizer/Core scan station: scan members' wallet passes to mark them
    // present (the inverse of self-check-in).
    route("calendar/scan/:meetingId", "calendar/routes/calendar.scan.$meetingId.tsx"),
    // My Tasks surface: Open tasks + browsable notification history.
    route("notifications", "routes/notifications.tsx"),
    // Document signing: the member "documents to sign" inbox + per-agreement
    // fill/sign page. The app gate (layout loader) redirects here when a
    // required agreement is unsigned.
    route("sign", "signing/routes/sign._index.tsx"),
    route("sign/:bindingId", "signing/routes/sign.$bindingId.tsx"),
    route("sign/:bindingId/pdf", "signing/routes/sign.$bindingId.pdf.ts"),

    // Hiring section. /hiring is the role-aware hub; the tools below are
    // reached via its pill row (the sidebar carries a single Hiring entry).
    route("hiring", "hiring/routes/hiring.tsx"),
    route("hiring/reviewer", "hiring/routes/reviewer.tsx"),
    route("hiring/reviewer/application/:id", "hiring/routes/reviewer.application.$id.tsx"),
    // Applications database: list of all submissions for a cycle, scoped by
    // role (Core = all domains, reviewer = own domains). Read-only detail.
    route("hiring/applications", "hiring/routes/applications.tsx"),
    route("hiring/applications/:domainApplicationId", "hiring/routes/applications.$domainApplicationId.tsx"),
    route("hiring/domain-lead", "hiring/routes/domain-lead.tsx"),
    route("hiring/domain-lead/application/:id", "hiring/routes/domain-lead.application.$id.tsx"),
    route("hiring/domain-lead/delibs/:id", "hiring/routes/domain-lead.delibs.$id.tsx"),
    route("hiring/lead", "hiring/routes/lead.tsx"),
    route("hiring/lead/cycle/:id", "hiring/routes/lead.cycle.$id.tsx"),
    route("hiring/lead/internal-cycle/:id", "hiring/routes/lead.internal-cycle.$id.tsx"),
    // Cross-cycle by design (accepting off a waitlist may land in a later
    // cycle), so it lives beside the other hiring tools, not under /lead.
    route("hiring/waitlists", "hiring/routes/waitlists.tsx"),
    // Accepted-applicant provisioning board (DALI email, Slack, Figma,
    // profile form) — Core-only, same sensitivity tier as the lead dashboard.
    route("hiring/onboarding", "hiring/routes/onboarding.tsx"),
    // Library — challenges, rubrics, and confidentiality agreements behind one
    // page with pills. The list views are consolidated here; the detail pages
    // keep their original paths.
    route("hiring/library", "hiring/routes/library.tsx"),
    route("hiring/rubrics/:id", "hiring/routes/rubrics.$id.tsx"),
    route("hiring/emails", "hiring/routes/email-templates.tsx"),
    route("hiring/emails/:id", "hiring/routes/email-templates.$id.tsx"),
    route("hiring/confidentiality-agreements/:id", "hiring/routes/confidentiality-agreements.$id.tsx"),
    route("hiring/cycles/:cycleId/confidentiality", "hiring/routes/cycles.$cycleId.confidentiality.tsx"),
    // Interviewer surfaces: list (availability + assigned) and detail.
    route("hiring/interviews", "hiring/routes/interviews.tsx"),
    route("hiring/interviews/:interviewId", "hiring/routes/interviews.$interviewId.tsx"),
    route("hiring/analytics", "hiring/routes/analytics.tsx"),

    // Operations (top-level, not hiring). /admin is the nested hub; the three
    // multi-section clusters have their own landing hubs (Documents & Finance
    // are single-section and link straight to their tool from the hub).
    route("admin", "admin/routes/admin.tsx"),
    route("admin/people", "admin/routes/admin.people.tsx"),
    route("admin/communications", "admin/routes/admin.communications.tsx"),
    route("admin/system", "admin/routes/admin.system.tsx"),
    route("admin/members", "admin/routes/admin.members.tsx"),
    route("admin/domains", "admin/routes/admin.domains.tsx"),
    route("admin/announcements", "admin/routes/admin.announcements.tsx"),
    route("admin/attendance", "admin/routes/admin.attendance.tsx"),
    route("admin/activity", "admin/routes/admin.activity.tsx"),
    route("admin/analytics", "admin/routes/admin.analytics.tsx"),
    route("admin/ai-usage", "admin/routes/admin.ai-usage.tsx"),
    route("admin/jobs", "admin/routes/admin.jobs.tsx"),
    route("admin/feature-flags", "admin/routes/admin.feature-flags.tsx"),
    route("admin/email-senders", "admin/routes/admin.email-senders.tsx"),
    route("admin/outbound-messages", "admin/routes/admin.outbound-messages.tsx"),
    route("admin/email-templates", "admin/routes/admin.email-templates.tsx"),
    route("admin/email-templates/:id", "admin/routes/admin.email-templates.$id.tsx"),
    // Document signing: author agreements, place fields, put versions in force,
    // track signatories.
    route("core/agreements", "signing/routes/core.agreements.tsx"),
    route("core/agreements/:id", "signing/routes/core.agreements.$id.tsx"),
    route("core/agreements/:id/signature/:sigId", "signing/routes/core.agreements.$id.signature.$sigId.tsx"),
    route("core/agreements/:id/signature/:sigId/pdf", "signing/routes/core.agreements.$id.signature.$sigId.pdf.ts"),
    route("api/agreements/people", "signing/routes/api.agreements.people.ts"),
    route("api/agreements/issue", "signing/routes/api.agreements.issue.ts"),
    route("admin/payroll-export", "admin/routes/admin.payroll-export.tsx"),
    route("admin/payroll", "admin/routes/admin.payroll.tsx"),

    // Core — the lab-process area introduced by the nav-regroup flag. Every
    // page here except the hub is a pure re-export of its pre-regroup route
    // (app/core/routes/), so there is one implementation per surface and the
    // old URL keeps working; the source loaders redirect flag-on viewers here.
    route("core", "core/routes/core.hub.tsx"),
    route("core/staffing", "core/routes/core.staffing.tsx"),
    route("core/intent-to-work", "core/routes/core.intent-to-work.tsx"),
    route("core/intent-to-work/:userId", "core/routes/core.intent-to-work.$userId.tsx"),
    route("core/project-bids", "core/routes/core.project-bids.tsx"),
    route("core/project-bids/:userId", "core/routes/core.project-bids.$userId.tsx"),
    route("core/level-up", "core/routes/core.level-up.tsx"),
    route("core/level-up/:userId", "core/routes/core.level-up.$userId.tsx"),
    route("core/access/roles", "core/routes/core.access.roles.tsx"),
    route("core/access/domains", "core/routes/core.access.domains.tsx"),
    route("core/attendance", "core/routes/core.attendance.tsx"),
    route("core/communications", "core/routes/core.communications.tsx"),
    route("core/communications/announcements", "core/routes/core.communications.announcements.tsx"),
    route("core/communications/email", "core/routes/core.communications.email.tsx"),
    route("core/communications/email/:id", "core/routes/core.communications.email.$id.tsx"),
    route("core/communications/email-senders", "core/routes/core.communications.email-senders.tsx"),

    // Projects. The bare /projects route is the area hub (the project list).
    route("projects", "projects/routes/projects.hub.tsx"),
    route("projects/staffing", "projects/routes/projects.staffing.tsx"),
    // Staffing input forms (member self-service). Must precede projects/:id
    // so these literal segments aren't captured by the :id param.
    route("projects/intent-to-work", "projects/routes/projects.intent-to-work.tsx"),
    route(
      "projects/intent-to-work/:userId",
      "projects/routes/projects.intent-to-work.$userId.tsx",
    ),
    route("projects/project-bids", "projects/routes/projects.project-bids.tsx"),
    route(
      "projects/project-bids/:userId",
      "projects/routes/projects.project-bids.$userId.tsx",
    ),
    route("projects/level-up", "projects/routes/projects.level-up.tsx"),
    route(
      "projects/level-up/:userId",
      "projects/routes/projects.level-up.$userId.tsx",
    ),
    route("projects/:id", "projects/routes/projects.$id.tsx"),
    route(
      "projects/:id/partner-view",
      "projects/routes/projects.$id.partner-view.tsx",
    ),
    route(
      "projects/:id/public-view",
      "projects/routes/projects.$id.public-view.tsx",
    ),

    // Drive — the unified documents + files + forms + agreements hub. This is the
    // only browsing surface; the old /documents and /forms hubs have been removed
    // (their editor/viewer deep-link routes remain, below).
    route("drive", "routes/drive.hub.tsx"),
    // Unified Templates gallery (documents, forms, mentor notes, email,
    // agreements), gated behind the `templates` feature flag.
    route("drive/templates", "routes/drive.templates.tsx"),

    // Documents & files — full-page reusable editor + file viewer. Literal
    // "file" segment precedes the :pageId param so it isn't captured. Browsing
    // lives in the unified Drive (/drive); these routes are the deep-link
    // editor/viewer the Drive opens into.
    route("documents/file/:fileId", "routes/documents.file.$fileId.tsx"),
    // Agreement authoring in the Drive. Literal "agreement" segment must precede
    // any :pageId param so it isn't captured. Re-exports the admin implementation
    // — one authoring surface, two URLs.
    route("documents/agreement/:id", "signing/routes/documents.agreement.$id.tsx"),
    route(
      "documents/agreement/:id/signature/:sigId",
      "signing/routes/documents.agreement.$id.signature.$sigId.tsx",
    ),
    route("documents/:pageId", "routes/documents.$pageId.tsx"),

    // Members directory (separate from admin/members)
    route("members", "members/routes/members.tsx"),
    route("members/groups", "members/routes/members.groups.tsx"),
    route("members/:id", "members/routes/members.$id.tsx"),

    // Partners
    route("partners", "partners/routes/partners.tsx"),
    route("partners/applications", "partners/routes/partners.applications.tsx"),
    route("partners/applications/:id", "partners/routes/partners.applications.$id.tsx"),
    // Literal segments above the param route (repo route-ordering convention).
    route("partners/:orgId", "partners/routes/partners.$orgId.tsx"),

    // Education. Literal "manage" segments must precede the :offeringId param
    // so /education/manage/* isn't captured as an offering id.
    route("education", "education/routes/education.tsx"),
    route("education/compliance", "education/routes/education.compliance.tsx"),
    route("education/manage", "education/routes/education.manage.tsx"),
    route("education/manage/new", "education/routes/education.manage.new.tsx"),
    route("education/manage/assignments/:assignmentId", "education/routes/education.manage.assignments.$assignmentId.tsx"),
    route("education/manage/:offeringId", "education/routes/education.manage.$offeringId.tsx"),
    route("education/:offeringId", "education/routes/education.$offeringId.tsx"),
    route("education/:offeringId/apply", "education/routes/education.$offeringId.apply.tsx"),
    route("education/:offeringId/hub", "education/routes/education.$offeringId.hub.tsx"),
    route("education/:offeringId/page/:pageId", "education/routes/education.$offeringId.page.$pageId.tsx"),
    route("education/:offeringId/assignments/:assignmentId", "education/routes/education.$offeringId.assignments.$assignmentId.tsx"),

    // Mentorship — weekly notes hub + browser + templates (Core).
    // Hidden from mentees entirely; gated server-side by canViewMentorship.
    route("mentorship", "mentorship/routes/mentorship.tsx"),
    route("mentorship/browse", "mentorship/routes/mentorship.browse.tsx"),
    route("mentorship/notes/:id", "mentorship/routes/mentorship.notes.$id.tsx"),

    // Internal processes. The area hub and JobX are retired; this path is kept
    // so existing links, favorites, and bookmarks still resolve.
    route("internal-processes/level-up", "internal-processes/routes/internal-processes.level-up.tsx"),

    // Forms. Browsing lives in the unified Drive (/drive); these are the
    // deep-link editor/responses surfaces plus the action-only mutation
    // endpoint the Drive and editor POST to.
    route("api/forms", "routes/api.forms.ts"),
    route("forms/edit/:formId", "forms/routes/forms.edit.$formId.tsx"),
    route("forms/preview-resolve", "forms/routes/forms.preview-resolve.ts"),
    route("forms/responses/:formId", "forms/routes/forms.responses.$formId.tsx"),

    // Internal applicant portal — Fellowship (intern → full-time) and Core
    // (member → Core). Authenticated member routes (not under /portal) so
    // members use their existing session rather than the CAS flow built for
    // external applicants. Both render the shared internal-cycle portal.
    // Core's portal lives at /core/apply, not /core: the nav-regroup Core hub
    // (core/routes/core.hub.tsx) owns /core, so the hub loader redirects
    // eligible non-Core members here when a Core cycle is open.
    route("fellowship", "routes/fellowship.tsx"),
    route("core/apply", "routes/core.tsx"),
    // Legacy path — old notification/task links pointed at /intern-to-full.
    route("intern-to-full", "routes/intern-to-full.legacy.tsx"),

    // Settings — opened from the sidebar footer icon. Lives under the layout
    // so in-iframe navigation posts `dali:tabNavigated` and the workspace's
    // tab URL tracks it (a stale URL made re-clicking Settings focus the
    // drifted tab instead of reopening the hub).
    route("settings", "routes/settings._index.tsx"),
    route("settings/calendar", "routes/settings.calendar.tsx"),
    route("settings/notifications", "routes/settings.notifications.tsx"),
    route("settings/sessions", "routes/settings.sessions.tsx"),
    route("settings/slack", "routes/settings.slack.tsx"),
    route("settings/connected-apps", "routes/settings.connected-apps.tsx"),

    // Help pages (same convention as Settings).
    route("help", "routes/help._index.tsx"),
    route("help/getting-started", "routes/help.getting-started.tsx"),
    route("help/shortcuts", "routes/help.shortcuts.tsx"),
    route("help/calendar", "routes/help.calendar.tsx"),
    route("help/staffing", "routes/help.staffing.tsx"),
    route("help/notifications", "routes/help.notifications.tsx"),
    route("help/mcp", "routes/help.mcp.tsx"),
  ]),

  // Applicant portal (lightweight layout). /portal is the non-member home
  // dashboard; the hiring application tracker lives at /portal/hiring.
  layout("routes/applicant-layout.tsx", [
    route("portal", "routes/portal.tsx"),
    route("portal/hiring", "routes/portal.hiring.tsx"),
    route("portal/apply", "routes/portal.apply.tsx"),
    route("portal/application", "routes/portal.application.tsx"),
    route("portal/settings", "routes/portal.settings.tsx"),
    // Education mirror for non-member Dartmouth students.
    route("portal/education", "routes/portal.education.tsx"),
    route("portal/education/:offeringId", "routes/portal.education.$offeringId.tsx"),
    route("portal/education/:offeringId/apply", "routes/portal.education.$offeringId.apply.tsx"),
    route("portal/education/:offeringId/hub", "routes/portal.education.$offeringId.hub.tsx"),
    route("portal/education/:offeringId/page/:pageId", "routes/portal.education.$offeringId.page.$pageId.tsx"),
    route("portal/education/:offeringId/assignments/:assignmentId", "routes/portal.education.$offeringId.assignments.$assignmentId.tsx"),
  ]),

  // Partner portal (external partner shell). Singular /partner =
  // partner-facing; plural /partners = the internal Core surface registered
  // in the member layout above.
  layout("partners/routes/partner-layout.tsx", [
    route("partner", "partners/routes/partner.home.tsx"),
    route("partner/apply", "partners/routes/partner.apply.tsx"),
    route("partner/applications/:id", "partners/routes/partner.applications.$id.tsx"),
    route("partner/settings", "partners/routes/partner.settings.tsx"),
    route("partner/projects/:id", "partners/routes/partner.projects.$id.tsx"),
    route("partner/projects/:id/pages/:pageId", "partners/routes/partner.projects.$id.pages.$pageId.tsx"),
  ]),

  // Partner auth (no layout).
  route("partner/login", "partners/routes/partner.login.tsx"),
  route("partner/auth/verify", "partners/routes/partner.auth.verify.tsx"),
  route("partner/invite/:token", "partners/routes/partner.invite.$token.tsx"),
  route("partner/onboarding", "partners/routes/partner.onboarding.tsx"),

  // Authenticated member form fill (no layout), token-addressed. Every form
  // is filled while logged in — the submitter is always the session user, so
  // there's no name/email capture and submissions can drive StaffingPreference
  // / close the recipient's task.
  route("forms/fill/:token", "routes/forms.fill.$token.tsx"),
  route("api/forms/fill/:token", "routes/api.forms.fill.$token.ts"),

  // Education certificates (no layout — portal users open these too; the PDF
  // is a resource route that streams a bare body).
  route("education/certificates/:certificateId", "education/routes/certificates.$certificateId.tsx"),
  route("education/certificates/:certificateId/pdf", "education/routes/certificates.$certificateId.pdf.ts"),

  // Public policy pages (no auth, no layout) — linked from the Google OAuth
  // consent screen, so they must load for an unauthenticated reviewer.
  route("privacy", "routes/privacy.tsx"),
  route("terms", "routes/terms.tsx"),

  // Public, shareable desktop download page (OS auto-detect). Not linked from
  // anywhere yet — reachable by direct URL.
  route("download", "routes/download.tsx"),

  // Login (no layout)
  route("login", "routes/login.tsx"),
  route("dev-login", "routes/dev-login.ts"),
  route("dev-login-as", "routes/dev-login-as.ts"),
  route("logout", "routes/logout.ts"),
  route("auth/callback/google", "routes/auth.callback.google.ts"),
  route("auth/callback/cas", "routes/auth.callback.cas.ts"),

  // Desktop device pairing (GitHub-CLI style). Additive — OAuth + login
  // untouched. /link is the only new web UI surface. See TAURI_DESKTOP_PLAN.md.
  route("auth/pair/start", "routes/auth.pair.start.ts"),
  route("auth/pair/approve", "routes/auth.pair.approve.ts"),
  route("auth/pair/poll", "routes/auth.pair.poll.ts"),
  route("auth/handoff", "routes/auth.handoff.ts"),
  route("link", "routes/link.tsx"),
  route("api/desktop/version", "routes/api.desktop.version.ts"),

  // OAuth endpoints (no layout)
  route("oauth/authorize", "routes/oauth.authorize.ts"),
  route("oauth/callback/google", "routes/oauth.callback.google.ts"),
  route("oauth/callback/cas", "routes/oauth.callback.cas.ts"),
  route("oauth/token", "routes/oauth.token.ts"),
  route("oauth/revoke", "routes/oauth.revoke.ts"),
  route("oauth/register", "routes/oauth.register.ts"),
  route("oauth/consent", "routes/oauth.consent.tsx"),
  route("oauth/calendar/google/start", "routes/oauth.calendar.google.start.ts"),
  route("integrations/calendar/google/callback", "routes/integrations.calendar.google.callback.ts"),

  // MCP foundation (no layout)
  route(".well-known/oauth-authorization-server", "routes/well-known.oauth-authorization-server.ts"),
  route(
    ".well-known/oauth-protected-resource",
    "routes/well-known.oauth-protected-resource.ts",
    { id: "well-known.oauth-protected-resource" },
  ),
  route(
    ".well-known/oauth-protected-resource/mcp",
    "routes/well-known.oauth-protected-resource.ts",
    { id: "well-known.oauth-protected-resource.mcp" },
  ),
  route("mcp", "routes/mcp.ts"),

  // Authenticated API endpoints (no layout)
  route("users/:id", "members/routes/users.$id.ts"),

  // Global command-palette search (⌘K) — permission-scoped in the loader.
  route("api/search", "routes/api.search.ts"),

  // Domain & member management API
  route("api/domains", "admin/routes/api.domains.ts"),
  route("api/domains/:domainId", "admin/routes/api.domains.$domainId.ts"),
  route("api/domains/:domainId/leads", "admin/routes/api.domains.$domainId.leads.ts"),
  route("api/members", "admin/routes/api.members.ts"),
  route("api/members/:memberId/roles", "admin/routes/api.members.$memberId.roles.ts"),

  // Groups (admin) and notifications (per-user + admin send)
  route("api/groups", "admin/routes/api.groups.ts"),
  route("api/groups/:groupId", "admin/routes/api.groups.$groupId.ts"),
  route("api/tour/complete", "routes/api.tour.complete.ts"),
  route("api/timezone/update", "routes/api.timezone.update.ts"),
  route("api/notifications", "routes/api.notifications.ts"),
  route("api/notifications/stream", "routes/api.notifications.stream.ts"),
  route("api/presence/statuses", "routes/api.presence.statuses.ts"),
  route("api/presence/hide-activity", "routes/api.presence.hide-activity.ts"),
  route("api/notifications/send", "admin/routes/api.notifications.send.ts"),
  route("api/notifications/:id/read", "routes/api.notifications.$id.read.ts"),
  route("api/notifications/:id/rsvp", "routes/api.notifications.$id.rsvp.ts"),

  // Background jobs: admin controls + the manual tick trigger (secret header
  // or admin session; the in-process 60s interval is the primary driver).
  route("api/jobs/:name", "admin/routes/api.jobs.$name.ts"),
  route("api/feature-flags/:key", "admin/routes/api.feature-flags.$key.ts"),
  route("internal/jobs/tick", "jobs/routes/internal.jobs.tick.ts"),

  // Public showcase API — the read surface dali.website renders from. No
  // member session: authorized by the SHOWCASE_API_SECRET header and called
  // server-to-server by the website, never from a browser. Each handler
  // serves a deliberately narrow projection; see app/public-api/lib.
  route("api/public/projects", "public-api/routes/api.public.projects.ts"),
  route("api/public/projects/:id", "public-api/routes/api.public.projects.$id.ts"),
  route("api/public/team", "public-api/routes/api.public.team.ts"),
  route("api/public/offerings", "public-api/routes/api.public.offerings.ts"),
  route("api/public/media", "public-api/routes/api.public.media.ts"),

  // Scheduled meetings
  route("api/scheduled-meetings", "calendar/routes/api.scheduled-meetings.ts"),
  route("api/scheduled-meetings/:id/cancel", "calendar/routes/api.scheduled-meetings.$id.cancel.ts"),
  route("api/scheduled-meetings/:id/attendance", "calendar/routes/api.scheduled-meetings.$id.attendance.ts"),
  route("api/scheduled-meetings/:id/check-in", "calendar/routes/api.scheduled-meetings.$id.check-in.ts"),
  // Wallet-pass scan check-in: an operator scans a member's pass to mark them
  // present (inverse of self-check-in; the member is taken from the pass token).
  route(
    "api/scheduled-meetings/:id/scan-attendee",
    "calendar/routes/api.scheduled-meetings.$id.scan-attendee.ts",
  ),
  // Organizer/Core PDF of the self-check-in QR (print / project at the event).
  route(
    "api/scheduled-meetings/:id/check-in-qr.pdf",
    "calendar/routes/api.scheduled-meetings.$id.check-in-qr.pdf.ts",
  ),
  // Wallet membership pass: download the signed .pkpass (Apple) or a
  // save-to-Google-Wallet link, each for the current user only.
  route("api/wallet/apple/pass", "wallet/routes/api.wallet.apple.pass.ts"),
  route("api/wallet/google/save-url", "wallet/routes/api.wallet.google.save-url.ts"),
  route("api/calendar/group-availability", "calendar/routes/api.calendar.group-availability.ts"),
  // JobX browser extension export — see jobx-extension/README.md.
  route("api/timesheets/export", "routes/api.timesheets.export.ts"),

  // Slack bot (webhook receivers; signature-verified, no auth middleware)
  route("api/slack/events", "slack/routes/api.slack.events.ts"),
  route("api/slack/interactivity", "slack/routes/api.slack.interactivity.ts"),

  // GitHub webhook (signature-verified). Mirrors issue events back into linked
  // tasks (close → Done, reopen → InProgress, assignee + comment sync).
  route("api/webhooks/github", "projects/routes/api.webhooks.github.ts"),

  // Staffing input (bids / intent to work) is collected exclusively through
  // bound forms at /forms/fill/:token — there are no direct submit endpoints.

  // Staffing board (always open; one cycle per term, auto-created on view)
  route("api/staffing/assign", "projects/routes/api.staffing.assign.ts"),
  route("api/staffing/finalize", "projects/routes/api.staffing.finalize.ts"),
  route("api/staffing/term-channel", "projects/routes/api.staffing.term-channel.ts"),
  route("api/staffing/sync-teams", "projects/routes/api.staffing.sync-teams.ts"),
  route("api/staffing/board-member", "projects/routes/api.staffing.board-member.ts"),
  route("api/staffing/events", "projects/routes/api.staffing.events.ts"),
  route("api/staffing/reorder", "projects/routes/api.staffing.reorder.ts"),
  route("api/staffing/mentor-role", "projects/routes/api.staffing.mentor-role.ts"),
  route("api/staffing/external-mentor", "projects/routes/api.staffing.external-mentor.ts"),
  route("api/staffing/eligibility", "projects/routes/api.staffing.eligibility.ts"),

  // Core-only level correction for an already-finalized ProjectAssignment.
  route(
    "api/projects/assignments/:id/level",
    "projects/routes/api.assignment-level.ts",
  ),

  // Project task board
  route("api/projects/:id", "projects/routes/api.projects.$id.ts"),
  route("api/projects/:id/tasks", "projects/routes/api.projects.$id.tasks.ts"),
  route(
    "api/projects/:id/tasks/archive",
    "projects/routes/api.projects.$id.tasks.archive.ts",
  ),
  route("api/tasks/:id/move", "projects/routes/api.tasks.$id.move.ts"),
  route("api/tasks/:id/view", "projects/routes/api.tasks.$id.view.ts"),
  route("api/tasks/:id/comments", "projects/routes/api.tasks.$id.comments.ts"),
  route("api/tasks/:id/github", "projects/routes/api.tasks.$id.github.ts"),
  route("api/tasks/:id/files", "projects/routes/api.tasks.$id.files.ts"),
  route("api/tasks/:id", "projects/routes/api.tasks.$id.ts"),

  // Project epics & sprints
  route("api/projects/:id/epics", "projects/routes/api.projects.$id.epics.ts"),
  route("api/projects/:id/epics/reorder", "projects/routes/api.projects.$id.epics.reorder.ts"),
  route("api/epics/:id", "projects/routes/api.epics.$id.ts"),
  route(
    "api/epics/:id/description-doc",
    "projects/routes/api.epics.$id.description-doc.ts",
  ),
  route("api/epics/:id/stories", "projects/routes/api.epics.$id.stories.ts"),
  route("api/stories/:id", "projects/routes/api.stories.$id.ts"),
  route("api/projects/:id/sprints", "projects/routes/api.projects.$id.sprints.ts"),
  route("api/sprints/:id", "projects/routes/api.sprints.$id.ts"),

  // Project documents (collab Pages scoped to the project)
  route("api/projects/:id/documents", "projects/routes/api.projects.$id.documents.ts"),
  // Education offering documents (collab Pages scoped to the EducationOffering workspace)
  route("api/education/:offeringId/documents", "education/routes/api.education.$offeringId.documents.ts"),
  // Education offering files (uploaded S3-backed materials, mirrors api/projects/:id/files)
  route("api/education/:offeringId/files", "education/routes/api.education.$offeringId.files.ts"),
  // Lab-wide documents (collab Pages scoped to the Lab workspace)
  route("api/lab-documents", "routes/api.lab-documents.ts"),
  route("api/documents/:id", "projects/routes/api.documents.$id.ts"),
  route("api/pages/:id/partner-visible", "projects/routes/api.pages.$id.partner-visible.ts"),
  route("api/pages/:id/public-visible", "projects/routes/api.pages.$id.public-visible.ts"),

  // Personal notes (Member-workspace pages) — every write goes through one
  // intent-dispatched route; read access is enforced in personal-notes.server.
  route("api/notes", "members/routes/api.notes.ts"),
  route("api/pages/:id/pin", "projects/routes/api.pages.$id.pin.ts"),
  route("api/pages/:id/move", "projects/routes/api.pages.$id.move.ts"),
  route("api/pages/:id/duplicate", "routes/api.pages.$id.duplicate.ts"),
  route("api/pages/:id/share", "routes/api.pages.$id.share.ts"),
  route("api/pages/:id/favorite", "routes/api.pages.$id.favorite.ts"),
  route("api/favorites", "routes/api.favorites.ts"),
  route("api/favorites/route", "routes/api.favorites.route.ts"),
  route("api/move-destinations", "routes/api.move-destinations.ts"),
  // Drive unified tree: placement move for files and forms (Wave 3).
  route("api/drive/move", "routes/api.drive.move.ts"),
  // Drive unified file upload: scope-agnostic file registration (Lab or Project).
  route("api/drive/files", "routes/api.drive.files.ts"),
  route("api/pages/:id/template", "routes/api.pages.$id.template.ts"),
  route("api/pages/:id/typography", "routes/api.pages.$id.typography.ts"),
  route("api/page-templates", "routes/api.page-templates.ts"),

  // Project files (standalone uploads with versions)
  route("api/projects/:id/files", "projects/routes/api.projects.$id.files.ts"),
  route("api/files/:id", "projects/routes/api.files.$id.ts"),
  route("api/files/:id/partner-visible", "projects/routes/api.files.$id.partner-visible.ts"),

  // Lab-wide document/file tags
  route("api/doctags", "routes/api.doctags.ts"),
  route("api/doctags/apply", "routes/api.doctags.apply.ts"),

  // Comments + inline annotations on documents and files
  route("api/comments", "routes/api.comments.ts"),
  route("api/comments/:id", "routes/api.comments.$id.ts"),
  // SSE stream: pushes a `change` nudge when comments mutate for a doc page.
  route("api/comments/:pageId/stream", "routes/api.comments.$pageId.stream.ts"),

  // Batch user resolver — used by comments rail / presence avatars.
  route("api/users/resolve", "routes/api.users.resolve.ts"),

  // Per-page documentation guides + the member search that backs @-mentions
  route("api/page-docs/:key", "routes/api.page-docs.$key.ts"),
  route("api/mentions/search", "routes/api.mentions.search.ts"),
  route("api/mentions/card", "routes/api.mentions.card.ts"),
  route("api/custom-hires", "routes/api.custom-hires.ts"),
  route("api/mentions/pages", "routes/api.mentions.pages.ts"),

  // Document export (server-rendered PDF / Word)
  route("documents/:pageId/export", "routes/documents.$pageId.export.ts"),

  // Public read-only render for "Anyone with the link" documents — registered
  // OUTSIDE the app-shell layout so an unauthenticated visitor can read it. The
  // shell gate routes anon visitors of /documents/:pageId here for public docs.
  route("documents/:pageId/public", "routes/documents.$pageId.public.tsx"),

  // Payroll CSV export (resource route — registered OUTSIDE the app layout so
  // the Response streams as a bare CSV body, not wrapped in an HTML shell).
  route("admin/payroll-export.csv", "admin/routes/admin.payroll-export.csv.ts"),

  // Form responses CSV export (resource route — same bare-body reasoning).
  route("forms/responses/:formId/export.csv", "forms/routes/forms.responses.$formId.export.csv.ts"),

  // Payroll reconcile — upload (multipart action) + per-view CSV export.
  // Resource routes registered OUTSIDE the app layout (bare bodies, no shell).
  route("admin/payroll/upload", "admin/routes/admin.payroll.upload.ts"),
  route("admin/payroll/budget", "admin/routes/admin.payroll.budget.ts"),
  route("admin/payroll.csv", "admin/routes/admin.payroll.csv.ts"),

  // Partner application status (board drag-and-drop) + domain scope
  route("api/partner-applications/:id/status", "partners/routes/api.partner-applications.$id.status.ts"),
  route("api/partner-applications/:id/domains", "partners/routes/api.partner-applications.$id.domains.ts"),
  route("api/partner-application-domains/:id", "partners/routes/api.partner-application-domains.$id.ts"),


  // Hiring API — cycles, scheduling, applications, reviews, decisions, interviews, delibs
  route("api/hiring/cycles/:cycleId/status", "hiring/routes/api.cycles.$cycleId.status.ts"),
  route("api/hiring/cycles/:cycleId/interview-config", "hiring/routes/api.cycles.$cycleId.interview-config.ts"),
  route("api/hiring/cycles/:cycleId/reviewers", "hiring/routes/api.cycles.$cycleId.reviewers.ts"),
  route("api/hiring/cycles/:cycleId/reviewers/:reviewerId", "hiring/routes/api.cycles.$cycleId.reviewers.$reviewerId.ts"),
  route("api/hiring/cycles/:cycleId/my-availability", "hiring/routes/api.cycles.$cycleId.my-availability.ts"),
  route("api/hiring/cycles/:cycleId/my-interviews", "hiring/routes/api.cycles.$cycleId.my-interviews.ts"),
  route("api/hiring/cycles/:cycleId/my-interviews/:interviewId/decline", "hiring/routes/api.cycles.$cycleId.my-interviews.$interviewId.decline.ts"),
  route("api/hiring/cycles/:cycleId/my-interviews/:interviewId/notes", "hiring/routes/api.cycles.$cycleId.my-interviews.$interviewId.notes.ts"),
  route("api/hiring/cycles/:cycleId/available-slots", "hiring/routes/api.cycles.$cycleId.available-slots.ts"),
  route("api/hiring/cycles/:cycleId/interviews", "hiring/routes/api.cycles.$cycleId.interviews.ts"),
  route("api/hiring/cycles/:cycleId/interviewers", "hiring/routes/api.cycles.$cycleId.interviewers.ts"),
  route("api/hiring/cycles/:cycleId/coverage", "hiring/routes/api.cycles.$cycleId.coverage.ts"),
  route("api/hiring/cycles/:cycleId/delibs", "hiring/routes/api.cycles.$cycleId.delibs.ts"),
  route("api/hiring/cycles/:cycleId/domains/:domainId/auto-assign", "hiring/routes/api.cycles.$cycleId.domains.$domainId.auto-assign.ts"),
  route("api/hiring/cycles/:cycleId/confidentiality/sign", "hiring/routes/api.cycles.$cycleId.confidentiality.sign.ts"),

  route("api/hiring/my-interview", "hiring/routes/api.my-interview.ts"),
  route("api/hiring/my-interview/cancel", "hiring/routes/api.my-interview.cancel.ts"),
  route("api/hiring/my-interview/reschedule", "hiring/routes/api.my-interview.reschedule.ts"),

  route("api/hiring/domain-applications/:id/decisions", "hiring/routes/api.domain-applications.$id.decisions.ts"),
  route("api/hiring/domain-applications/:id/reviews", "hiring/routes/api.domain-applications.$id.reviews.ts"),
  route("api/hiring/domain-applications/:id/full-context", "hiring/routes/api.domain-applications.$id.full-context.ts"),
  route("api/hiring/domain-applications/:id/schedule-interview", "hiring/routes/api.domain-applications.$id.schedule-interview.ts"),
  route("api/hiring/domain-applications/:id/resend-invite", "hiring/routes/api.domain-applications.$id.resend-invite.ts"),

  route("api/hiring/reviews/:id", "hiring/routes/api.reviews.$id.ts"),
  route("api/hiring/reviews/:id/submit", "hiring/routes/api.reviews.$id.submit.ts"),
  route("api/hiring/reviews/:id/unsubmit", "hiring/routes/api.reviews.$id.unsubmit.ts"),

  route("api/hiring/decisions/:id/finalize", "hiring/routes/api.decisions.$id.finalize.ts"),
  route("api/hiring/decisions/:id/release", "hiring/routes/api.decisions.$id.release.ts"),

  route("api/hiring/waitlist", "hiring/routes/api.waitlist.ts"),
  route("api/hiring/waitlist/:domainApplicationId/accept", "hiring/routes/api.waitlist.$domainApplicationId.accept.ts"),
  route("api/hiring/waitlist/:domainApplicationId/remove", "hiring/routes/api.waitlist.$domainApplicationId.remove.ts"),

  route("api/hiring/interviews/:id/complete", "hiring/routes/api.interviews.$id.complete.ts"),
  route("api/hiring/interviews/:id/reassign", "hiring/routes/api.interviews.$id.reassign.ts"),

  route("api/hiring/delibs/:id", "hiring/routes/api.delibs.$id.ts"),
  route("api/hiring/delibs/:id/moves", "hiring/routes/api.delibs.$id.moves.ts"),

  route("api/hiring/interview-assignments/:id/notes", "hiring/routes/api.interview-assignments.$id.notes.ts"),

  // Google calendar (cross-cutting — used by hiring scheduling)
  route("api/google-calendar/busy", "calendar/routes/api.google-calendar.busy.ts"),

  route("api/hiring/interviews/:id/location", "hiring/routes/api.interviews.$id.location.ts"),

  // S3 file upload
  route("api/upload/presign", "routes/api.upload.presign.ts"),
  route("api/upload/url", "routes/api.upload.url.ts"),
  route("api/upload/raw", "routes/api.upload.raw.ts"),

  // Gmail OAuth one-time authorization
  route("admin/authorize-gmail", "routes/admin.authorize-gmail.ts"),
  route("admin/authorize-gmail/callback", "routes/admin.authorize-gmail.callback.ts"),

  // Email sending
  route("api/email/send", "routes/api.email.send.ts"),

  // Submission URL checking
  route("api/check-url", "routes/api.check-url.ts"),

  // Audit logs (admin)
  route("api/audit-logs", "admin/routes/api.audit-logs.ts"),

  // Site analytics (client error beacon)
  route("api/analytics/error", "routes/api.analytics.error.ts"),

  // Collaborative editing version history
  route("api/collab/versions", "routes/api.collab.versions.ts"),
  route("api/collab/versions/:id", "routes/api.collab.versions.$id.ts"),

  // Mentorship API — weekly notes, templates, mentor↔mentee pairs.
  route("api/mentorship/notes", "mentorship/routes/api.mentorship.notes.ts"),
  route("api/mentorship/notes/:id", "mentorship/routes/api.mentorship.notes.$id.ts"),
  route("api/mentorship/templates", "mentorship/routes/api.mentorship.templates.ts"),
  route("api/mentorship/templates/:id", "mentorship/routes/api.mentorship.templates.$id.ts"),
  route("api/mentorship/pairs", "mentorship/routes/api.mentorship.pairs.ts"),

  // AI document-writing assistant — requires an AI provider key to be active
  // (ANTHROPIC_API_KEY, or DARTMOUTH_CHAT_API_KEY for the Dartmouth Chat gateway).
  route("api/ai/doc", "routes/api.ai.doc.ts"),
] satisfies RouteConfig;
