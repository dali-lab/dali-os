import { type RouteConfig, index, layout, route } from "@react-router/dev/routes";

export default [
  // UI routes wrapped in the app layout (navbar + view toggle)
  layout("routes/layout.tsx", [
    index("routes/home.tsx"),
    route("mentor", "routes/mentor.tsx"),
    route("mentor/application/:id", "routes/mentor.application.$id.tsx"),
    route("domain-lead", "routes/domain-lead.tsx"),
    route("domain-lead/application/:id", "routes/domain-lead.application.$id.tsx"),
    route("admin", "routes/admin.tsx"),
    route("admin/cycle/:id", "routes/admin.cycle.$id.tsx"),
    route("challenges", "routes/admin.challenges.tsx"),
    route("challenges/:id", "routes/admin.challenges.$id.tsx"),
    route("rubrics", "routes/rubrics.tsx"),
    route("rubrics/:id", "routes/rubrics.$id.tsx"),
  ]),

  // Login (no layout)
  route("login", "routes/login.tsx"),
  route("dev-login", "routes/dev-login.ts"),
  route("logout", "routes/logout.ts"),
  route("auth/callback/google", "routes/auth.callback.google.ts"),

  // OAuth endpoints (no layout)
  route("oauth/authorize", "routes/oauth.authorize.ts"),
  route("oauth/callback/google", "routes/oauth.callback.google.ts"),
  route("oauth/callback/cas", "routes/oauth.callback.cas.ts"),
  route("oauth/token", "routes/oauth.token.ts"),
  route("oauth/revoke", "routes/oauth.revoke.ts"),

  // Authenticated API endpoints (no layout)
  route("auth/link-member", "routes/auth.link-member.ts"),
  route("users/:id", "routes/users.$id.ts"),

  // Domain & member management API
  route("api/domains", "routes/api.domains.ts"),
  route("api/domains/:domainId/leads", "routes/api.domains.$domainId.leads.ts"),
  route("api/members", "routes/api.members.ts"),

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
] satisfies RouteConfig;
