import type { Route } from "./+types/api.offerings";
import { requireAuth } from "~/lib/auth";
import { isCore } from "~/lib/roles";
import { createOffering, listPublishedOfferings } from "~/education/lib/offerings-data";
import { logAuditEvent } from "~/lib/audit";

export async function loader({ request }: Route.LoaderArgs) {
  const auth = await requireAuth(request);
  if (!auth.ok) return auth.response;
  const items = await listPublishedOfferings();
  return Response.json(items);
}

export async function action({ request }: Route.ActionArgs) {
  const auth = await requireAuth(request);
  if (!auth.ok) return auth.response;
  if (request.method !== "POST") {
    return Response.json({ error: "Method not allowed" }, { status: 405 });
  }
  if (!(await isCore(auth.user.sub))) {
    return Response.json({ error: "Only Core can create offerings" }, { status: 403 });
  }

  const body = await request.json().catch(() => null);
  if (!body) return Response.json({ error: "Invalid body" }, { status: 400 });

  const required = ["type", "title", "capacity", "registrationOpensAt", "registrationClosesAt", "startsAt", "endsAt", "requiresReview"];
  for (const k of required) {
    if (body[k] === undefined || body[k] === null) {
      return Response.json({ error: `Missing field: ${k}` }, { status: 400 });
    }
  }
  if (body.type !== "Miniseries" && body.type !== "Workshop") {
    return Response.json({ error: "type must be Miniseries or Workshop" }, { status: 400 });
  }

  const created = await createOffering({
    type: body.type,
    title: String(body.title),
    capacity: Number(body.capacity),
    registrationOpensAt: new Date(body.registrationOpensAt),
    registrationClosesAt: new Date(body.registrationClosesAt),
    startsAt: new Date(body.startsAt),
    endsAt: new Date(body.endsAt),
    requiresReview: !!body.requiresReview,
    descriptionDocId: body.descriptionDocId ?? null,
    calendarEmail: body.calendarEmail ?? null,
  });

  await logAuditEvent({
    action: "education.offering.create",
    userId: auth.user.sub,
    targetId: created.id,
    metadata: { type: created.type, title: created.title },
    request,
  });

  return Response.json(created, { status: 201 });
}
