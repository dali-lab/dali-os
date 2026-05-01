import { type RouteConfig, index, layout, route } from "@react-router/dev/routes";

export default [
  // UI routes wrapped in the app layout (navbar + view toggle)
  layout("routes/layout.tsx", [
    index("routes/home.tsx"),

    // Hiring section
    route("hiring/reviewer", "hiring/routes/reviewer.tsx"),
    route("hiring/reviewer/application/:id", "hiring/routes/reviewer.application.$id.tsx"),
    route("hiring/domain-lead", "hiring/routes/domain-lead.tsx"),
    route("hiring/domain-lead/application/:id", "hiring/routes/domain-lead.application.$id.tsx"),
    route("hiring/domain-lead/delibs/:id", "hiring/routes/domain-lead.delibs.$id.tsx"),
    route("hiring/lead", "hiring/routes/lead.tsx"),
    route("hiring/lead/cycle/:id", "hiring/routes/lead.cycle.$id.tsx"),
    route("hiring/challenges", "hiring/routes/challenges.tsx"),
    route("hiring/challenges/:id", "hiring/routes/challenges.$id.tsx"),
    route("hiring/rubrics", "hiring/routes/rubrics.tsx"),
    route("hiring/rubrics/:id", "hiring/routes/rubrics.$id.tsx"),
    route("hiring/emails", "hiring/routes/email-templates.tsx"),
    route("hiring/emails/:id", "hiring/routes/email-templates.$id.tsx"),
    route("hiring/confidentiality-agreements", "hiring/routes/confidentiality-agreements.tsx"),
    route("hiring/confidentiality-agreements/:id", "hiring/routes/confidentiality-agreements.$id.tsx"),
    route("hiring/cycles/:cycleId/confidentiality", "hiring/routes/cycles.$cycleId.confidentiality.tsx"),
    route("hiring/interviewer", "hiring/routes/interviewer.tsx"),
    route("hiring/interviewer/interview/:interviewId", "hiring/routes/interviewer.interview.$interviewId.tsx"),
    route("hiring/schedule-interview", "hiring/routes/applicant.schedule-interview.tsx"),
    route("hiring/analytics", "hiring/routes/analytics.tsx"),

    // Admin console (top-level, not hiring)
    route("admin-console", "routes/admin-console.tsx"),
    route("admin-console/members", "routes/admin-console.members.tsx"),
    route("admin-console/domains", "routes/admin-console.domains.tsx"),
    route("admin-console/party", "routes/admin-console.party.tsx"),
  ]),

  // Applicant portal (lightweight layout)
  layout("routes/applicant-layout.tsx", [
    route("portal", "routes/portal.tsx"),
    route("portal/apply", "routes/portal.apply.tsx"),
    route("portal/application", "routes/portal.application.tsx"),
  ]),

  // Party route (authed, no layout — full-page easter egg)
  route("party", "routes/party.tsx"),

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

  // Authenticated API endpoints (no layout)
  route("users/:id", "routes/users.$id.ts"),

  // Domain & member management API (cross-cutting)
  route("api/domains", "routes/api.domains.ts"),
  route("api/domains/:domainId", "routes/api.domains.$domainId.ts"),
  route("api/domains/:domainId/leads", "routes/api.domains.$domainId.leads.ts"),
  route("api/members", "routes/api.members.ts"),
  route("api/members/:memberId/roles", "routes/api.members.$memberId.roles.ts"),

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
  route("api/hiring/cycles/:cycleId/book-interview", "hiring/routes/api.cycles.$cycleId.book-interview.ts"),
  route("api/hiring/cycles/:cycleId/interviews", "hiring/routes/api.cycles.$cycleId.interviews.ts"),
  route("api/hiring/cycles/:cycleId/interviewers", "hiring/routes/api.cycles.$cycleId.interviewers.ts"),
  route("api/hiring/cycles/:cycleId/delibs", "hiring/routes/api.cycles.$cycleId.delibs.ts"),
  route("api/hiring/cycles/:cycleId/domains/:domainId/auto-assign", "hiring/routes/api.cycles.$cycleId.domains.$domainId.auto-assign.ts"),
  route("api/hiring/cycles/:cycleId/confidentiality/sign", "hiring/routes/api.cycles.$cycleId.confidentiality.sign.ts"),

  route("api/hiring/my-application", "hiring/routes/api.my-application.ts"),
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

  // Google calendar (cross-cutting — used by hiring scheduling but lives at top level)
  route("api/google-calendar/busy", "routes/api.google-calendar.busy.ts"),

  // S3 file upload
  route("api/upload/presign", "routes/api.upload.presign.ts"),
  route("api/upload/url", "routes/api.upload.url.ts"),

  // Gmail OAuth one-time authorization
  route("admin/authorize-gmail", "routes/admin.authorize-gmail.ts"),
  route("admin/authorize-gmail/callback", "routes/admin.authorize-gmail.callback.ts"),

  // Email sending
  route("api/email/send", "routes/api.email.send.ts"),

  // Party launch-event analytics
  route("api/party/events", "routes/api.party.events.ts"),

  // Submission URL checking
  route("api/check-url", "routes/api.check-url.ts"),

  // Audit logs (admin)
  route("api/audit-logs", "routes/api.audit-logs.ts"),

  // Collaborative editing version history
  route("api/collab/versions", "routes/api.collab.versions.ts"),
  route("api/collab/versions/:id", "routes/api.collab.versions.$id.ts"),
] satisfies RouteConfig;
