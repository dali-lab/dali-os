import type { Route } from "./+types/api.templates";
import { requireAuth } from "~/lib/auth";
import { isCore } from "~/lib/roles";
import { createTemplate } from "~/education/lib/templates-data";
import { logAuditEvent } from "~/lib/audit";

export async function action({ request }: Route.ActionArgs) {
  const auth = await requireAuth(request);
  if (!auth.ok) return auth.response;
  if (request.method !== "POST") {
    return Response.json({ error: "Method not allowed" }, { status: 405 });
  }
  if (!(await isCore(auth.user.sub))) {
    return Response.json({ error: "Core only" }, { status: 403 });
  }

  const body = await request.json().catch(() => null);
  if (!body?.name) return Response.json({ error: "name required" }, { status: 400 });
  const questions = Array.isArray(body.questions)
    ? body.questions
        .map((q: any) =>
          q && typeof q.prompt === "string" && q.prompt.trim()
            ? { prompt: q.prompt.trim(), required: q.required !== false }
            : null,
        )
        .filter(Boolean) as { prompt: string; required: boolean }[]
    : [];

  const created = await createTemplate({
    name: String(body.name),
    description: body.description ? String(body.description) : null,
    createdById: auth.user.sub,
    questions,
  });

  await logAuditEvent({
    action: "education.template.create",
    userId: auth.user.sub,
    targetId: created.id,
    metadata: { questions: questions.length },
    request,
  });

  return Response.json(created, { status: 201 });
}
