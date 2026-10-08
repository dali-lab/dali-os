import { redirect } from "react-router";
import { requireAuth, redirectPartnerToPortal } from "~/lib/auth";
import { redirectToLogin } from "~/lib/login-next";
import { getUserRoles } from "~/lib/roles";
import { isFeatureEnabled } from "~/lib/feature-flags.server";

// The gate the /feedback loader and action run: behind the `os-feedback` flag,
// lab members and Core. 404 (not redirect) so a disabled feature isn't
// reachable by URL.
export async function requireFeedbackViewer(request: Request) {
  const auth = await requireAuth(request);
  if (!auth.ok) throw redirectToLogin(request);
  if (auth.user.type === "applicant") throw redirect("/portal");
  const partnerRedirect = await redirectPartnerToPortal(auth);
  if (partnerRedirect) throw partnerRedirect;

  const roles = await getUserRoles(auth.user.sub);
  const allowed =
    (roles.isLabMember || roles.isCore) &&
    (await isFeatureEnabled("os-feedback", auth.user.sub, roles, request));
  if (!allowed) throw new Response("Not found", { status: 404 });

  return { user: auth.user, core: roles.isCore };
}
