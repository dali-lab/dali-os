import type { Route } from "./+types/api.notifications";
import { prisma } from "~/lib/db";
import { requireAuth } from "~/lib/auth";
import { withCors, handlePreflight } from "~/lib/cors";
import { listMyNotifications } from "~/lib/notifications";

export async function loader({ request }: Route.LoaderArgs) {
  const preflight = handlePreflight(request);
  if (preflight) return preflight;

  const auth = await requireAuth(request);
  if (!auth.ok) return withCors(request, auth.response);

  const { items, unreadCount } = await listMyNotifications(auth.user.sub);
  return withCors(request, Response.json({ items, unreadCount }));
}

export async function action({ request }: Route.ActionArgs) {
  const preflight = handlePreflight(request);
  if (preflight) return preflight;

  const auth = await requireAuth(request);
  if (!auth.ok) return withCors(request, auth.response);

  if (request.method !== "POST") {
    return withCors(request, Response.json({ error: "Method not allowed" }, { status: 405 }));
  }

  // POST with no id = "mark all read"
  await prisma.notification.updateMany({
    where: { recipientUserId: auth.user.sub, readAt: null },
    data: { readAt: new Date() },
  });

  return withCors(request, Response.json({ ok: true }));
}
