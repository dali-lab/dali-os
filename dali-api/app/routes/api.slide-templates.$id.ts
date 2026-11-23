import type { Route } from "./+types/api.slide-templates.$id";
import { requireAuth } from "~/lib/auth";
import { deleteSlideTemplate, getSlideTemplate } from "~/lib/slide-templates.server";

export async function loader({ request, params }: Route.LoaderArgs) {
  const auth = await requireAuth(request);
  if (!auth.ok) return auth.response;
  const result = await getSlideTemplate(auth.user.sub, params.id);
  return result.ok ? Response.json(result.template, { headers: { "Cache-Control": "private, no-cache" } }) : Response.json({ error: result.error }, { status: result.status });
}

export async function action({ request, params }: Route.ActionArgs) {
  const auth = await requireAuth(request);
  if (!auth.ok) return auth.response;
  if (request.method !== "DELETE") return new Response("Method not allowed", { status: 405 });
  const result = await deleteSlideTemplate(auth.user.sub, params.id);
  return result.ok ? Response.json({ ok: true }) : Response.json({ error: result.error }, { status: result.status });
}
