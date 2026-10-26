import type { Route } from "./+types/api.notifications.stream";
import { requireAuth } from "~/lib/auth";
import { notificationTopic } from "~/lib/notify-stream.server";
import { busEventStream } from "~/lib/sse.server";

// GET /api/notifications/stream
//
// The caller's notification feed as SSE. The web bell and the desktop app
// (Bearer session token) hold one open and re-fetch GET /api/notifications on
// `change` or `sync`.

export async function loader({ request }: Route.LoaderArgs) {
  const auth = await requireAuth(request);
  // EventSource-style clients can't read a redirect body; a bare 401 tells the
  // desktop shell to drop to its re-pair flow.
  if (!auth.ok) return new Response("Unauthorized", { status: 401 });
  // Open tasks, project tasks, and stale meeting pings in the feed change
  // without a publish, so this keeps the old one-minute re-sync.
  return busEventStream(request, [notificationTopic(auth.user.sub)], { syncMs: 60_000 });
}
