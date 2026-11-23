import type { Route } from "./+types/api.slide-templates";
import { requireAuth } from "~/lib/auth";
import { parseJson } from "~/lib/validate";
import { createSlideTemplate, createTemplateSchema, listForScopes, listSlideTemplates, type TemplateResult } from "~/lib/slide-templates.server";

function respond(result: TemplateResult<object>) {
  if (result.ok) {
    const { ok: _ok, ...rest } = result;
    return Response.json(rest, { headers: { "Cache-Control": "private, no-cache" } });
  }
  return Response.json({ error: result.error }, { status: result.status });
}

export async function loader({ request }: Route.LoaderArgs) {
  const auth = await requireAuth(request);
  if (!auth.ok) return auth.response;
  const url = new URL(request.url);
  const pageId = url.searchParams.get("pageId");
  if (pageId) return respond(await listSlideTemplates(auth.user.sub, pageId, request));
  return respond({ ok: true, ...(await listForScopes(auth.user.sub, url.searchParams.get("projectId"))) });
}

export async function action({ request }: Route.ActionArgs) {
  const auth = await requireAuth(request);
  if (!auth.ok) return auth.response;
  if (request.method !== "POST") return new Response("Method not allowed", { status: 405 });
  const body = await parseJson(request, createTemplateSchema);
  if (body instanceof Response) return body;
  const result = await createSlideTemplate(auth.user.sub, body, request);
  return result.ok ? Response.json({ id: result.id }, { status: 201 }) : respond(result);
}
