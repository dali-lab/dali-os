import type { Route } from "./+types/api.scheduled-meetings.$id.notebook";
import { z } from "zod";
import { requireMemberSession } from "~/lib/auth";
import { withCors, handlePreflight } from "~/lib/cors";
import { parseJson } from "~/lib/validate";
import { notebookErrorResponse, setSeriesNotebook } from "~/lib/notebooks.server";

// POST /api/scheduled-meetings/:id/notebook — { notebookId | null, scope }
//
// Change the series' default notebook. scope "future" only changes where later
// occurrences file; "all" also moves the notes already taken. Organizer or Core.

const BodySchema = z.object({
  notebookId: z.string().min(1).nullable(),
  scope: z.enum(["future", "all"]),
});

export async function action({ request, params }: Route.ActionArgs) {
  const preflight = handlePreflight(request);
  if (preflight) return preflight;
  if (request.method !== "POST") {
    return withCors(request, Response.json({ error: "Method not allowed" }, { status: 405 }));
  }
  const gate = await requireMemberSession(request);
  if (!gate.ok) return withCors(request, gate.response);

  const body = await parseJson(request, BodySchema);
  if (body instanceof Response) return withCors(request, body);

  try {
    const result = await setSeriesNotebook(
      params.id!,
      body.notebookId,
      { scope: body.scope },
      gate.auth.user.sub,
    );
    return withCors(request, Response.json({ ok: true, ...result }));
  } catch (err) {
    return withCors(request, notebookErrorResponse(err));
  }
}
