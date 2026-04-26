import { type RouteConfig, index, layout, route } from "@react-router/dev/routes";

export default [
  // UI routes wrapped in the app layout (navbar + view toggle)
  layout("routes/layout.tsx", [
    index("routes/home.tsx"),
    route("reviewer", "routes/mentor.tsx"),
    route("reviewer/application/:id", "routes/mentor.application.$id.tsx"),
    route("domain-lead", "routes/domain-lead.tsx"),
    route("domain-lead/application/:id", "routes/domain-lead.application.$id.tsx"),
    route("domain-lead/delibs/:id", "routes/domain-lead.delibs.$id.tsx"),
    route("hiring-lead-admin", "routes/admin.tsx"),
    route("hiring-lead-admin/cycle/:id", "routes/admin.cycle.$id.tsx"),
    route("challenges", "routes/admin.challenges.tsx"),
    route("challenges/:id", "routes/admin.challenges.$id.tsx"),
    route("rubrics", "routes/rubrics.tsx"),
    route("rubrics/:id", "routes/rubrics.$id.tsx"),
    route("emails", "routes/email-templates.tsx"),
    route("emails/:id", "routes/email-templates.$id.tsx"),
    route("admin-console", "routes/admin-console.tsx"),
    route("interviewer", "routes/interviewer.tsx"),
    route("interviewer/interview/:interviewId", "routes/interviewer.interview.$interviewId.tsx"),
    route("schedule-interview", "routes/applicant.schedule-interview.tsx"),
  ]),

  // Applicant portal (lightweight layout)
  layout("routes/applicant-layout.tsx", [
    route("portal", "routes/portal.tsx"),
    route("portal/apply", "routes/portal.apply.tsx"),
    route("portal/application", "routes/portal.application.tsx"),
  ]),

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

  // Domain & member management API
  route("api/domains", "routes/api.domains.ts"),
  route("api/domains/:domainId/leads", "routes/api.domains.$domainId.leads.ts"),
  route("api/members", "routes/api.members.ts"),
  route("api/members/:memberId/roles", "routes/api.members.$memberId.roles.ts"),

  // Interview scheduling API
  route("api/cycles/:cycleId/status", "routes/api.cycles.$cycleId.status.ts"),
  route("api/cycles/:cycleId/interview-config", "routes/api.cycles.$cycleId.interview-config.ts"),
  route("api/cycles/:cycleId/reviewers", "routes/api.cycles.$cycleId.reviewers.ts"),
  route("api/cycles/:cycleId/reviewers/:reviewerId", "routes/api.cycles.$cycleId.reviewers.$reviewerId.ts"),
  route("api/cycles/:cycleId/my-availability", "routes/api.cycles.$cycleId.my-availability.ts"),
  route("api/cycles/:cycleId/my-interviews", "routes/api.cycles.$cycleId.my-interviews.ts"),
  route("api/cycles/:cycleId/my-interviews/:interviewId/decline", "routes/api.cycles.$cycleId.my-interviews.$interviewId.decline.ts"),
  route("api/cycles/:cycleId/my-interviews/:interviewId/notes", "routes/api.cycles.$cycleId.my-interviews.$interviewId.notes.ts"),
  route("api/cycles/:cycleId/available-slots", "routes/api.cycles.$cycleId.available-slots.ts"),
  route("api/cycles/:cycleId/book-interview", "routes/api.cycles.$cycleId.book-interview.ts"),
  route("api/cycles/:cycleId/interviews", "routes/api.cycles.$cycleId.interviews.ts"),
  route("api/my-application", "routes/api.my-application.ts"),
  route("api/my-interview", "routes/api.my-interview.ts"),
  route("api/my-interview/cancel", "routes/api.my-interview.cancel.ts"),
  route("api/my-interview/reschedule", "routes/api.my-interview.reschedule.ts"),
  route("api/google-calendar/busy", "routes/api.google-calendar.busy.ts"),

  // Domain application management
  route("api/domain-applications/:id/decisions", "routes/api.domain-applications.$id.decisions.ts"),
  route("api/domain-applications/:id/reviews", "routes/api.domain-applications.$id.reviews.ts"),

  // Review CRUD + submit/unsubmit
  route("api/reviews/:id", "routes/api.reviews.$id.ts"),
  route("api/reviews/:id/submit", "routes/api.reviews.$id.submit.ts"),
  route("api/reviews/:id/unsubmit", "routes/api.reviews.$id.unsubmit.ts"),

  // Decision finalize/release
  route("api/decisions/:id/finalize", "routes/api.decisions.$id.finalize.ts"),
  route("api/decisions/:id/release", "routes/api.decisions.$id.release.ts"),

  // Interview completion & reassignment
  route("api/interviews/:id/complete", "routes/api.interviews.$id.complete.ts"),
  route("api/interviews/:id/reassign", "routes/api.interviews.$id.reassign.ts"),

  // Auto-assign reviewers
  route("api/cycles/:cycleId/domains/:domainId/auto-assign", "routes/api.cycles.$cycleId.domains.$domainId.auto-assign.ts"),

  // Applicant interview scheduling
  route("api/domain-applications/:id/schedule-interview", "routes/api.domain-applications.$id.schedule-interview.ts"),

  // Delibs
  route("api/cycles/:cycleId/delibs", "routes/api.cycles.$cycleId.delibs.ts"),
  route("api/delibs/:id", "routes/api.delibs.$id.ts"),

  // Cycle interviewers
  route("api/cycles/:cycleId/interviewers", "routes/api.cycles.$cycleId.interviewers.ts"),

  // Interview assignment notes
  route("api/interview-assignments/:id/notes", "routes/api.interview-assignments.$id.notes.ts"),

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

  // Collaborative editing version history
  route("api/collab/versions", "routes/api.collab.versions.ts"),
  route("api/collab/versions/:id", "routes/api.collab.versions.$id.ts"),
] satisfies RouteConfig;
