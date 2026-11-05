import type { Route } from "./+types/api.slides.$pageId.reactions";
import { requireAuth } from "~/lib/auth";
import { parseJson } from "~/lib/validate";
import { slidesLiveEnabled } from "~/lib/slide-live.server";
import { reactionSchema, sendReaction } from "~/lib/slide-poll.server";

export async function action({ request, params }: Route.ActionArgs) {
  const auth = await requireAuth(request);
  if (!auth.ok) return auth.response;
  if (!(await slidesLiveEnabled(auth.user.sub, request))) return new Response("Not found", { status: 404 });
  if (request.method !== "POST") return new Response("Method not allowed", { status: 405 });
  const body = await parseJson(request, reactionSchema);
  if (body instanceof Response) return body;
  const result = await sendReaction(auth.user.sub, params.pageId, body.emoji, request);
  return result.ok ? Response.json({ ok: true }) : Response.json({ error: result.error }, { status: result.status });
}
