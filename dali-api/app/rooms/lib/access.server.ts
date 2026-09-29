import { requireAuth, forbidden, type AuthUser } from "~/lib/auth";
import { getUserRoles } from "~/lib/roles";
import { isFeatureEnabled } from "~/lib/feature-flags.server";
import { withCors } from "~/lib/cors";

export async function isRoomBookingEnabled(userId: string, request: Request): Promise<boolean> {
  const roles = await getUserRoles(userId, request);
  return isFeatureEnabled("room-booking", userId, roles, request);
}

/** Session gate for the member-facing room routes: a lab member with `room-booking` on. */
export async function requireRoomBookingUser(
  request: Request,
): Promise<{ ok: true; user: AuthUser } | { ok: false; response: Response }> {
  const auth = await requireAuth(request);
  if (!auth.ok) return { ok: false, response: withCors(request, auth.response) };
  if (auth.user.type === "applicant") return { ok: false, response: forbidden(request) };
  if (!(await isRoomBookingEnabled(auth.user.sub, request))) {
    return { ok: false, response: withCors(request, Response.json({ error: "Not found" }, { status: 404 })) };
  }
  return { ok: true, user: auth.user };
}
