import type { Route } from "./+types/logout";
import { clearSessionCookie, parseSessionId } from "~/lib/cookies";
import { hashSessionId, revokeSession } from "~/lib/session";
import { prisma } from "~/lib/db.server";
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

  // The BetterAuth session lives in a separate cookie (prefix "dali") that
  // clearSessionCookie doesn't touch; without this /login would see it and
  // redirect straight back in. Lazy-imported and fault-isolated so a BetterAuth
  // fault can't block clearing the legacy session.
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
    // A failed BetterAuth sign-out must not block the legacy logout.
  }

  headers.set("Location", "/login");
  return new Response(null, { status: 302, headers });
}
