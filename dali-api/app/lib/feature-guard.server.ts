import { redirect } from "react-router";
import { isNonMember, requireAuth, type AuthSuccess } from "~/lib/auth";
import type { FeatureFlagKey } from "~/lib/feature-flags";
import { isFeatureEnabled } from "~/lib/feature-flags.server";
import { redirectToLogin } from "~/lib/login-next";
import { getUserRoles, type UserRoles } from "~/lib/roles";

export type MemberDenial = "non_member" | "alumni" | "blocked";

export type FeatureGuard =
  | { ok: true; auth: AuthSuccess; userId: string; roles: UserRoles }
  | { ok: false; response: Response };

export type FeatureGuardOptions = {
  flag: FeatureFlagKey;
  page: boolean;
  json: (error: string) => unknown;
  unauthorizedMessage: string;
  denial?: (a: { auth: AuthSuccess; roles: UserRoles; isMember: boolean }) => MemberDenial | null;
  blockedMessage?: string;
};

function defaultDenial(a: { roles: UserRoles; isMember: boolean }): MemberDenial | null {
  if (!a.isMember) return "non_member";
  return a.roles.isAlumni ? "alumni" : null;
}

export async function guardMemberFeature(request: Request, opts: FeatureGuardOptions): Promise<FeatureGuard> {
  const auth = await requireAuth(request);
  if (!auth.ok) {
    return {
      ok: false,
      response: opts.page ? redirectToLogin(request) : Response.json(opts.json(opts.unauthorizedMessage), { status: 401 }),
    };
  }
  const roles = await getUserRoles(auth.user.sub, request);
  const isMember = !(await isNonMember(auth, request));
  const denial = (opts.denial ?? defaultDenial)({ auth, roles, isMember });
  if (denial === "non_member") {
    return { ok: false, response: opts.page ? redirect("/portal") : Response.json(opts.json("Forbidden"), { status: 403 }) };
  }
  if (denial === "alumni" || !(await isFeatureEnabled(opts.flag, auth.user.sub, roles, request))) {
    return { ok: false, response: new Response("Not found", { status: 404 }) };
  }
  if (denial === "blocked") {
    return { ok: false, response: Response.json(opts.json(opts.blockedMessage ?? "Forbidden"), { status: 403 }) };
  }
  return { ok: true, auth, userId: auth.user.sub, roles };
}
