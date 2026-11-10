import type { Route } from "./+types/api.slides.$pageId.polls.stream";
import { requireAuth } from "~/lib/auth";
import { busEventStream } from "~/lib/sse.server";
import { deckAccess } from "~/lib/slide-decks.server";
import { slidesLiveEnabled } from "~/lib/slide-live.server";
import { slidePollTopic } from "~/lib/slide-poll.server";

export async function loader({ request, params }: Route.LoaderArgs) {
  const auth = await requireAuth(request);
  if (!auth.ok) return new Response("Unauthorized", { status: 401 });
  if (!(await slidesLiveEnabled(auth.user.sub, request))) return new Response("Not found", { status: 404 });
  const access = await deckAccess(auth.user.sub, params.pageId, request);
  if (!access.ok) return new Response("Not found", { status: 404 });
  return busEventStream(request, [slidePollTopic(params.pageId)], { syncMs: 30_000 });
}
