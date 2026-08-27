import type { Route } from "./+types/api.calendar.search";
import { requireAuth } from "~/lib/auth";
import { prisma } from "~/lib/db";
import { searchCalendarEvents } from "~/lib/google-calendar";
import { searchWindow, sortHits, type CalendarSearchHit } from "../lib/search";

// Over-fetch per local source; the union is sorted (upcoming-first) client-side.
const LOCAL_TAKE = 20;
const MIN_QUERY_LENGTH = 2;

// GET /api/calendar/search?q=&scope=near|all&rangeStart=&rangeEnd=
//
// Local events (in-app blocks + meetings the viewer was invited to) are queried
// across all time from Postgres — cheap, we own the data. Google events are
// searched server-side via the `q` param, bounded by scope: "near" pads the
// current view ±2 weeks, "all" opens a wide window (the escape hatch). Google
// errors are swallowed so local results still return.
export async function loader({ request }: Route.LoaderArgs) {
  const auth = await requireAuth(request);
  if (!auth.ok) return auth.response;
  const userId = auth.user.sub;

  const url = new URL(request.url);
  const q = (url.searchParams.get("q") ?? "").trim();
  const scope = url.searchParams.get("scope") === "all" ? "all" : "near";
  const nowIso = new Date().toISOString();
  const rangeStartIso = url.searchParams.get("rangeStart") ?? nowIso;
  const rangeEndIso = url.searchParams.get("rangeEnd") ?? nowIso;

  if (q.length < MIN_QUERY_LENGTH) {
    return Response.json({ local: [], google: [], googleError: null, scope });
  }

  const like = { contains: q, mode: "insensitive" as const };

  const [blocks, meetingRows] = await Promise.all([
    prisma.manualBlock.findMany({
      where: { userId, OR: [{ title: like }, { workNote: like }] },
      orderBy: { startTime: "desc" },
      take: LOCAL_TAKE,
      select: {
        id: true,
        title: true,
        startTime: true,
        endTime: true,
        allDay: true,
        recurrenceRule: true,
      },
    }),
    // Mirror the loader's meeting source: meetings surface via the viewer's
    // MeetingInvite notification, so search the same set for consistency.
    prisma.notification.findMany({
      where: {
        recipientUserId: userId,
        kind: "MeetingInvite",
        scheduledMeeting: {
          status: { not: "Cancelled" },
          selectedAt: { not: null },
          title: like,
        },
      },
      orderBy: { createdAt: "desc" },
      take: LOCAL_TAKE,
      select: {
        scheduledMeeting: {
          select: { id: true, title: true, selectedAt: true, durationMinutes: true },
        },
      },
    }),
  ]);

  const blockHits: CalendarSearchHit[] = blocks.map((b) => ({
    id: `block:${b.id}`,
    source: "block",
    title: b.title,
    startIso: b.startTime.toISOString(),
    endIso: b.endTime.toISOString(),
    allDay: b.allDay,
    location: null,
    recurring: b.recurrenceRule != null,
  }));

  // A user can hold more than one MeetingInvite row per meeting — dedupe by id.
  const seenMeeting = new Set<string>();
  const meetingHits: CalendarSearchHit[] = [];
  for (const row of meetingRows) {
    const m = row.scheduledMeeting;
    if (!m?.selectedAt || seenMeeting.has(m.id)) continue;
    seenMeeting.add(m.id);
    const start = m.selectedAt;
    const end = new Date(start.getTime() + m.durationMinutes * 60_000);
    meetingHits.push({
      id: `meeting:${m.id}`,
      source: "meeting",
      title: m.title,
      startIso: start.toISOString(),
      endIso: end.toISOString(),
      allDay: false,
      location: null,
      recurring: false,
    });
  }

  const local = sortHits([...meetingHits, ...blockHits], nowIso);

  let google: CalendarSearchHit[] = [];
  let googleError: string | null = null;
  try {
    const { start, end } = searchWindow(scope, rangeStartIso, rangeEndIso, nowIso);
    const events = await searchCalendarEvents(userId, q, start, end);
    google = sortHits(
      events.map((e) => ({
        id: `google:${e.calendarId}:${e.eventId}:${e.startIso}`,
        source: "google" as const,
        title: e.title,
        startIso: e.startIso,
        endIso: e.endIso,
        allDay: e.allDay,
        location: e.location ?? null,
        recurring: e.recurringEventId != null,
      })),
      nowIso,
    );
  } catch (err) {
    googleError = err instanceof Error ? err.message : "Google search failed";
  }

  return Response.json({ local, google, googleError, scope });
}
