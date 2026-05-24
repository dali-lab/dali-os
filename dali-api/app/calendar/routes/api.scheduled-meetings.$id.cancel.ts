import type { Route } from "./+types/api.scheduled-meetings.$id.cancel";
import { requireAuth } from "~/lib/auth";
import { withCors, handlePreflight } from "~/lib/cors";
import { cancelScheduledMeeting } from "~/lib/scheduled-meeting";

export async function action({ request, params }: Route.ActionArgs) {
  const preflight = handlePreflight(request);
  if (preflight) return preflight;

  const auth = await requireAuth(request);
  if (!auth.ok) return withCors(request, auth.response);
  if (auth.user.type === "applicant")
    return withCors(request, Response.json({ error: "Forbidden" }, { status: 403 }));

  if (request.method !== "POST") {
    return withCors(request, Response.json({ error: "Method not allowed" }, { status: 405 }));
  }

  const result = await cancelScheduledMeeting(params.id!, auth.user.sub);
  if (!result.ok) {
    return withCors(request, Response.json({ error: result.error }, { status: result.status }));
  }

  return withCors(
    request,
    Response.json({ ok: true, alreadyCancelled: result.alreadyCancelled }),
  );
}
