import { type RouteConfig, index, route } from "@react-router/dev/routes";

export default [
  index("routes/home.tsx"),

  // register oauth endpoints
  route("oauth/authorize", "routes/oauth.authorize.ts"),
  route("oauth/callback/google", "routes/oauth.callback.google.ts"),
  route("oauth/callback/cas", "routes/oauth.callback.cas.ts"),
  route("oauth/token", "routes/oauth.token.ts"),
  route("oauth/revoke", "routes/oauth.revoke.ts"),

  // register authenticated API endpoints
  route("auth/link-member", "routes/auth.link-member.ts"),
  route("users/:id", "routes/users.$id.ts"),
] satisfies RouteConfig;
