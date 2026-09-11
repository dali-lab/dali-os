// SSE stream for one activity's surface (specs/activities.md §7.6). Pushes a
// `change` event whenever anyone submits a code or reveals a hint, so every open
// surface modal refetches and the leaderboard stays live for all viewers — not
// just the person who acted. Mirrors api.notifications.stream.ts: an initial
// comment to flush headers, a keepalive comment, and a periodic `sync` event as
// the cross-machine backstop. Gated on the flag + assignment, like the data
// endpoint it complements.

import type { Route } from "./+types/api.activities.$id.stream";
import { requireAuth } from "~/lib/auth";
import { getUserRoles } from "~/lib/roles";
import { isFeatureEnabled } from "~/lib/feature-flags.server";
import { ACTIVITIES_FLAG } from "~/lib/activities";
import { getActivityForMember } from "~/lib/activities.server";
import { subscribeToActivity } from "~/lib/activity-events.server";

const KEEPALIVE_INTERVAL_MS = 25_000;
const SYNC_INTERVAL_MS = 30_000;

export async function loader({ request, params }: Route.LoaderArgs) {
  const auth = await requireAuth(request);
  if (!auth.ok) return new Response("Unauthorized", { status: 401 });
  const userId = auth.user.sub;
  const roles = await getUserRoles(userId);
  if (!(await isFeatureEnabled(ACTIVITIES_FLAG, userId, roles, request))) {
    return new Response("Not found", { status: 404 });
  }
  const found = await getActivityForMember(params.id, userId, roles);
  if (!found || !found.assigned) return new Response("Not found", { status: 404 });

  const activityId = params.id;
  const encoder = new TextEncoder();
  let unsubscribe = () => {};
  let keepalive: ReturnType<typeof setInterval> | null = null;
  let sync: ReturnType<typeof setInterval> | null = null;

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

      unsubscribe = subscribeToActivity(activityId, () => send("change", "1"));
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
