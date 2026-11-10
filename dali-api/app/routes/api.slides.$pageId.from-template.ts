import type { Route } from "./+types/api.slides.$pageId.from-template";
import { z } from "zod";
import { requireAuth } from "~/lib/auth";
import { isFeatureEnabled } from "~/lib/feature-flags.server";
import { getUserRoles } from "~/lib/roles";
import { parseJson } from "~/lib/validate";
import { applyDeckTemplate } from "~/lib/slide-templates.server";

const bodySchema = z.object({ templateId: z.string().min(1) });

export async function action({ request, params }: Route.ActionArgs) {
  const auth = await requireAuth(request);
  if (!auth.ok) return auth.response;
  const roles = await getUserRoles(auth.user.sub, request);
  if (!(await isFeatureEnabled("slides-collab", auth.user.sub, roles, request))) return new Response("Not found", { status: 404 });
  if (request.method !== "POST") return new Response("Method not allowed", { status: 405 });
  const body = await parseJson(request, bodySchema);
  if (body instanceof Response) return body;
  const result = await applyDeckTemplate(auth.user.sub, params.pageId, body.templateId, request);
  return result.ok ? Response.json({ slideIds: result.slideIds }) : Response.json({ error: result.error }, { status: result.status });
}
