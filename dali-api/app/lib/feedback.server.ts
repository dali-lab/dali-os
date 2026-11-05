import { redirect } from "react-router";
import { requireAuth, redirectPartnerToPortal, isNonMember } from "~/lib/auth";
import { redirectToLogin } from "~/lib/login-next";
import { getUserRoles } from "~/lib/roles";

export async function requireFeedbackViewer(request: Request) {
  const auth = await requireAuth(request);
  if (!auth.ok) throw redirectToLogin(request);
  if (await isNonMember(auth, request)) throw redirect("/portal");
  const partnerRedirect = await redirectPartnerToPortal(auth);
  if (partnerRedirect) throw partnerRedirect;

  const roles = await getUserRoles(auth.user.sub);
  if (!roles.isLabMember && !roles.isCore) throw new Response("Not found", { status: 404 });

  return { user: auth.user, core: roles.isCore };
}
