import type { Route } from "./+types/api.pages.$id.date";
import { z } from "zod";
import { requireMemberSession } from "~/lib/auth";
import { withCors, handlePreflight } from "~/lib/cors";
import { parseJson } from "~/lib/validate";
import { setNoteDate, notebookErrorResponse } from "~/calendar/lib/notebooks.server";
import { APPLICATION_TZ, ymdDayStartUtc } from "~/lib/timezone";

const BodySchema = z.object({
  date: z.iso.date("Date must be a valid YYYY-MM-DD date").nullable(),
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

  const instant = body.date ? ymdDayStartUtc(body.date, APPLICATION_TZ) : null;
  if (body.date && !instant) {
    return withCors(request, Response.json({ error: "Date is not supported" }, { status: 400 }));
  }

  try {
    await setNoteDate(params.id!, instant, actorId);
    return withCors(request, Response.json({ ok: true }));
  } catch (err) {
    return withCors(request, notebookErrorResponse(err));
  }
}
