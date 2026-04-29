import type { Route } from "./+types/logout";
import { clearTokenCookies, parseAccessToken } from "~/lib/cookies";
import { verifyAccessToken } from "~/lib/auth";
import { logAuditEvent } from "~/lib/audit";

export async function loader({ request }: Route.LoaderArgs) {
  // Best-effort attribution: decode the access token (if any) so we can
  // record which user logged out. A failed/expired token still emits a
  // logout event with userId=null.
  let userId: string | null = null;
  const token = parseAccessToken(request);
  if (token) {
    try {
      const payload = await verifyAccessToken(token);
      userId = payload.sub;
    } catch {
      userId = null;
    }
  }
  await logAuditEvent({
    action: "logout",
    userId,
    request,
  });

  const headers = new Headers();
  clearTokenCookies(headers);
  headers.set("Location", "/login");
  return new Response(null, { status: 302, headers });
}
