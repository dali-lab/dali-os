import type { Route } from "./+types/api.cycles.$cycleId.events";
import { z } from "zod";
import { requireAuth } from "~/lib/auth";
import { getUserRoles } from "~/lib/roles";
import { isFeatureEnabled } from "~/lib/feature-flags.server";
import { withCors, handlePreflight } from "~/lib/cors";
import { parseJson, nullableTrimmed } from "~/lib/validate";
import { createHiringEvent } from "~/hiring/lib/hiring-events.server";

// POST /api/hiring/cycles/:cycleId/events — create an application event (help
// hour, social, info session). The Core gate lives in createHiringEvent
// (isCycleAdmin on the cycle); this route only adds the feature-flag gate,
// since the lib is flag-agnostic.

const CreateEventSchema = z.object({
  kind: z.enum(["HelpHour", "Social", "InfoSession", "Other"]),
  title: z.string().min(1),
  startsAt: z.string().min(1),
  endsAt: z.string().min(1),
  location: nullableTrimmed.optional(),
});

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

  const body = await parseJson(request, CreateEventSchema);
  if (body instanceof Response) return withCors(request, body);

  const result = await createHiringEvent({
    cycleId: params.cycleId!,
    actorId: auth.user.sub,
    kind: body.kind,
    title: body.title,
    startsAt: new Date(body.startsAt),
    endsAt: new Date(body.endsAt),
    location: body.location ?? null,
  });
  if ("error" in result) {
    return withCors(request, Response.json({ error: result.error }, { status: result.status }));
  }
  return withCors(request, Response.json(result.event, { status: 201 }));
}
