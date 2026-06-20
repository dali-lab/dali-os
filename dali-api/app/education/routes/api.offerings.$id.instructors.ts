import type { Route } from "./+types/api.offerings.$id.instructors";
import { requireAuth } from "~/lib/auth";
import { isCore } from "~/lib/roles";
import { addInstructor, removeInstructor } from "~/education/lib/offerings-data";
import { logAuditEvent } from "~/lib/audit";

export async function action({ request, params }: Route.ActionArgs) {
  const auth = await requireAuth(request);
  if (!auth.ok) return auth.response;
  if (!(await isCore(auth.user.sub))) {
    return Response.json({ error: "Only Core can manage instructors" }, { status: 403 });
  }

  const body = await request.json().catch(() => null);
  if (!body?.userId || !body?.termId) {
    return Response.json({ error: "userId and termId required" }, { status: 400 });
  }

  if (request.method === "DELETE") {
    await removeInstructor(params.id, body.userId, body.termId);
    await logAuditEvent({
      action: "education.instructor.remove",
      userId: auth.user.sub,
      targetId: params.id,
      metadata: { instructorUserId: body.userId, termId: body.termId },
      request,
    });
    return Response.json({ ok: true });
  }

  if (request.method !== "POST") {
    return Response.json({ error: "Method not allowed" }, { status: 405 });
  }

  const created = await addInstructor(params.id, body.userId, body.termId);
  await logAuditEvent({
    action: "education.instructor.add",
    userId: auth.user.sub,
    targetId: params.id,
    metadata: { instructorUserId: body.userId, termId: body.termId },
    request,
  });
  return Response.json(created, { status: 201 });
}
