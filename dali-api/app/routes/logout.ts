import type { Route } from "./+types/logout";
import { clearSessionCookie } from "~/lib/cookies";
import { logAuditEvent } from "~/lib/audit";

export async function loader({ request }: Route.LoaderArgs) {
  let userId: string | null = null;
  try {
    const { getBetterAuthUser } = await import("~/lib/betterauth-compat.server");
    userId = (await getBetterAuthUser(request))?.sub ?? null;
  } catch {
    // Attribution is best effort; a BetterAuth fault must not block logout.
  }
  await logAuditEvent({
    action: "logout",
    userId,
    request,
  });

  const headers = new Headers();
  clearSessionCookie(headers);

  try {
    const { auth } = await import("~/lib/betterauth.server");
    const { headers: baHeaders } = await auth.api.signOut({
      headers: request.headers,
      returnHeaders: true,
    });
    baHeaders.forEach((value, key) => {
      if (key.toLowerCase() === "set-cookie") headers.append("Set-Cookie", value);
    });
  } catch {
    // A failed BetterAuth sign-out must not block logout.
  }
  // Signing out mid-impersonation must not leave the admin's session for /login to restore.
  try {
    const { clearAdminSessionCookieHeader } = await import("~/lib/impersonation-restore.server");
    headers.append("Set-Cookie", await clearAdminSessionCookieHeader());
  } catch {
    // Same fault isolation as the sign-out above.
  }

  headers.set("Location", "/login");
  return new Response(null, { status: 302, headers });
}
