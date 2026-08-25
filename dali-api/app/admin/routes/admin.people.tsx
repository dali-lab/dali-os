// Legacy redirect: People & Access is lab process and lives in the Core area.
// The pre-regroup cluster-hub URL now bounces to /core/access/roles so old
// links and bookmarks keep working. (The nav-regroup flag was retired.)
import { redirect } from "react-router";
import type { Route } from "./+types/admin.people";
import { requireAuth } from "~/lib/auth";
import { redirectToLogin } from "~/lib/login-next";

export async function loader({ request }: Route.LoaderArgs) {
  const auth = await requireAuth(request);
  if (!auth.ok) return redirectToLogin(request);
  return redirect("/core/access/roles");
}

export default function AdminPeopleRedirect() {
  return null;
}
