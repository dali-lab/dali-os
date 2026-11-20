import { redirect } from "react-router";
import type { Route } from "./+types/core.intent-to-work.$userId";
import { requireAuth, redirectNonMemberToPortal } from "~/lib/auth";
import { redirectToLogin } from "~/lib/login-next";
import { canViewStaffing } from "~/lib/roles";
import { OPEN_PARAM } from "~/projects/lib/board-filters";

export async function loader({ request, params }: Route.LoaderArgs) {
  const auth = await requireAuth(request);
  if (!auth.ok) return redirectToLogin(request);
  const portalRedirect = await redirectNonMemberToPortal(auth, request);
  if (portalRedirect) return portalRedirect;
  if (!(await canViewStaffing(auth.user.sub))) return redirect("/");
  const query = new URL(request.url).searchParams;
  query.set(OPEN_PARAM, params.userId);
  return redirect(`/core/intent-to-work?${query}`);
}
