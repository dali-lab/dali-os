import { redirect } from "react-router";
import type { Route } from "./+types/admin.section";
import { requireAuth } from "~/lib/auth";
import { redirectToLogin } from "~/lib/login-next";
import { getUserRoles } from "~/lib/roles";
import { resolveFeatureFlags } from "~/lib/feature-flags.server";
import { ADMIN_SECTIONS, sectionLanding } from "~/admin/adminNav";

// A section's own URL (/admin/payroll, /admin/accounts, …) opens its first tab
// this viewer can reach, keeping the query so an old deep link still filters.
export async function loader({ request }: Route.LoaderArgs) {
  const auth = await requireAuth(request);
  if (!auth.ok) return redirectToLogin(request);
  const roles = await getUserRoles(auth.user.sub, request);
  if (!roles.isCore) return redirect("/");

  const url = new URL(request.url);
  const section = ADMIN_SECTIONS.find((s) => s.path === url.pathname.replace(/\/$/, ""));
  if (!section) return redirect("/admin");
  const flags = await resolveFeatureFlags(auth.user.sub, roles, request);
  const landing = sectionLanding(section, roles.isAdmin, flags);
  return redirect(landing ? `${landing}${url.search}` : "/admin");
}
