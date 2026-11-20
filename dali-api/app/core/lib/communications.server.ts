import { redirect } from "react-router";
import { requireAuth } from "~/lib/auth";
import { redirectToLogin } from "~/lib/login-next";
import { getUserRoles, type UserRoles } from "~/lib/roles";

export type CommsViewer = { userId: string; roles: UserRoles };

export async function requireCommsViewer(request: Request): Promise<CommsViewer> {
  const auth = await requireAuth(request);
  if (!auth.ok) throw redirectToLogin(request);
  const roles = await getUserRoles(auth.user.sub, request);
  if (!roles.isCore) throw redirect("/");
  return { userId: auth.user.sub, roles };
}
