import type { Route } from "./+types/api.notifications.$id.read";
import { prisma } from "~/lib/db";
import { requireAuth, forbidden } from "~/lib/auth";
import { withCors, handlePreflight } from "~/lib/cors";
import { publishNotificationChange } from "~/lib/notify-stream.server";
import { ONBOARDING_LINK } from "~/members/lib/welcome.server";

export async function action({ request, params }: Route.ActionArgs) {
  const preflight = handlePreflight(request);
  if (preflight) return preflight;

  const auth = await requireAuth(request);
  if (!auth.ok) return withCors(request, auth.response);

  if (request.method !== "POST") {
    return withCors(request, Response.json({ error: "Method not allowed" }, { status: 405 }));
  }

  // `intent=unread` re-opens a cleared notification (History "Mark unread").
  // Read both form-encoded and JSON bodies so the History page can post either.
  let intent: string | null = null;
  const contentType = request.headers.get("content-type") ?? "";
  if (contentType.includes("application/json")) {
    try {
      const json = (await request.clone().json()) as { intent?: unknown };
      if (typeof json.intent === "string") intent = json.intent;
    } catch {
      // ignore — treat as a plain read
    }
  } else {
    try {
      const form = await request.clone().formData();
      const v = form.get("intent");
      if (typeof v === "string") intent = v;
    } catch {
      // ignore — treat as a plain read
    }
  }

  const id = params.id!;
  const existing = await prisma.notification.findUnique({
    where: { id },
    select: {
      recipientUserId: true,
      readAt: true,
      scheduledMeetingId: true,
      kind: true,
      link: true,
    },
  });
  if (!existing) {
    return withCors(request, Response.json({ error: "Not found" }, { status: 404 }));
  }
  if (existing.recipientUserId !== auth.user.sub) {
    return forbidden(request);
  }

  // Meeting invites (only) clear via RSVP, not mark-read. Meeting reminders
  // also carry scheduledMeetingId but are dismissible like any other ping.
  const isMeetingInvite =
    existing.kind === "MeetingInvite" && !!existing.scheduledMeetingId;

  // Re-open path: flip readAt back to null so the row returns to Open in
  // History + the Tasks list. Self-clearing rows (meeting invites / onboarding)
  // own their own read state, so re-opening them is a no-op echo — mirrors the
  // skips below for the read path.
  if (intent === "unread") {
    if (isMeetingInvite) {
      return withCors(request, Response.json({ ok: true, skipped: "meeting-invite" }));
    }
    if (existing.kind === "SystemAnnouncement" && existing.link === ONBOARDING_LINK) {
      return withCors(request, Response.json({ ok: true, skipped: "onboarding" }));
    }
    if (!existing.readAt) {
      return withCors(request, Response.json({ ok: true }));
    }
    await prisma.notification.update({
      where: { id },
      data: { readAt: null },
    });
    publishNotificationChange([auth.user.sub]);
    return withCors(request, Response.json({ ok: true }));
  }

  // A meeting invite only clears once the recipient RSVPs (via the rsvp
  // endpoint, which sets readAt itself). A plain read — opening its link —
  // must not dismiss it, so it stays a todo until an Accept/Maybe/Decline.
  if (isMeetingInvite) {
    return withCors(request, Response.json({ ok: true, skipped: "meeting-invite" }));
  }

  // The onboarding task is the same: opening /onboarding must not dismiss it.
  // It clears only when onboarding is actually finished (clearOnboardingTask,
  // from the /onboarding "Finish" action), so it persists across visits.
  if (existing.kind === "SystemAnnouncement" && existing.link === ONBOARDING_LINK) {
    return withCors(request, Response.json({ ok: true, skipped: "onboarding" }));
  }

  if (existing.readAt) {
    return withCors(request, Response.json({ ok: true }));
  }
  await prisma.notification.update({
    where: { id },
    data: { readAt: new Date() },
  });
  // Converge the desktop badge without waiting for its sync backstop.
  publishNotificationChange([auth.user.sub]);
  return withCors(request, Response.json({ ok: true }));
}
