import { redirect } from "react-router";
import type { Route } from "./+types/admin-console";
import { requireAuth } from "~/lib/auth";
import { isAdmin } from "~/lib/roles";

export const meta: Route.MetaFunction = () => [{ title: "Operations · DALI OS" }];

// Land Admins on Roles (the most common entry point); Core has no access to
// Roles so they go straight to Domains instead.
export async function loader({ request }: Route.LoaderArgs) {
  const auth = await requireAuth(request);
  if (!auth.ok) return redirect("/login");
  if (await isAdmin(auth.user.sub)) return redirect("/admin-console/members");
  return redirect("/admin-console/domains");
}

export default function AdminConsoleRedirect() {
  return null;
}
