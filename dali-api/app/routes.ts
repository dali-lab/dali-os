import { type RouteConfig, index, layout, route } from "@react-router/dev/routes";

export default [
  // UI routes wrapped in the app layout (navbar + view toggle)
  layout("routes/layout.tsx", [
    index("routes/home.tsx"),
    route("calendar", "calendar/routes/calendar.tsx"),

    // Hiring section
    route("hiring/reviewer", "hiring/routes/reviewer.tsx"),
    route("hiring/reviewer/application/:id", "hiring/routes/reviewer.application.$id.tsx"),
    route("hiring/domain-lead", "hiring/routes/domain-lead.tsx"),
    route("hiring/domain-lead/application/:id", "hiring/routes/domain-lead.application.$id.tsx"),
    route("hiring/domain-lead/delibs/:id", "hiring/routes/domain-lead.delibs.$id.tsx"),
    route("hiring/lead", "hiring/routes/lead.tsx"),
    route("hiring/lead/cycle/:id", "hiring/routes/lead.cycle.$id.tsx"),
    route("hiring/lead/intern-to-full-cycle/:id", "hiring/routes/lead.intern-to-full-cycle.$id.tsx"),
    route("hiring/challenges", "hiring/routes/challenges.tsx"),
    route("hiring/challenges/:id", "hiring/routes/challenges.$id.tsx"),
    route("hiring/rubrics", "hiring/routes/rubrics.tsx"),
    route("hiring/rubrics/:id", "hiring/routes/rubrics.$id.tsx"),
    route("hiring/emails", "hiring/routes/email-templates.tsx"),
    route("hiring/emails/:id", "hiring/routes/email-templates.$id.tsx"),
    route("hiring/confidentiality-agreements", "hiring/routes/confidentiality-agreements.tsx"),
    route("hiring/confidentiality-agreements/:id", "hiring/routes/confidentiality-agreements.$id.tsx"),
    route("hiring/cycles/:cycleId/confidentiality", "hiring/routes/cycles.$cycleId.confidentiality.tsx"),
    route("hiring/interviewer/interview/:interviewId", "hiring/routes/interviewer.interview.$interviewId.tsx"),
    route("hiring/analytics", "hiring/routes/analytics.tsx"),

    // Admin console (top-level, not hiring)
    route("admin-console", "admin-console/routes/admin-console.tsx"),
    route("admin-console/members", "admin-console/routes/admin-console.members.tsx"),
    route("admin-console/domains", "admin-console/routes/admin-console.domains.tsx"),

    // Projects
    route("projects/list", "projects/routes/projects.list.tsx"),
    route("projects/staffing", "projects/routes/projects.staffing.tsx"),

    // Members directory (separate from admin-console/members)
    route("members", "members/routes/members.tsx"),
    route("members/groups", "members/routes/members.groups.tsx"),

    // Partners
    route("partners", "partners/routes/partners.tsx"),

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
  ]),

  // Public policy pages (no auth, no layout) — linked from the Google OAuth
  // consent screen, so they must load for an unauthenticated reviewer.
  route("privacy", "routes/privacy.tsx"),
  route("terms", "routes/terms.tsx"),

  // Login (no layout)
  route("login", "routes/login.tsx"),
  route("dev-login", "routes/dev-login.ts"),
  route("dev-login-as", "routes/dev-login-as.ts"),
  route("logout", "routes/logout.ts"),
  route("auth/callback/google", "routes/auth.callback.google.ts"),
  route("auth/callback/cas", "routes/auth.callback.cas.ts"),

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
  route("help/mcp", "routes/help.mcp.tsx"),
  route("settings/connected-apps", "routes/settings.connected-apps.tsx"),

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
  route("api/notifications", "routes/api.notifications.ts"),
  route("api/notifications/send", "admin-console/routes/api.notifications.send.ts"),
  route("api/notifications/:id/read", "routes/api.notifications.$id.read.ts"),
  route("api/notifications/:id/rsvp", "routes/api.notifications.$id.rsvp.ts"),

  // Scheduled meetings
  route("api/scheduled-meetings", "calendar/routes/api.scheduled-meetings.ts"),
  route("api/calendar/group-availability", "calendar/routes/api.calendar.group-availability.ts"),

  // Slack bot (webhook receivers; signature-verified, no auth middleware)
  route("api/slack/events", "slack/routes/api.slack.events.ts"),
  route("api/slack/interactivity", "slack/routes/api.slack.interactivity.ts"),


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

  route("api/hiring/reviews/:id", "hiring/routes/api.reviews.$id.ts"),
  route("api/hiring/reviews/:id/submit", "hiring/routes/api.reviews.$id.submit.ts"),
  route("api/hiring/reviews/:id/unsubmit", "hiring/routes/api.reviews.$id.unsubmit.ts"),

  route("api/hiring/decisions/:id/finalize", "hiring/routes/api.decisions.$id.finalize.ts"),
  route("api/hiring/decisions/:id/release", "hiring/routes/api.decisions.$id.release.ts"),

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

  // Collaborative editing version history
  route("api/collab/versions", "routes/api.collab.versions.ts"),
  route("api/collab/versions/:id", "routes/api.collab.versions.$id.ts"),
] satisfies RouteConfig;
