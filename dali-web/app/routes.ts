import { type RouteConfig, index, route } from "@react-router/dev/routes";

export default [
  index("routes/home.tsx"),
  route("about", "routes/about.tsx"),
  route("team", "routes/team.tsx"),
  route("projects", "routes/projects.tsx"),
  route("education", "routes/education.tsx"),
  route("education/calendar", "routes/education.calendar.tsx"),
  route("apply", "routes/apply.tsx"),
  route("partners", "routes/partners.tsx"),
  route("login", "pages/Login.tsx"),
  route("account", "pages/Account.tsx"),
  route("*", "routes/$.tsx"),
] satisfies RouteConfig;
