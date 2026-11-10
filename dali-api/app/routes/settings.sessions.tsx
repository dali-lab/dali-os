import { redirect } from "react-router";
import { requireAuth } from "~/lib/auth";
import { redirectToLogin } from "~/lib/login-next";
import { prisma } from "~/lib/db.server";
import { logAuditEvent } from "~/lib/audit";
import type { Route } from "./+types/settings.sessions";

export const meta: Route.MetaFunction = () => [{ title: "Settings · DALI OS" }];

export async function loader() {
  return redirect("/settings/security");
}

function logSessionRevoke(
  userId: string,
  scope: "one" | "others",
  count: number,
  request: Request,
) {
  if (count === 0) return;
  return logAuditEvent({
    action: "session.revoke",
    userId,
    targetId: userId,
    metadata: { scope, count },
    request,
  });
}

export async function action({ request }: Route.ActionArgs) {
  const auth = await requireAuth(request);
  if (!auth.ok) return redirectToLogin(request);

  const form = await request.formData();
  const intent = form.get("intent");

  // Deleting an AuthSession row revokes it on the next request (no cookie cache).
  if (intent === "revoke-one") {
    const sessionId = form.get("sessionId");
    if (typeof sessionId !== "string") {
      return redirect("/settings/security");
    }
    const { count } = await prisma.authSession.deleteMany({
      where: { id: sessionId, userId: auth.user.sub },
    });
    await logSessionRevoke(auth.user.sub, "one", count, request);
    return redirect("/settings/security");
  }

  if (intent === "revoke-others") {
    // Legacy sessions aren't listed any more, but one on another device would
    // otherwise survive "sign out everywhere else".
    const [current, legacy] = await Promise.all([
      prisma.authSession.deleteMany({
        where: { userId: auth.user.sub, NOT: { id: auth.sessionId } },
      }),
      prisma.session.updateMany({
        where: { userId: auth.user.sub, revokedAt: null, NOT: { id: auth.sessionId } },
        data: { revokedAt: new Date() },
      }),
    ]);
    const count = current.count + legacy.count;
    await logSessionRevoke(auth.user.sub, "others", count, request);
    return redirect("/settings/security");
  }

  return redirect("/settings/security");
}

export default function SettingsSessionsRedirect() {
  return null;
}
