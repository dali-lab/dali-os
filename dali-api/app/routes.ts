import { type RouteConfig, index, layout, route } from "@react-router/dev/routes";

export default [
  // UI routes wrapped in the app layout (navbar + view toggle)
  layout("routes/layout.tsx", [
    index("routes/home.tsx"),
    route("apply/:cycleId", "routes/apply.$cycleId.tsx"),
    route("applications/:appId", "routes/applications.$appId.tsx"),
    route("mentor", "routes/mentor.tsx"),
    route("mentor/application/:id", "routes/mentor.application.$id.tsx"),
    route("domain-lead", "routes/domain-lead.tsx"),
    route("domain-lead/application/:id", "routes/domain-lead.application.$id.tsx"),
    route("admin", "routes/admin.tsx"),
    route("admin/cycle/:id", "routes/admin.cycle.$id.tsx"),
    route("admin/forms", "routes/admin.forms.tsx"),
    route("admin/forms/:id", "routes/admin.forms.$id.tsx"),
    route("admin/challenges", "routes/admin.challenges.tsx"),
    route("admin/challenges/:id", "routes/admin.challenges.$id.tsx"),
    route("admin/rubrics", "routes/admin.rubrics.tsx"),
    route("admin/rubrics/:id", "routes/admin.rubrics.$id.tsx"),
  ]),

  // OAuth endpoints (no layout)
  route("oauth/authorize", "routes/oauth.authorize.ts"),
  route("oauth/callback/google", "routes/oauth.callback.google.ts"),
  route("oauth/callback/cas", "routes/oauth.callback.cas.ts"),
  route("oauth/token", "routes/oauth.token.ts"),
  route("oauth/revoke", "routes/oauth.revoke.ts"),

  // Authenticated API endpoints (no layout)
  route("auth/link-member", "routes/auth.link-member.ts"),
  route("users/:id", "routes/users.$id.ts"),
] satisfies RouteConfig;
