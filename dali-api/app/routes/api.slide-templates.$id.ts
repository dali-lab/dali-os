import type { Route } from "./+types/api.slide-templates.$id";
import { requireAuth } from "~/lib/auth";
import { isFeatureEnabled } from "~/lib/feature-flags.server";
import { getUserRoles } from "~/lib/roles";
import { deleteSlideTemplate, getSlideTemplate } from "~/lib/slide-templates.server";

async function gate(request: Request) {
  const auth = await requireAuth(request);
  if (!auth.ok) return { response: auth.response };
  const roles = await getUserRoles(auth.user.sub, request);
  if (!(await isFeatureEnabled("slides-collab", auth.user.sub, roles, request))) return { response: new Response("Not found", { status: 404 }) };
  return { userId: auth.user.sub };
}

export async function loader({ request, params }: Route.LoaderArgs) {
  const g = await gate(request);
  if ("response" in g) return g.response;
  const result = await getSlideTemplate(g.userId, params.id);
  return result.ok ? Response.json(result.template, { headers: { "Cache-Control": "private, no-cache" } }) : Response.json({ error: result.error }, { status: result.status });
}

export async function action({ request, params }: Route.ActionArgs) {
  const g = await gate(request);
  if ("response" in g) return g.response;
  if (request.method !== "DELETE") return new Response("Method not allowed", { status: 405 });
  const result = await deleteSlideTemplate(g.userId, params.id);
  return result.ok ? Response.json({ ok: true }) : Response.json({ error: result.error }, { status: result.status });
}
