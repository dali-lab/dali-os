import type { Route } from "./+types/api.comments.$pageId.stream";
import { requireAuth } from "~/lib/auth";
import { getPageAccess } from "~/lib/pageAccess.server";
import { subscribeToPageComments } from "~/lib/comment-events.server";

// GET /api/comments/:pageId/stream
//
// Server-Sent Events stream for comment changes on a single document page.
// When the comments action (create / edit / resolve / delete) writes a row
// for this pageId it calls publishCommentChange(pageId); every open stream
// for that page receives a `change` event and the DaliThreadStore refetches.
//
// A periodic `sync` comment-event keeps proxies from dropping idle connections
// and acts as the cross-instance backstop (prod runs multiple machines; see
// comment-events.server.ts). Auth: caller must have canComment access on the
// page (same gate as GET /api/comments).

const SYNC_INTERVAL_MS = 30_000;
const KEEPALIVE_INTERVAL_MS = 25_000;

export async function loader({ request, params }: Route.LoaderArgs) {
  const auth = await requireAuth(request);
  if (!auth.ok) return new Response("Unauthorized", { status: 401 });

  const pageId = params.pageId;
  if (!pageId) return new Response("pageId required", { status: 400 });

  const access = await getPageAccess(auth.user.sub, pageId);
  if (!access.canComment) return new Response("Forbidden", { status: 403 });

  const encoder = new TextEncoder();
  let unsubscribe = () => {};
  let keepalive: ReturnType<typeof setInterval> | undefined;
  let sync: ReturnType<typeof setInterval> | undefined;

  const stream = new ReadableStream({
    start(controller) {
      const send = (event: string, data: string) => {
        try {
          controller.enqueue(encoder.encode(`event: ${event}\ndata: ${data}\n\n`));
        } catch {
          // Controller closed (client gone) — teardown happens in cancel().
        }
      };

      // Initial comment flushes headers so the browser marks the stream open.
      controller.enqueue(encoder.encode(": connected\n\n"));

      unsubscribe = subscribeToPageComments(pageId, () => send("change", "1"));
      keepalive = setInterval(() => {
        try {
          controller.enqueue(encoder.encode(": keepalive\n\n"));
        } catch {
          // closed
        }
      }, KEEPALIVE_INTERVAL_MS);
      sync = setInterval(() => send("sync", "1"), SYNC_INTERVAL_MS);

      request.signal.addEventListener("abort", () => {
        unsubscribe();
        if (keepalive) clearInterval(keepalive);
        if (sync) clearInterval(sync);
        try {
          controller.close();
        } catch {
          // already closed
        }
      });
    },
    cancel() {
      unsubscribe();
      if (keepalive) clearInterval(keepalive);
      if (sync) clearInterval(sync);
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    },
  });
}
