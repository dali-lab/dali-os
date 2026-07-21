import type { Route } from "./+types/api.notifications";
import { prisma } from "~/lib/db";
import { requireAuth } from "~/lib/auth";
import { withCors, handlePreflight } from "~/lib/cors";
import { listOpenTasks, listNotificationHistory } from "~/lib/tasks";
import { listMyNotifications, annotateDesktopFeed } from "~/lib/notifications";
import { publishNotificationChange } from "~/lib/notify-stream.server";
import { ONBOARDING_LINK } from "~/members/lib/welcome.server";

// Query params that switch the loader into history mode. Their presence (not
// their value) flips the payload, so the legacy poller — which sends none — is
// untouched.
const HISTORY_PARAMS = ["status", "kind", "q", "cursor", "limit"] as const;

export async function loader({ request }: Route.LoaderArgs) {
  const preflight = handlePreflight(request);
  if (preflight) return preflight;

  const auth = await requireAuth(request);
  if (!auth.ok) return withCors(request, auth.response);

  const userId = auth.user.sub;

  // History mode: any history param present → return the browsable history
  // payload { items, nextCursor, counts }. Additive and back-compatible.
  const url = new URL(request.url);
  const isHistory = HISTORY_PARAMS.some((p) => url.searchParams.has(p));
  if (isHistory) {
    const statusRaw = url.searchParams.get("status");
    const status =
      statusRaw === "open" || statusRaw === "cleared" || statusRaw === "all"
        ? statusRaw
        : "all";
    const cursorRaw = url.searchParams.get("cursor");
    let cursor: { createdAt: string; id: string } | null = null;
    if (cursorRaw) {
      try {
        const parsed = JSON.parse(cursorRaw);
        if (
          parsed &&
          typeof parsed.createdAt === "string" &&
          typeof parsed.id === "string"
        ) {
          cursor = { createdAt: parsed.createdAt, id: parsed.id };
        }
      } catch {
        // Malformed cursor → treat as first page.
      }
    }
    const limitRaw = Number(url.searchParams.get("limit"));
    const result = await listNotificationHistory(userId, {
      status,
      kind: url.searchParams.get("kind") ?? undefined,
      q: url.searchParams.get("q") ?? undefined,
      limit: Number.isFinite(limitRaw) && limitRaw > 0 ? limitRaw : undefined,
      cursor,
    });
    return withCors(request, Response.json(result));
  }

  // Legacy payload: the bell poller reads taskCount/tasks.
  // dev (#…) refactored notification fetching into listMyNotifications();
  // keep that helper and layer the open-tasks payload on top so the bell
  // still shows tasks (Tasks-nav feature). Items additionally carry the
  // desktop-app annotations (`desktop`, `urgent`); web clients ignore them.
  const [{ items, unreadCount }, tasks, desktopPrefs] = await Promise.all([
    listMyNotifications(userId),
    listOpenTasks(userId),
    prisma.notificationPreference.findMany({
      where: { userId },
      select: { eventType: true, desktop: true },
    }),
  ]);

  return withCors(
    request,
    Response.json({
      items: annotateDesktopFeed(items, desktopPrefs),
      unreadCount,
      taskCount: tasks.length,
      tasks,
    }),
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

  // POST with no id = "mark all read". Excluded: meeting invites (clear only on
  // RSVP) and the onboarding task (clears only when onboarding is finished), so
  // neither is dismissed by a blanket read. Meeting reminders share
  // scheduledMeetingId with invites but are dismissible — leave them in.
  await prisma.notification.updateMany({
    where: {
      recipientUserId: auth.user.sub,
      readAt: null,
      NOT: [
        { kind: "MeetingInvite", scheduledMeetingId: { not: null } },
        { kind: "SystemAnnouncement", link: ONBOARDING_LINK },
      ],
    },
    data: { readAt: new Date() },
  });
  // Converge the desktop badge without waiting for its sync backstop.
  publishNotificationChange([auth.user.sub]);

  return withCors(request, Response.json({ ok: true }));
}
