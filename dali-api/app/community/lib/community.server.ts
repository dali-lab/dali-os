import { requireAuth, redirectNonMemberToPortal } from "~/lib/auth";
import { redirectToLogin } from "~/lib/login-next";
import { getUserRoles } from "~/lib/roles";
import { isFeatureEnabled } from "~/lib/feature-flags.server";

// Same audience as Connect: current members and alumni, behind the `community` flag.
export async function requireCommunityViewer(request: Request) {
  const auth = await requireAuth(request);
  if (!auth.ok) throw redirectToLogin(request);
  const portalRedirect = await redirectNonMemberToPortal(auth, request);
  if (portalRedirect) throw portalRedirect;
  const roles = await getUserRoles(auth.user.sub);
  if (!(await isFeatureEnabled("community", auth.user.sub, roles, request))) {
    throw new Response("Not found", { status: 404 });
  }
  return auth.user;
}
