import { redirect } from "react-router";
import { requireAuth, redirectPartnerToPortal } from "~/lib/auth";
import { redirectToLogin } from "~/lib/login-next";
import { getUserRoles, isCore, isLabMember } from "~/lib/roles";
import { isFeatureEnabled } from "~/lib/feature-flags.server";

// The gate every /resources loader and action runs. Throws the redirect or 404
// itself: the child routes load in parallel with the layout, so each must
// enforce it rather than lean on the parent.
export async function requireResourcesViewer(request: Request) {
  const auth = await requireAuth(request);
  if (!auth.ok) throw redirectToLogin(request);
  if (auth.user.type === "applicant") throw redirect("/portal");
  const partnerRedirect = await redirectPartnerToPortal(auth);
  if (partnerRedirect) throw partnerRedirect;

  // Behind the `resources` flag; 404 (not redirect) so a disabled feature isn't
  // reachable by URL and its existence isn't leaked.
  const roles = await getUserRoles(auth.user.sub);
  if (!(await isFeatureEnabled("resources", auth.user.sub, roles, request))) {
    throw new Response("Not found", { status: 404 });
  }

  const [core, labMember] = await Promise.all([
    isCore(auth.user.sub, request),
    isLabMember(auth.user.sub, request),
  ]);
  if (!core && !labMember) throw new Response("Not found", { status: 404 });

  return {
    user: auth.user,
    core,
    userName:
      [auth.user.firstName, auth.user.lastName].filter(Boolean).join(" ") ||
      auth.user.email,
  };
}
