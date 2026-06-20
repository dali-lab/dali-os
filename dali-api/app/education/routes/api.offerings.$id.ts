import type { Route } from "./+types/api.offerings.$id";
import { requireAuth } from "~/lib/auth";
import { prisma } from "~/lib/db";
import { canManageOffering } from "~/education/lib/auth";
import { updateOffering } from "~/education/lib/offerings-data";
import { logAuditEvent } from "~/lib/audit";

export async function action({ request, params }: Route.ActionArgs) {
  const auth = await requireAuth(request);
  if (!auth.ok) return auth.response;
  if (!(await canManageOffering(auth.user.sub, params.id))) {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }

  if (request.method === "DELETE") {
    const offering = await prisma.educationOffering.findUnique({ where: { id: params.id } });
    if (!offering) return Response.json({ error: "Not found" }, { status: 404 });
    if (offering.status !== "Draft") {
      return Response.json({ error: "Only Draft offerings can be deleted" }, { status: 409 });
    }
    await prisma.educationOffering.delete({ where: { id: params.id } });
    await logAuditEvent({ action: "education.offering.delete", userId: auth.user.sub, targetId: params.id, request });
    return Response.json({ ok: true });
  }

  if (request.method !== "PATCH" && request.method !== "POST") {
    return Response.json({ error: "Method not allowed" }, { status: 405 });
  }

  const body = await request.json().catch(() => null);
  if (!body) return Response.json({ error: "Invalid body" }, { status: 400 });

  const patch: Parameters<typeof updateOffering>[1] = {};
  if (body.title !== undefined) patch.title = String(body.title);
  if (body.capacity !== undefined) patch.capacity = Number(body.capacity);
  if (body.registrationOpensAt !== undefined) patch.registrationOpensAt = new Date(body.registrationOpensAt);
  if (body.registrationClosesAt !== undefined) patch.registrationClosesAt = new Date(body.registrationClosesAt);
  if (body.startsAt !== undefined) patch.startsAt = new Date(body.startsAt);
  if (body.endsAt !== undefined) patch.endsAt = new Date(body.endsAt);
  if (body.requiresReview !== undefined) patch.requiresReview = !!body.requiresReview;
  if (body.descriptionDocId !== undefined) patch.descriptionDocId = body.descriptionDocId;
  if (body.calendarEmail !== undefined) patch.calendarEmail = body.calendarEmail;

  const updated = await updateOffering(params.id, patch);
  await logAuditEvent({
    action: "education.offering.update",
    userId: auth.user.sub,
    targetId: params.id,
    metadata: { fields: Object.keys(patch) },
    request,
  });
  return Response.json(updated);
}
