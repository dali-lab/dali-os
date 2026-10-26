import type { Route } from "./+types/api.comments.$pageId.stream";
import { requireAuth } from "~/lib/auth";
import { getPageAccess } from "~/lib/pageAccess.server";
import { commentTopic } from "~/lib/comment-events.server";
import { busEventStream } from "~/lib/sse.server";

// GET /api/comments/:pageId/stream
//
// Comment changes on one document page as SSE; DaliThreadStore refetches on
// `change` or `sync`. Same gate as GET /api/comments.

export async function loader({ request, params }: Route.LoaderArgs) {
  const auth = await requireAuth(request);
  if (!auth.ok) return new Response("Unauthorized", { status: 401 });

  const pageId = params.pageId;
  if (!pageId) return new Response("pageId required", { status: 400 });

  const access = await getPageAccess(auth.user.sub, pageId);
  if (!access.canComment) return new Response("Forbidden", { status: 403 });

  return busEventStream(request, [commentTopic(pageId)]);
}
