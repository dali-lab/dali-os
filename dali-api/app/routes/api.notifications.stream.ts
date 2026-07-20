import type { Route } from "./+types/api.notifications.stream";
import { requireAuth } from "~/lib/auth";
import { subscribeToUserNotifications } from "~/lib/notify-stream.server";

// GET /api/notifications/stream
//
// Server-Sent Events stream for the caller's notification feed. The desktop
// app holds one open (Bearer session token) instead of polling: a `change`
// event fires the moment notify() writes this user a row on this machine, and
// the client responds to `change`/`sync` alike by re-fetching
// GET /api/notifications.
//
// A `sync` event every SYNC_INTERVAL_MS is the cross-instance backstop (prod
// runs multiple machines — see notify-stream.server.ts) and matches the old
// desktop polling cadence; the more frequent keep-alive comment stops proxies
// from dropping the idle connection without triggering client fetches.

const KEEPALIVE_INTERVAL_MS = 25_000;
const SYNC_INTERVAL_MS = 60_000;

export async function loader({ request }: Route.LoaderArgs) {
  const auth = await requireAuth(request);
  // EventSource-style clients can't read a redirect body; a bare 401 tells the
  // desktop shell to drop to its re-pair flow.
  if (!auth.ok) return new Response("Unauthorized", { status: 401 });

  const userId = auth.user.sub;
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

      // Initial comment flushes headers so the client marks the stream open.
      controller.enqueue(encoder.encode(": connected\n\n"));

      unsubscribe = subscribeToUserNotifications(userId, () => send("change", "1"));
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
