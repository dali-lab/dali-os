// POST /admin/stop-impersonating
// Ends the current BetterAuth impersonation session, restoring the original
// admin session.
//
// No admin check needed — anyone holding an impersonation session token should
// be able to exit it. The plugin itself validates the session state.

import { redirect } from "react-router";
import { getBetterAuthUser } from "~/lib/betterauth-compat.server";
import { auth } from "~/lib/betterauth.server";
import { logAuditEvent } from "~/lib/audit";
import { clearAdminSessionCookieHeader, redirectRestoringAdmin } from "~/lib/impersonation-restore.server";

export async function action({ request }: { request: Request }): Promise<Response> {
  const actor = await getBetterAuthUser(request);
  if (actor) {
    try {
      const { headers: baHeaders } = await auth.api.stopImpersonating({
        headers: request.headers,
        returnHeaders: true,
      });
      await logAuditEvent({
        action: "admin.impersonate.stop",
        userId: actor.sub,
        request,
      });
      const responseHeaders = new Headers();
      baHeaders.forEach((value, key) => {
        if (key.toLowerCase() === "set-cookie") {
          responseHeaders.append("Set-Cookie", value);
        }
      });
      return redirect("/", { headers: responseHeaders });
    } catch {
      // Falls through to restoring from the admin_session cookie.
    }
  }

  const restored = await redirectRestoringAdmin(request, "/");
  if (restored) return restored;
  return redirect("/", { headers: { "Set-Cookie": await clearAdminSessionCookieHeader() } });
}
