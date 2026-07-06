import { type RouteConfig, index, layout, route } from "@react-router/dev/routes";

export default [
  // UI routes wrapped in the app layout (navbar + view toggle)
  layout("routes/layout.tsx", [
    index("routes/home.tsx"),
    route("profile", "routes/profile.tsx"),
    route("onboarding", "routes/onboarding.tsx"),
    route("calendar", "calendar/routes/calendar.tsx"),
    // My Tasks surface: Open tasks + browsable notification history.
    route("notifications", "routes/notifications.tsx"),

    // Hiring section
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
    route("hiring/lead/intern-to-full-cycle/:id", "hiring/routes/lead.intern-to-full-cycle.$id.tsx"),
    route("hiring/lead/waitlists", "hiring/routes/lead.waitlists.tsx"),
    // Library — challenges, rubrics, and confidentiality agreements behind one
    // page with pills. The list views are consolidated here; the detail pages
    // keep their original paths.
    route("hiring/library", "hiring/routes/library.tsx"),
    route("hiring/challenges/:id", "hiring/routes/challenges.$id.tsx"),
    route("hiring/rubrics/:id", "hiring/routes/rubrics.$id.tsx"),
    route("hiring/emails", "hiring/routes/email-templates.tsx"),
    route("hiring/emails/:id", "hiring/routes/email-templates.$id.tsx"),
    route("hiring/confidentiality-agreements/:id", "hiring/routes/confidentiality-agreements.$id.tsx"),
    route("hiring/cycles/:cycleId/confidentiality", "hiring/routes/cycles.$cycleId.confidentiality.tsx"),
    route("hiring/interviewer/interview/:interviewId", "hiring/routes/interviewer.interview.$interviewId.tsx"),
    route("hiring/analytics", "hiring/routes/analytics.tsx"),

    // Operations (top-level, not hiring)
    route("admin-console", "admin-console/routes/admin-console.tsx"),
    route("admin-console/members", "admin-console/routes/admin-console.members.tsx"),
    route("admin-console/domains", "admin-console/routes/admin-console.domains.tsx"),
    route("admin-console/announcements", "admin-console/routes/admin-console.announcements.tsx"),
    route("admin-console/activity", "admin-console/routes/admin-console.activity.tsx"),
    route("admin-console/analytics", "admin-console/routes/admin-console.analytics.tsx"),
    route("admin-console/payroll-export", "admin-console/routes/admin-console.payroll-export.tsx"),

    // Projects
    route("projects/list", "projects/routes/projects.list.tsx"),
    route("projects/staffing", "projects/routes/projects.staffing.tsx"),
    // Member-facing staffing destination (requireMember, not canViewStaffing):
    // the persistent place a member fills/revisits the cycle's staffing forms.
    // Must precede projects/:id so it isn't captured by the :id param.
    route("projects/my-staffing", "projects/routes/projects.my-staffing.tsx"),
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

    // Documents & files — full-page reusable editor + file viewer. Literal
    // "file" segment precedes the :pageId param so it isn't captured.
    route("documents/file/:fileId", "routes/documents.file.$fileId.tsx"),
    route("documents/:pageId", "routes/documents.$pageId.tsx"),

    // Members directory (separate from admin-console/members)
    route("members", "members/routes/members.tsx"),
    route("members/groups", "members/routes/members.groups.tsx"),
    route("members/:id", "members/routes/members.$id.tsx"),

    // Partners
    route("partners", "partners/routes/partners.tsx"),
    route("partners/applications", "partners/routes/partners.applications.tsx"),
    route("partners/applications/:id", "partners/routes/partners.applications.$id.tsx"),

    // Education. Literal "manage" segments must precede the :offeringId param
    // so /education/manage/* isn't captured as an offering id.
    route("education", "education/routes/education.tsx"),
    route("education/manage", "education/routes/education.manage.tsx"),
    route("education/manage/new", "education/routes/education.manage.new.tsx"),
    route("education/manage/:offeringId", "education/routes/education.manage.$offeringId.tsx"),
    route("education/:offeringId", "education/routes/education.$offeringId.tsx"),
    route("education/:offeringId/apply", "education/routes/education.$offeringId.apply.tsx"),

    // Internal processes
    route("internal-processes/onboarding", "internal-processes/routes/internal-processes.onboarding.tsx"),
    route("internal-processes/transfer", "internal-processes/routes/internal-processes.transfer.tsx"),
    route("internal-processes/level-up", "internal-processes/routes/internal-processes.level-up.tsx"),
    route("internal-processes/jobx", "internal-processes/routes/internal-processes.jobx.tsx"),

    // Forms. The :folderId form lets a folder card open its own page with
    // nested folders + forms; the bare /forms route is the top level.
    route("forms", "forms/routes/forms.tsx"),
    // Static `edit` segment must precede the :folderId catch so /forms/edit/*
    // isn't read as a folder id.
    route("forms/edit/:formId", "forms/routes/forms.edit.$formId.tsx"),
    route("forms/:folderId", "forms/routes/forms.$folderId.tsx"),

    // Internal applicant portal — intern → full-time conversion. Authenticated
    // member route (not under /portal) so interns use their existing session
    // rather than the CAS flow built for external applicants.
    route("intern-to-full", "routes/intern-to-full.tsx"),
  ]),

  // Applicant portal (lightweight layout)
  layout("routes/applicant-layout.tsx", [
    route("portal", "routes/portal.tsx"),
    route("portal/apply", "routes/portal.apply.tsx"),
    route("portal/application", "routes/portal.application.tsx"),
    // Education mirror for non-member Dartmouth students.
    route("portal/education", "routes/portal.education.tsx"),
    route("portal/education/:offeringId", "routes/portal.education.$offeringId.tsx"),
    route("portal/education/:offeringId/apply", "routes/portal.education.$offeringId.apply.tsx"),
  ]),

  // Authenticated member form fill (no layout), token-addressed. Every form
  // is filled while logged in — the submitter is always the session user, so
  // there's no name/email capture and submissions can drive StaffingPreference
  // / close the recipient's task.
  route("forms/fill/:token", "routes/forms.fill.$token.tsx"),
  route("api/forms/fill/:token", "routes/api.forms.fill.$token.ts"),

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

  // Settings pages (no layout — opened in a TabWorkspace iframe via the
  // sidebar footer icons; their own <main> provides padding).
  route("settings", "routes/settings._index.tsx"),
  route("settings/calendar", "routes/settings.calendar.tsx"),
  route("settings/sessions", "routes/settings.sessions.tsx"),
  route("settings/slack", "routes/settings.slack.tsx"),
  route("settings/connected-apps", "routes/settings.connected-apps.tsx"),

  // Help pages (same shell convention as Settings).
  route("help", "routes/help._index.tsx"),
  route("help/getting-started", "routes/help.getting-started.tsx"),
  route("help/shortcuts", "routes/help.shortcuts.tsx"),
  route("help/calendar", "routes/help.calendar.tsx"),
  route("help/staffing", "routes/help.staffing.tsx"),
  route("help/notifications", "routes/help.notifications.tsx"),
  route("help/mcp", "routes/help.mcp.tsx"),

  // Authenticated API endpoints (no layout)
  route("users/:id", "members/routes/users.$id.ts"),

  // Domain & member management API
  route("api/domains", "admin-console/routes/api.domains.ts"),
  route("api/domains/:domainId", "admin-console/routes/api.domains.$domainId.ts"),
  route("api/domains/:domainId/leads", "admin-console/routes/api.domains.$domainId.leads.ts"),
  route("api/members", "admin-console/routes/api.members.ts"),
  route("api/members/:memberId/roles", "admin-console/routes/api.members.$memberId.roles.ts"),

  // Groups (admin) and notifications (per-user + admin send)
  route("api/groups", "admin-console/routes/api.groups.ts"),
  route("api/groups/:groupId", "admin-console/routes/api.groups.$groupId.ts"),
  route("api/tour/complete", "routes/api.tour.complete.ts"),
  route("api/notifications", "routes/api.notifications.ts"),
  route("api/notifications/send", "admin-console/routes/api.notifications.send.ts"),
  route("api/notifications/:id/read", "routes/api.notifications.$id.read.ts"),
  route("api/notifications/:id/rsvp", "routes/api.notifications.$id.rsvp.ts"),

  // Scheduled meetings
  route("api/scheduled-meetings", "calendar/routes/api.scheduled-meetings.ts"),
  route("api/scheduled-meetings/:id/cancel", "calendar/routes/api.scheduled-meetings.$id.cancel.ts"),
  route("api/calendar/group-availability", "calendar/routes/api.calendar.group-availability.ts"),

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

  // Core-only level correction for an already-finalized ProjectAssignment.
  route(
    "api/projects/assignments/:id/level",
    "projects/routes/api.assignment-level.ts",
  ),

  // Project task board
  route("api/projects/:id/tasks", "projects/routes/api.projects.$id.tasks.ts"),
  route("api/tasks/:id/move", "projects/routes/api.tasks.$id.move.ts"),
  route("api/tasks/:id", "projects/routes/api.tasks.$id.ts"),

  // Project epics & sprints
  route("api/projects/:id/epics", "projects/routes/api.projects.$id.epics.ts"),
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
  route("api/documents/:id", "projects/routes/api.documents.$id.ts"),

  // Project files (standalone uploads with versions)
  route("api/projects/:id/files", "projects/routes/api.projects.$id.files.ts"),
  route("api/files/:id", "projects/routes/api.files.$id.ts"),

  // Lab-wide document/file tags
  route("api/doctags", "routes/api.doctags.ts"),
  route("api/doctags/apply", "routes/api.doctags.apply.ts"),

  // Comments + inline annotations on documents and files
  route("api/comments", "routes/api.comments.ts"),
  route("api/comments/:id", "routes/api.comments.$id.ts"),

  // Document export (server-rendered PDF / Word)
  route("documents/:pageId/export", "routes/documents.$pageId.export.ts"),

  // Payroll CSV export (resource route — registered OUTSIDE the app layout so
  // the Response streams as a bare CSV body, not wrapped in an HTML shell).
  route("admin-console/payroll-export.csv", "admin-console/routes/admin-console.payroll-export.csv.ts"),

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

  // Gmail OAuth one-time authorization
  route("admin/authorize-gmail", "routes/admin.authorize-gmail.ts"),
  route("admin/authorize-gmail/callback", "routes/admin.authorize-gmail.callback.ts"),

  // Email sending
  route("api/email/send", "routes/api.email.send.ts"),

  // Submission URL checking
  route("api/check-url", "routes/api.check-url.ts"),

  // Audit logs (admin)
  route("api/audit-logs", "admin-console/routes/api.audit-logs.ts"),

  // Site analytics (client error beacon)
  route("api/analytics/error", "routes/api.analytics.error.ts"),

  // Collaborative editing version history
  route("api/collab/versions", "routes/api.collab.versions.ts"),
  route("api/collab/versions/:id", "routes/api.collab.versions.$id.ts"),
] satisfies RouteConfig;
