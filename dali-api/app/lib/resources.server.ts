import { redirect } from "react-router";
import { requireAuth, redirectPartnerToPortal } from "~/lib/auth";
import { redirectToLogin } from "~/lib/login-next";
import { getUserRoles, isCore, isLabMember } from "~/lib/roles";
import { isFeatureEnabled } from "~/lib/feature-flags.server";

// Who Resources is for: behind the `resources` flag, lab members and Core.
// Null = no access. Takes a user id, not a session, so the MCP tools share it.
export async function resourcesAccess(
  userId: string,
  request?: Request,
): Promise<{ core: boolean } | null> {
  const roles = await getUserRoles(userId);
  if (!(await isFeatureEnabled("resources", userId, roles, request))) return null;
  const [core, labMember] = await Promise.all([
    isCore(userId, request),
    isLabMember(userId, request),
  ]);
  return core || labMember ? { core } : null;
}

// The gate every /resources loader and action runs. Throws the redirect or 404
// itself: the child routes load in parallel with the layout, so each must
// enforce it rather than lean on the parent.
export async function requireResourcesViewer(request: Request) {
  const auth = await requireAuth(request);
  if (!auth.ok) throw redirectToLogin(request);
  if (auth.user.type === "applicant") throw redirect("/portal");
  const partnerRedirect = await redirectPartnerToPortal(auth);
  if (partnerRedirect) throw partnerRedirect;

  const access = await resourcesAccess(auth.user.sub, request);
  // 404 (not redirect) so a disabled feature isn't reachable by URL and its
  // existence isn't leaked.
  if (!access) throw new Response("Not found", { status: 404 });
  const { core } = access;

  return {
    user: auth.user,
    core,
    userName:
      [auth.user.firstName, auth.user.lastName].filter(Boolean).join(" ") ||
      auth.user.email,
  };
}
