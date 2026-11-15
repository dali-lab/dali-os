import { redirect } from "react-router";
import { requireAuth, redirectPartnerToPortal, isNonMember } from "~/lib/auth";
import { redirectToLogin } from "~/lib/login-next";
import { getUserRoles, type UserRoles } from "~/lib/roles";
import { isFeatureEnabled } from "~/lib/feature-flags.server";
import type { FeatureFlagKey } from "~/lib/feature-flags";

export type LabViewerOptions = {
  flag?: FeatureFlagKey;
  allow?: (roles: UserRoles) => boolean;
  denied?: "404" | "home";
};

export async function requireLabViewer(request: Request, opts: LabViewerOptions = {}) {
  const auth = await requireAuth(request);
  if (!auth.ok) throw redirectToLogin(request);
  const partnerRedirect = await redirectPartnerToPortal(auth);
  if (partnerRedirect) throw partnerRedirect;
  if (await isNonMember(auth, request)) throw redirect("/portal");

  const userId = auth.user.sub;
  const roles = await getUserRoles(userId, request);
  if (opts.allow && !opts.allow(roles)) {
    throw opts.denied === "home" ? redirect("/") : new Response("Not found", { status: 404 });
  }
  if (opts.flag && !(await isFeatureEnabled(opts.flag, userId, roles, request))) {
    throw new Response("Not found", { status: 404 });
  }
  return { auth, user: auth.user, userId, roles };
}

export const labMemberOrCore = (roles: UserRoles) => roles.isLabMember || roles.isCore;
