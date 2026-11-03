import type { Route } from "./+types/api.pages.$id.date";
import { z } from "zod";
import { requireMemberSession } from "~/lib/auth";
import { withCors, handlePreflight } from "~/lib/cors";
import { parseJson } from "~/lib/validate";
import { setNoteDate, notebookErrorResponse } from "~/lib/notebooks.server";
import { APPLICATION_TZ, zonedDayStartUtc } from "~/lib/timezone";

// POST /api/pages/:id/date
//   { date: "YYYY-MM-DD" }  — set the note's week-grouping date
//   { date: null }          — clear it; the note floats above the first week

const BodySchema = z.object({
  date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "Date must be YYYY-MM-DD")
    .nullable(),
});

export async function action({ request, params }: Route.ActionArgs) {
  const preflight = handlePreflight(request);
  if (preflight) return preflight;
  if (request.method !== "POST") {
    return withCors(request, Response.json({ error: "Method not allowed" }, { status: 405 }));
  }
  const gate = await requireMemberSession(request);
  if (!gate.ok) return withCors(request, gate.response);
  const actorId = gate.auth.user.sub;

  const body = await parseJson(request, BodySchema);
  if (body instanceof Response) return withCors(request, body);

  const instant = body.date
    ? zonedDayStartUtc(
        Number(body.date.slice(0, 4)),
        Number(body.date.slice(5, 7)),
        Number(body.date.slice(8, 10)),
        APPLICATION_TZ,
      )
    : null;

  try {
    await setNoteDate(params.id!, instant, actorId);
    return withCors(request, Response.json({ ok: true }));
  } catch (err) {
    return withCors(request, notebookErrorResponse(err));
  }
}
