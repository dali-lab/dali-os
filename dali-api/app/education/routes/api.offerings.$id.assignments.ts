import type { Route } from "./+types/api.offerings.$id.assignments";
import { requireAuth } from "~/lib/auth";
import { canManageOffering } from "~/education/lib/auth";
import { createAssignment } from "~/education/lib/assignments-data";
import { logAuditEvent } from "~/lib/audit";

export async function action({ request, params }: Route.ActionArgs) {
  const auth = await requireAuth(request);
  if (!auth.ok) return auth.response;
  if (request.method !== "POST") {
    return Response.json({ error: "Method not allowed" }, { status: 405 });
  }
  if (!(await canManageOffering(auth.user.sub, params.id))) {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }

  const body = await request.json().catch(() => null);
  if (!body?.title || !body?.submissionType) {
    return Response.json({ error: "title and submissionType are required" }, { status: 400 });
  }
  if (body.submissionType !== "Text" && body.submissionType !== "File" && body.submissionType !== "Mixed") {
    return Response.json({ error: "submissionType must be Text, File, or Mixed" }, { status: 400 });
  }

  const created = await createAssignment({
    offeringId: params.id,
    title: String(body.title),
    submissionType: body.submissionType,
    dueAt: body.dueAt ? new Date(body.dueAt) : null,
    sessionId: body.sessionId ?? null,
    instructionsDocId: body.instructionsDocId ?? null,
  });

  await logAuditEvent({
    action: "education.assignment.create",
    userId: auth.user.sub,
    targetId: created.id,
    metadata: { offeringId: params.id, title: created.title },
    request,
  });

  return Response.json(created, { status: 201 });
}
