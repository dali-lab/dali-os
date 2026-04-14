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
] satisfies RouteConfig;
