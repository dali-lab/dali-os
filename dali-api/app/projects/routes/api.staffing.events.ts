import type { Route } from "./+types/api.staffing.events";
import { requireAuth, forbidden } from "~/lib/auth";
import { canViewStaffing } from "~/lib/roles";
import { subscribeToCycle } from "../lib/staffing-events.server";

// GET /api/staffing/events?cycleId=<id>
//
// Server-Sent Events stream for the staffing board. The client opens one per
// open board; whenever anyone mutates this cycle (assign / finalize /
// board-member), the server pushes a `change` event and the board revalidates.
//
// A periodic `sync` comment-event doubles as a keep-alive (so proxies don't
// drop the idle connection) and as the cross-instance backstop: prod runs
// multiple machines, so a client treats `sync` as "re-check the loader" to pick
// up edits published on another instance. See staffing-events.server.ts.

const SYNC_INTERVAL_MS = 25_000;

export async function loader({ request }: Route.LoaderArgs) {
  const auth = await requireAuth(request);
  // EventSource can't read a redirect body; signal auth failure with a status
  // the client's onerror handles by backing off.
  if (!auth.ok) return new Response("Unauthorized", { status: 401 });
  if (!(await canViewStaffing(auth.user.sub))) {
    return forbidden(request);
  }

  const cycleId = new URL(request.url).searchParams.get("cycleId");
  if (!cycleId) return new Response("cycleId required", { status: 400 });

  const encoder = new TextEncoder();
  let unsubscribe = () => {};
  let interval: ReturnType<typeof setInterval> | undefined;

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

      unsubscribe = subscribeToCycle(cycleId, () => send("change", "1"));
      interval = setInterval(() => send("sync", "1"), SYNC_INTERVAL_MS);

      // Abort fires when the client disconnects (tab close / navigation).
      request.signal.addEventListener("abort", () => {
        unsubscribe();
        if (interval) clearInterval(interval);
        try {
          controller.close();
        } catch {
          // already closed
        }
      });
    },
    cancel() {
      unsubscribe();
      if (interval) clearInterval(interval);
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
