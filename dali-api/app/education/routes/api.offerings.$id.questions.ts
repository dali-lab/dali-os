import type { Route } from "./+types/api.offerings.$id.questions";
import { requireAuth } from "~/lib/auth";
import { canManageOffering } from "~/education/lib/auth";
import { duplicateQuestionsFromOffering, replaceQuestions } from "~/education/lib/offerings-data";
import { logAuditEvent } from "~/lib/audit";

export async function action({ request, params }: Route.ActionArgs) {
  const auth = await requireAuth(request);
  if (!auth.ok) return auth.response;
  if (request.method !== "POST" && request.method !== "PUT") {
    return Response.json({ error: "Method not allowed" }, { status: 405 });
  }
  if (!(await canManageOffering(auth.user.sub, params.id))) {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }

  const body = await request.json().catch(() => null);
  if (!body) return Response.json({ error: "Invalid body" }, { status: 400 });

  if (body.duplicateFromOfferingId) {
    const result = await duplicateQuestionsFromOffering(body.duplicateFromOfferingId, params.id);
    await logAuditEvent({
      action: "education.questions.duplicate",
      userId: auth.user.sub,
      targetId: params.id,
      metadata: { from: body.duplicateFromOfferingId },
      request,
    });
    return Response.json(result);
  }

  if (!Array.isArray(body.questions)) {
    return Response.json({ error: "questions array required" }, { status: 400 });
  }
  const cleaned = body.questions
    .map((q: unknown) => {
      if (!q || typeof q !== "object") return null;
      const row = q as { prompt?: unknown; required?: unknown };
      const prompt = typeof row.prompt === "string" ? row.prompt.trim() : "";
      if (!prompt) return null;
      return { prompt, required: row.required !== false };
    })
    .filter(Boolean) as { prompt: string; required: boolean }[];

  const result = await replaceQuestions(params.id, cleaned);
  await logAuditEvent({
    action: "education.questions.replace",
    userId: auth.user.sub,
    targetId: params.id,
    metadata: { count: cleaned.length },
    request,
  });
  return Response.json(result);
}
