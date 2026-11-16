import { redirect } from "react-router";
import { requireAuth, isNonMember } from "~/lib/auth";
import { redirectToLogin } from "~/lib/login-next";
import { isCore, getUserRoles } from "~/lib/roles";
import { isFeatureEnabled } from "~/lib/feature-flags.server";

export async function warningsEnabledFor(userId: string, request: Request): Promise<boolean> {
  const roles = await getUserRoles(userId, request);
  return roles.isCore && (await isFeatureEnabled("mentorship-warnings", userId, roles, request));
}

export async function requireWarningsAdmin(request: Request) {
  const auth = await requireAuth(request);
  if (!auth.ok) throw redirectToLogin(request);
  if (await isNonMember(auth, request)) throw redirect("/portal");
  const roles = await getUserRoles(auth.user.sub, request);
  if (!(await isFeatureEnabled("mentorship-warnings", auth.user.sub, roles, request))) {
    throw new Response("Not found", { status: 404 });
  }
  if (!(await isCore(auth.user.sub))) throw new Response("Forbidden", { status: 403 });
  return auth.user.sub;
}
