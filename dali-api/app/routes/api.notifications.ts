import type { Route } from "./+types/api.notifications";
import { prisma } from "~/lib/db";
import { requireAuth } from "~/lib/auth";
import { withCors, handlePreflight } from "~/lib/cors";
import { listOpenTasks } from "~/lib/tasks";
import { listMyNotifications } from "~/lib/notifications";

export async function loader({ request }: Route.LoaderArgs) {
  const preflight = handlePreflight(request);
  if (preflight) return preflight;

  const auth = await requireAuth(request);
  if (!auth.ok) return withCors(request, auth.response);

  const userId = auth.user.sub;
  // dev (#…) refactored notification fetching into listMyNotifications();
  // keep that helper and layer the open-tasks payload on top so the bell
  // still shows tasks (Tasks-nav feature).
  const [{ items, unreadCount }, tasks] = await Promise.all([
    listMyNotifications(userId),
    listOpenTasks(userId),
  ]);

  return withCors(
    request,
    Response.json({ items, unreadCount, taskCount: tasks.length, tasks }),
  );
}

export async function action({ request }: Route.ActionArgs) {
  const preflight = handlePreflight(request);
  if (preflight) return preflight;

  const auth = await requireAuth(request);
  if (!auth.ok) return withCors(request, auth.response);

  if (request.method !== "POST") {
    return withCors(request, Response.json({ error: "Method not allowed" }, { status: 405 }));
  }

  // POST with no id = "mark all read". Meeting invites are excluded: they
  // clear only when the recipient RSVPs (Accept/Maybe/Decline), never on a
  // blanket read.
  await prisma.notification.updateMany({
    where: {
      recipientUserId: auth.user.sub,
      readAt: null,
      scheduledMeetingId: null,
    },
    data: { readAt: new Date() },
  });

  return withCors(request, Response.json({ ok: true }));
}
