import { redirect } from "react-router";
import { requireAuth } from "~/lib/auth";
import { redirectToLogin } from "~/lib/login-next";
import { getUserRoles, type UserRoles } from "~/lib/roles";
import { isFeatureEnabled } from "~/lib/feature-flags.server";
import type { FeatureFlagKey } from "~/lib/feature-flags";

export type CommsViewer = { userId: string; roles: UserRoles };

/**
 * Communications is Core's. A tool behind a flag 404s for anyone the flag
 * doesn't reach, so a stale link can't open a half-shipped page.
 */
export async function requireCommsViewer(
  request: Request,
  flag?: FeatureFlagKey,
): Promise<CommsViewer> {
  const auth = await requireAuth(request);
  if (!auth.ok) throw redirectToLogin(request);
  const roles = await getUserRoles(auth.user.sub, request);
  if (!roles.isCore) throw redirect("/");
  if (flag && !(await isFeatureEnabled(flag, auth.user.sub, roles, request))) {
    throw new Response("Not found", { status: 404 });
  }
  return { userId: auth.user.sub, roles };
}
