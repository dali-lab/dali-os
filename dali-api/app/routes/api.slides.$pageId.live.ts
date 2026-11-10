import type { Route } from "./+types/api.slides.$pageId.live";
import { requireAuth } from "~/lib/auth";
import { parseJson } from "~/lib/validate";
import { applyLive, liveIntentSchema, readLive, slidesLiveEnabled, type LiveResult } from "~/lib/slide-live.server";

const notFound = () => new Response("Not found", { status: 404 });

function respond(result: LiveResult) {
  return result.ok
    ? Response.json(result.live, { headers: { "Cache-Control": "private, no-cache" } })
    : Response.json({ error: result.error }, { status: result.status });
}

export async function loader({ request, params }: Route.LoaderArgs) {
  const auth = await requireAuth(request);
  if (!auth.ok) return auth.response;
  if (!(await slidesLiveEnabled(auth.user.sub, request))) return notFound();
  return respond(await readLive(auth.user.sub, params.pageId, request));
}

export async function action({ request, params }: Route.ActionArgs) {
  const auth = await requireAuth(request);
  if (!auth.ok) return auth.response;
  if (!(await slidesLiveEnabled(auth.user.sub, request))) return notFound();
  if (request.method !== "POST") return new Response("Method not allowed", { status: 405 });
  const body = await parseJson(request, liveIntentSchema);
  if (body instanceof Response) return body;
  return respond(await applyLive(auth.user.sub, params.pageId, body, request));
}
