import type { Route } from "./+types/logout";
import { clearSessionCookie, parseSessionId } from "~/lib/cookies";
import { hashSessionId, revokeSession } from "~/lib/session";
import { prisma } from "~/lib/db";
import { logAuditEvent } from "~/lib/audit";

export async function loader({ request }: Route.LoaderArgs) {
  // Best-effort attribution: look up the current session (if any) so we
  // can record which user logged out. A missing/invalid session still
  // emits a logout event with userId=null.
  let userId: string | null = null;
  const raw = parseSessionId(request);
  if (raw) {
    const id = hashSessionId(raw);
    const session = await prisma.session.findUnique({
      where: { id },
      select: { userId: true },
    });
    if (session) userId = session.userId;
    await revokeSession(id, { hashed: true });
  }
  await logAuditEvent({
    action: "logout",
    userId,
    request,
  });

  const headers = new Headers();
  clearSessionCookie(headers);

  // Also end any BetterAuth session. It lives in a SEPARATE cookie (prefix
  // "dali") that clearSessionCookie above doesn't touch — so without this, a
  // user who signed in through BetterAuth can never actually log out: /login
  // sees the still-valid session and redirects them straight back in. That's
  // the trap behind "logged into the wrong Google account and can't get out".
  // Lazy-imported + fault-isolated so a BA fault (or the flag being off) can't
  // block clearing the legacy session.
  try {
    const { isFeatureEnabledForEveryone } = await import("~/lib/feature-flags.server");
    if (await isFeatureEnabledForEveryone("betterauth", request)) {
      const { auth } = await import("~/lib/betterauth.server");
      const { headers: baHeaders } = await auth.api.signOut({
        headers: request.headers,
        returnHeaders: true,
      });
      baHeaders.forEach((value, key) => {
        if (key.toLowerCase() === "set-cookie") headers.append("Set-Cookie", value);
      });
    }
  } catch {
    // A failed BetterAuth sign-out must not block the legacy logout.
  }

  headers.set("Location", "/login");
  return new Response(null, { status: 302, headers });
}
