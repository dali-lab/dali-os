import { redirect } from "react-router";
import { isNonMember, requireAuth } from "~/lib/auth";
import { isFeatureEnabled } from "~/lib/feature-flags.server";
import { redirectToLogin } from "~/lib/login-next";
import { getUserRoles, type UserRoles } from "~/lib/roles";

export type PaperworkGuard =
  | { ok: true; userId: string; roles: UserRoles }
  | { ok: false; response: Response };

export async function guardPaperwork(request: Request, opts: { page: boolean }): Promise<PaperworkGuard> {
  const auth = await requireAuth(request);
  if (!auth.ok) {
    return { ok: false, response: opts.page ? redirectToLogin(request) : Response.json({ error: "Unauthorized" }, { status: 401 }) };
  }
  if (await isNonMember(auth, request)) {
    return { ok: false, response: opts.page ? redirect("/portal") : Response.json({ error: "Forbidden" }, { status: 403 }) };
  }
  const roles = await getUserRoles(auth.user.sub, request);
  if (roles.isAlumni || !(await isFeatureEnabled("paperwork", auth.user.sub, roles, request))) {
    return { ok: false, response: new Response("Not found", { status: 404 }) };
  }
  return { ok: true, userId: auth.user.sub, roles };
}
