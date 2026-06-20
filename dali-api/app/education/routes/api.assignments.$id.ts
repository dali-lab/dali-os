import type { Route } from "./+types/api.assignments.$id";
import { requireAuth } from "~/lib/auth";
import { prisma } from "~/lib/db";
import { canManageOffering } from "~/education/lib/auth";
import { deleteAssignment, updateAssignment } from "~/education/lib/assignments-data";
import { logAuditEvent } from "~/lib/audit";

export async function action({ request, params }: Route.ActionArgs) {
  const auth = await requireAuth(request);
  if (!auth.ok) return auth.response;

  const assignment = await prisma.educationAssignment.findUnique({
    where: { id: params.id },
    select: { id: true, offeringId: true },
  });
  if (!assignment?.offeringId) {
    return Response.json({ error: "Assignment not found" }, { status: 404 });
  }
  if (!(await canManageOffering(auth.user.sub, assignment.offeringId))) {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }

  if (request.method === "DELETE") {
    await deleteAssignment(params.id);
    await logAuditEvent({
      action: "education.assignment.delete",
      userId: auth.user.sub,
      targetId: params.id,
      request,
    });
    return Response.json({ ok: true });
  }

  if (request.method !== "PATCH" && request.method !== "POST") {
    return Response.json({ error: "Method not allowed" }, { status: 405 });
  }

  const body = await request.json().catch(() => null);
  if (!body) return Response.json({ error: "Invalid body" }, { status: 400 });

  const patch: Parameters<typeof updateAssignment>[1] = {};
  if (body.title !== undefined) patch.title = String(body.title);
  if (body.submissionType !== undefined) patch.submissionType = body.submissionType;
  if (body.dueAt !== undefined) patch.dueAt = body.dueAt ? new Date(body.dueAt) : null;
  if (body.sessionId !== undefined) patch.sessionId = body.sessionId;
  if (body.instructionsDocId !== undefined) patch.instructionsDocId = body.instructionsDocId;

  const updated = await updateAssignment(params.id, patch);
  await logAuditEvent({
    action: "education.assignment.update",
    userId: auth.user.sub,
    targetId: params.id,
    request,
  });
  return Response.json(updated);
}
