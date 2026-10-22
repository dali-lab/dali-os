import { requireAuth, type AuthSuccess } from "~/lib/auth";
import { getUserRoles } from "~/lib/roles";
import { isFeatureEnabled } from "~/lib/feature-flags.server";

export type MobileAuthResult =
  | { ok: true; auth: AuthSuccess; userId: string }
  | { ok: false; response: Response };

export function mobileError(error: string, status: number): Response {
  return Response.json({ error }, { status, headers: { "Cache-Control": "no-store" } });
}

export function mobileJson(body: unknown, init?: ResponseInit): Response {
  return Response.json(body, {
    ...init,
    headers: { "Cache-Control": "no-store", ...(init?.headers ?? {}) },
  });
}

// The mobile app's routes stay invisible (404, not 403) to members the flag
// hasn't reached, so a pre-rollout build can't probe what exists.
export async function isMobileAppEnabled(userId: string, request: Request): Promise<boolean> {
  const roles = await getUserRoles(userId, request);
  return roles.isLabMember && (await isFeatureEnabled("mobile-app", userId, roles, request));
}

export async function requireMobileUser(request: Request): Promise<MobileAuthResult> {
  const auth = await requireAuth(request);
  if (!auth.ok) return { ok: false, response: auth.response };
  if (!(await isMobileAppEnabled(auth.user.sub, request))) return { ok: false, response: mobileError("Not found", 404) };
  return { ok: true, auth, userId: auth.user.sub };
}
