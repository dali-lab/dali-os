import type { Route } from "./+types/api.notifications";
import { prisma } from "~/lib/db";
import { requireAuth } from "~/lib/auth";
import { withCors, handlePreflight } from "~/lib/cors";

export async function loader({ request }: Route.LoaderArgs) {
  const preflight = handlePreflight(request);
  if (preflight) return preflight;

  const auth = await requireAuth(request);
  if (!auth.ok) return withCors(request, auth.response);

  const userId = auth.user.sub;
  const [items, unreadCount] = await Promise.all([
    prisma.notification.findMany({
      where: { recipientUserId: userId },
      orderBy: { createdAt: "desc" },
      take: 50,
    }),
    prisma.notification.count({
      where: { recipientUserId: userId, readAt: null },
    }),
  ]);

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
