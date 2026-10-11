import type { Route } from "./+types/api.events.$eventId.check-in";
import { requireAuth } from "~/lib/auth";
import { getUserRoles } from "~/lib/roles";
import { isFeatureEnabled } from "~/lib/feature-flags.server";
import { withCors, handlePreflight } from "~/lib/cors";
import { selfCheckInToEvent } from "~/hiring/lib/hiring-events.server";

// POST /api/hiring/events/:eventId/check-in — self check-in by QR scan.
// requireAuth only: any authenticated user, no enrollment/application gate.
// The userId is always the caller's own session — never read from the
// request body — so this can never mark anyone else present.

export async function action({ request, params }: Route.ActionArgs) {
  const preflight = handlePreflight(request);
  if (preflight) return preflight;

  if (request.method !== "POST") {
    return withCors(request, Response.json({ error: "Method not allowed" }, { status: 405 }));
  }

  const auth = await requireAuth(request);
  if (!auth.ok) return withCors(request, auth.response);

  const roles = await getUserRoles(auth.user.sub, request);
  if (!(await isFeatureEnabled("application-events", auth.user.sub, roles, request))) {
    return withCors(request, Response.json({ error: "Not found" }, { status: 404 }));
  }

  const result = await selfCheckInToEvent({ eventId: params.eventId!, userId: auth.user.sub });
  if ("error" in result) {
    return withCors(request, Response.json({ error: result.error }, { status: result.status }));
  }
  return withCors(request, Response.json({ ok: true, alreadyPresent: result.alreadyPresent }));
}
