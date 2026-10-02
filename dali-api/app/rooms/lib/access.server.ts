import { requireAuth, forbidden, type AuthUser } from "~/lib/auth";
import { withCors } from "~/lib/cors";

/** Session gate for the member-facing room routes: any signed-in non-applicant. */
export async function requireRoomBookingUser(
  request: Request,
): Promise<{ ok: true; user: AuthUser } | { ok: false; response: Response }> {
  const auth = await requireAuth(request);
  if (!auth.ok) return { ok: false, response: withCors(request, auth.response) };
  if (auth.user.type === "applicant") return { ok: false, response: forbidden(request) };
  return { ok: true, user: auth.user };
}
