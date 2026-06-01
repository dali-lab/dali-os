import type { Route } from "./+types/api.notifications.$id.read";
import { prisma } from "~/lib/db";
import { requireAuth } from "~/lib/auth";
import { withCors, handlePreflight } from "~/lib/cors";
import { ONBOARDING_LINK } from "~/members/lib/welcome.server";

export async function action({ request, params }: Route.ActionArgs) {
  const preflight = handlePreflight(request);
  if (preflight) return preflight;

  const auth = await requireAuth(request);
  if (!auth.ok) return withCors(request, auth.response);

  if (request.method !== "POST") {
    return withCors(request, Response.json({ error: "Method not allowed" }, { status: 405 }));
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
    return withCors(request, Response.json({ error: "Forbidden" }, { status: 403 }));
  }

  // A meeting invite only clears once the recipient RSVPs (via the rsvp
  // endpoint, which sets readAt itself). A plain read — opening its link —
  // must not dismiss it, so it stays a todo until an Accept/Maybe/Decline.
  if (existing.scheduledMeetingId) {
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
  return withCors(request, Response.json({ ok: true }));
}
