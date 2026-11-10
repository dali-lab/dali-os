import type { Route } from "./+types/api.slides.$pageId.polls";
import { requireAuth } from "~/lib/auth";
import { parseJson } from "~/lib/validate";
import { slidesLiveEnabled } from "~/lib/slide-live.server";
import { applyPoll, pollIntentSchema, readPolls, type PollsResult } from "~/lib/slide-poll.server";

const notFound = () => new Response("Not found", { status: 404 });

function respond(result: PollsResult) {
  return result.ok
    ? Response.json(result.state, { headers: { "Cache-Control": "private, no-cache" } })
    : Response.json({ error: result.error }, { status: result.status });
}

export async function loader({ request, params }: Route.LoaderArgs) {
  const auth = await requireAuth(request);
  if (!auth.ok) return auth.response;
  if (!(await slidesLiveEnabled(auth.user.sub, request))) return notFound();
  return respond(await readPolls(auth.user.sub, params.pageId, request));
}

export async function action({ request, params }: Route.ActionArgs) {
  const auth = await requireAuth(request);
  if (!auth.ok) return auth.response;
  if (!(await slidesLiveEnabled(auth.user.sub, request))) return notFound();
  if (request.method !== "POST") return new Response("Method not allowed", { status: 405 });
  const body = await parseJson(request, pollIntentSchema);
  if (body instanceof Response) return body;
  return respond(await applyPoll(auth.user.sub, params.pageId, body, request));
}
