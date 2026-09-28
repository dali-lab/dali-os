// POST /admin/impersonate
// Starts a BetterAuth impersonation session for the acting admin.
//
// Gating:
//   1. `betterauth` feature flag must be on for everyone — impersonation only
//      works with BetterAuth sessions (no legacy session equivalent).
//   2. Acting user must have a valid BetterAuth session.
//   3. Acting user must be an Admin (AdminMembership or ADMIN_USER_IDS env).
//
// JIT role sync: the BetterAuth admin plugin gates impersonateUser on the
// acting session's `user.role` being in adminRoles (["admin"]). Our authz
// lives in AdminMembership, NOT in user.role — so we set user.role="admin"
// right before the call when it isn't already set. A fresh getSession in the
// plugin will re-read the row, so the gate passes. No standing sync.

import { redirect } from "react-router";
import { isFeatureEnabledForEveryone } from "~/lib/feature-flags.server";
import { getBetterAuthUser } from "~/lib/betterauth-compat.server";
import { isAdmin } from "~/lib/roles";
import { prisma } from "~/lib/db";
import { auth } from "~/lib/betterauth.server";
import { logAuditEvent } from "~/lib/audit";

export async function action({ request }: { request: Request }): Promise<Response> {
  // 1. Flag gate — this endpoint only exists when BetterAuth is active.
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

  // 3. Admin gate.
  const adminOk = await isAdmin(actor.sub);
  if (!adminOk) {
    return new Response(JSON.stringify({ error: "Forbidden" }), {
      status: 403,
      headers: { "Content-Type": "application/json" },
    });
  }

  // 4. Read target userId from formData.
  const formData = await request.formData();
  const userId = String(formData.get("userId") ?? "").trim();
  if (!userId) {
    return new Response(JSON.stringify({ error: "Missing userId" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  // 5. Reject self-impersonation.
  if (userId === actor.sub) {
    return new Response(JSON.stringify({ error: "Cannot impersonate self" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  // 6. JIT role sync: if the actor's user.role is not already "admin", set it
  //    so the BetterAuth admin plugin's gate passes. The plugin reads the row
  //    fresh on each call — no cookie cache is enabled, so this takes effect
  //    immediately. This is a targeted escalation for this one actor, not a
  //    standing sync: it will be set once and stay until reverted or the user
  //    row is cleaned up.
  const actorRow = await prisma.user.findUnique({
    where: { id: actor.sub },
    select: { role: true },
  });
  if (actorRow?.role !== "admin") {
    await prisma.user.update({
      where: { id: actor.sub },
      data: { role: "admin" },
    });
  }

  // 7. Call impersonateUser. returnHeaders: true gives us { headers, response }
  //    where headers carries the new impersonation session Set-Cookie.
  let baHeaders: Headers;
  try {
    const result = await auth.api.impersonateUser({
      body: { userId },
      headers: request.headers,
      returnHeaders: true,
    });
    baHeaders = result.headers;
  } catch (err) {
    return new Response(
      JSON.stringify({ error: "Impersonation failed" }),
      {
        status: 400,
        headers: { "Content-Type": "application/json" },
      },
    );
  }

  // 8. Audit.
  await logAuditEvent({
    action: "admin.impersonate.start",
    userId: actor.sub,
    targetId: userId,
    metadata: { targetUserId: userId },
    request,
  });

  // 9. Forward the Set-Cookie header(s) BetterAuth returned onto the redirect.
  const responseHeaders = new Headers();
  baHeaders.forEach((value, key) => {
    if (key.toLowerCase() === "set-cookie") {
      responseHeaders.append("Set-Cookie", value);
    }
  });
  return redirect("/", { headers: responseHeaders });
}
