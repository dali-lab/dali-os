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

  // Honor a post-logout destination so external portals (e.g. partners) land
  // back on their own sign-in page instead of the member /login. Allowlisted
  // to same-origin absolute paths ("/foo", never "//host" or a full URL).
  const next = new URL(request.url).searchParams.get("next");
  const destination =
    next && next.startsWith("/") && !next.startsWith("//") ? next : "/login";

  const headers = new Headers();
  clearSessionCookie(headers);
  headers.set("Location", destination);
  return new Response(null, { status: 302, headers });
}
