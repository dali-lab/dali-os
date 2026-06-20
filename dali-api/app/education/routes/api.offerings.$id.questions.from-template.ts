import type { Route } from "./+types/api.offerings.$id.questions.from-template";
import { requireAuth } from "~/lib/auth";
import { canManageOffering } from "~/education/lib/auth";
import { applyTemplateToOffering } from "~/education/lib/templates-data";
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
  const templateId = typeof body?.templateId === "string" ? body.templateId : null;
  if (!templateId) return Response.json({ error: "templateId required" }, { status: 400 });

  try {
    const result = await applyTemplateToOffering(templateId, params.id);
    await logAuditEvent({
      action: "education.template.apply",
      userId: auth.user.sub,
      targetId: params.id,
      metadata: { templateId },
      request,
    });
    return Response.json(result);
  } catch (err) {
    return Response.json(
      { error: err instanceof Error ? err.message : "Apply failed" },
      { status: 400 },
    );
  }
}
