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
  headers.set("Location", "/login");
  return new Response(null, { status: 302, headers });
}
