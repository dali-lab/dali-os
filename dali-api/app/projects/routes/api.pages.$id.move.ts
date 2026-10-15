import type { Route } from "./+types/api.pages.$id.move";
import { requireAuth } from "~/lib/auth";
import { withCors, handlePreflight } from "~/lib/cors";
import { parseJson } from "~/lib/validate";
import { movePage, MovePageBodySchema } from "~/lib/page-move.server";

// POST /api/pages/:id/move. The rules live in movePage (~/lib/page-move.server).
export async function action({ request, params }: Route.ActionArgs) {
  const preflight = handlePreflight(request);
  if (preflight) return preflight;
  if (request.method !== "POST") {
    return withCors(request, Response.json({ error: "Method not allowed" }, { status: 405 }));
  }

  const auth = await requireAuth(request);
  if (!auth.ok) return withCors(request, auth.response);

  const result = await movePage({
    pageId: params.id!,
    userId: auth.user.sub,
    request,
    input: () => parseJson(request, MovePageBodySchema),
  });
  if (result.ok) return withCors(request, Response.json({ ok: true, clearedReceivers: result.clearedReceivers, from: result.from }));
  if ("response" in result) return withCors(request, result.response);
  return withCors(request, Response.json({ error: result.error }, { status: result.status }));
}
