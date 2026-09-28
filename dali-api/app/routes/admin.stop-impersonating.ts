// POST /admin/stop-impersonating
// Ends the current BetterAuth impersonation session, restoring the original
// admin session.
//
// No admin check needed — anyone holding an impersonation session token should
// be able to exit it. The plugin itself validates the session state.

import { redirect } from "react-router";
import { isFeatureEnabledForEveryone } from "~/lib/feature-flags.server";
import { getBetterAuthUser } from "~/lib/betterauth-compat.server";
import { auth } from "~/lib/betterauth.server";
import { logAuditEvent } from "~/lib/audit";

export async function action({ request }: { request: Request }): Promise<Response> {
  // 1. Flag gate.
  const flagOn = await isFeatureEnabledForEveryone("betterauth", request);
  if (!flagOn) {
    return new Response(null, { status: 404 });
  }

  // 2. Require a valid BetterAuth session.
  const actor = await getBetterAuthUser(request);
  if (!actor) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: { "Content-Type": "application/json" },
    });
  }

  // 3. Stop impersonating. returnHeaders: true gives us { headers, response }
  //    where headers carries the restored session Set-Cookie.
  const result = await auth.api.stopImpersonating({
    headers: request.headers,
    returnHeaders: true,
  });
  const baHeaders = result.headers;

  // 4. Audit.
  await logAuditEvent({
    action: "admin.impersonate.stop",
    userId: actor.sub,
    request,
  });

  // 5. Forward the Set-Cookie header(s) onto the redirect.
  const responseHeaders = new Headers();
  baHeaders.forEach((value, key) => {
    if (key.toLowerCase() === "set-cookie") {
      responseHeaders.append("Set-Cookie", value);
    }
  });
  return redirect("/", { headers: responseHeaders });
}
