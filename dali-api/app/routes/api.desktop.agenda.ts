// GET /api/desktop/agenda — the member's next meeting, for the desktop tray
// panel's "Up next" card. Same auth/CORS shape as api.notifications.ts.

import type { Route } from "./+types/api.desktop.agenda";
import { prisma } from "~/lib/db.server";
import { requireAuth } from "~/lib/auth";
import { withCors, handlePreflight } from "~/lib/cors";
import { listUpcomingMeetings } from "~/lib/upcoming-meetings";
import { noteForOccurrence } from "~/lib/meeting-occurrences";

const WINDOW_MS = 12 * 60 * 60 * 1000;

export async function loader({ request }: Route.LoaderArgs) {
  const preflight = handlePreflight(request);
  if (preflight) return preflight;

  const auth = await requireAuth(request);
  if (!auth.ok) return withCors(request, auth.response);

  const now = new Date();
  const rows = await listUpcomingMeetings(
    auth.user.sub,
    now,
    new Date(now.getTime() + WINDOW_MS),
  );
  // In-progress occurrences count as "next" too — only their end matters.
  const next = rows.find((r) => new Date(r.endsAt) > now) ?? null;

  if (!next) {
    return withCors(
      request,
      Response.json({ next: null }, { headers: { "Cache-Control": "no-store" } }),
    );
  }

  let notePageId: string | null = null;
  if (next.source === "dali" && next.scheduledMeetingId) {
    const meeting = await prisma.scheduledMeeting.findUnique({
      where: { id: next.scheduledMeetingId },
      select: { notePages: { select: { id: true, meetingOccurrenceStart: true } } },
    });
    notePageId = meeting
      ? noteForOccurrence(meeting.notePages, new Date(next.occurrenceStart))?.id ?? null
      : null;
  }

  const link =
    next.source === "dali"
      ? `/calendar?meeting=${next.scheduledMeetingId}`
      : `/hiring/interviews/${next.id}`;

  return withCors(
    request,
    Response.json(
      {
        next: {
          id: next.id,
          source: next.source,
          title: next.title,
          startsAt: next.startsAt,
          endsAt: next.endsAt,
          joinUrl: next.meetingUrl ?? null,
          link,
          notePageId,
          canRecord: next.source === "dali",
        },
      },
      { headers: { "Cache-Control": "no-store" } },
    ),
  );
}
