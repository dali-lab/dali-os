// Legacy redirect: Communications is lab process and lives in the Core area.
// The pre-regroup cluster-hub URL now bounces to /core/communications so old
// links and bookmarks keep working. (The nav-regroup flag was retired.)
import { redirect } from "react-router";
import type { Route } from "./+types/admin.communications";
import { requireAuth } from "~/lib/auth";
import { redirectToLogin } from "~/lib/login-next";

export async function loader({ request }: Route.LoaderArgs) {
  const auth = await requireAuth(request);
  if (!auth.ok) return redirectToLogin(request);
  return redirect("/core/communications");
}

export default function AdminCommunicationsRedirect() {
  return null;
}
