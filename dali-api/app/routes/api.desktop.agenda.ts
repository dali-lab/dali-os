// GET /api/desktop/agenda — the member's next meeting plus what follows it, for
// the desktop tray panel. Same auth/CORS shape as api.notifications.ts.

import type { Route } from "./+types/api.desktop.agenda";
import { prisma } from "~/lib/db.server";
import { requireAuth } from "~/lib/auth";
import { withCors, handlePreflight } from "~/lib/cors";
import { listUpcomingMeetings, type UpcomingMeeting } from "~/lib/upcoming-meetings";
import { noteForOccurrence } from "~/lib/meeting-occurrences";

const NEXT_WINDOW_MS = 12 * 60 * 60 * 1000;
// Wider than `next` so a member with nothing left today still sees what's first
// tomorrow, including across a quiet day.
const UPCOMING_WINDOW_MS = 48 * 60 * 60 * 1000;
const UPCOMING_MAX = 3;

function meetingLink(row: UpcomingMeeting): string {
  return row.source === "dali"
    ? `/calendar?meeting=${row.scheduledMeetingId}`
    : `/hiring/interviews/${row.id}`;
}

export async function loader({ request }: Route.LoaderArgs) {
  const preflight = handlePreflight(request);
  if (preflight) return preflight;

  const auth = await requireAuth(request);
  if (!auth.ok) return withCors(request, auth.response);

  const now = new Date();
  const rows = await listUpcomingMeetings(
    auth.user.sub,
    now,
    new Date(now.getTime() + UPCOMING_WINDOW_MS),
  );
  // In-progress occurrences count as "next" too — only their end matters.
  const live = rows.filter((r) => new Date(r.endsAt) > now);
  const next =
    live.find((r) => new Date(r.startsAt).getTime() < now.getTime() + NEXT_WINDOW_MS) ?? null;

  const upcoming = live
    .filter((r) => r !== next)
    .slice(0, UPCOMING_MAX)
    .map((r) => ({ id: r.id, title: r.title, startsAt: r.startsAt, link: meetingLink(r) }));

  if (!next) {
    return withCors(
      request,
      Response.json({ next: null, upcoming }, { headers: { "Cache-Control": "no-store" } }),
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
          link: meetingLink(next),
          notePageId,
          canRecord: next.source === "dali",
        },
        upcoming,
      },
      { headers: { "Cache-Control": "no-store" } },
    ),
  );
}
