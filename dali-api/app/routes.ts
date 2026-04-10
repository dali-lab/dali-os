import { type RouteConfig, index, route } from "@react-router/dev/routes";

export default [
  // Applicant routes
  index("routes/home.tsx"),
  route("apply/:cycleId", "routes/apply.$cycleId.tsx"),
  route("applications/:appId", "routes/applications.$appId.tsx"),

  // Mentor routes
  route("mentor", "routes/mentor.tsx"),
  route("mentor/application/:id", "routes/mentor.application.$id.tsx"),

  // Domain Lead routes
  route("domain-lead", "routes/domain-lead.tsx"),
  route("domain-lead/application/:id", "routes/domain-lead.application.$id.tsx"),

  // Admin routes
  route("admin", "routes/admin.tsx"),
  route("admin/cycle/:id", "routes/admin.cycle.$id.tsx"),
  route("admin/forms", "routes/admin.forms.tsx"),
  route("admin/forms/:id", "routes/admin.forms.$id.tsx"),
  route("admin/challenges", "routes/admin.challenges.tsx"),
  route("admin/challenges/:id", "routes/admin.challenges.$id.tsx"),
  route("admin/rubrics", "routes/admin.rubrics.tsx"),
  route("admin/rubrics/:id", "routes/admin.rubrics.$id.tsx"),
] satisfies RouteConfig;
