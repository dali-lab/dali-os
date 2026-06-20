import type { Route } from "./+types/api.templates.$id";
import { requireAuth } from "~/lib/auth";
import { isCore } from "~/lib/roles";
import { deleteTemplate, updateTemplate } from "~/education/lib/templates-data";
import { logAuditEvent } from "~/lib/audit";

export async function action({ request, params }: Route.ActionArgs) {
  const auth = await requireAuth(request);
  if (!auth.ok) return auth.response;
  if (!(await isCore(auth.user.sub))) {
    return Response.json({ error: "Core only" }, { status: 403 });
  }

  if (request.method === "DELETE") {
    await deleteTemplate(params.id);
    await logAuditEvent({
      action: "education.template.delete",
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

  const patch: Parameters<typeof updateTemplate>[1] = {};
  if (body.name !== undefined) patch.name = String(body.name);
  if (body.description !== undefined) patch.description = body.description ? String(body.description) : null;
  if (Array.isArray(body.questions)) {
    patch.questions = body.questions
      .map((q: any) =>
        q && typeof q.prompt === "string" && q.prompt.trim()
          ? { prompt: q.prompt.trim(), required: q.required !== false }
          : null,
      )
      .filter(Boolean) as { prompt: string; required: boolean }[];
  }

  const updated = await updateTemplate(params.id, patch);
  await logAuditEvent({
    action: "education.template.update",
    userId: auth.user.sub,
    targetId: params.id,
    request,
  });
  return Response.json(updated);
}
