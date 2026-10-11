import type { Route } from "./+types/api.rooms";
import { prisma } from "~/lib/db";
import { withCors, handlePreflight } from "~/lib/cors";
import { requireRoomBookingUser } from "~/rooms/lib/access.server";
import { getRoomSchedule, parseWindow } from "~/lib/rooms.server";
import { buildRule, expandOccurrences } from "~/lib/meeting-occurrences";
import { APPLICATION_TZ } from "~/lib/timezone";

const MAX_SERIES_OCCURRENCES = 200;
const SERIES_WINDOW_MS = 200 * 24 * 60 * 60_000;

// GET /api/rooms — bookable (non-archived) rooms. With ?start&end, each room
// also carries `conflict`: the title of what already holds it in that window
// (null when free). With a `recurrenceRule` alongside them, the check covers
// every occurrence of that series (capped at 200) instead of just the first;
// `conflictOn` then names the colliding occurrence's date, unless it's the
// first one (null, same as a plain single-slot check). `excludeMeetingId`
// leaves out the meeting being edited.
export async function loader({ request }: Route.LoaderArgs) {
  const preflight = handlePreflight(request);
  if (preflight) return preflight;
  const access = await requireRoomBookingUser(request);
  if (!access.ok) return access.response;

  const rooms = await prisma.room.findMany({
    where: { archivedAt: null },
    select: { id: true, name: true, description: true, capacity: true },
    orderBy: { name: "asc" },
  });
  const url = new URL(request.url);
  const window = parseWindow(url);
  if (!window) return withCors(request, Response.json({ rooms }));

  const excludeMeetingId = url.searchParams.get("excludeMeetingId") ?? undefined;
  const recurrenceRule = url.searchParams.get("recurrenceRule") || null;
  const rule = recurrenceRule ? buildRule(recurrenceRule, window.start) : null;

  if (!rule) {
    const withConflicts = await Promise.all(
      rooms.map(async (room) => {
        const [first] = await getRoomSchedule(room.id, window.start, window.end, { excludeMeetingId });
        return { ...room, conflict: first?.title ?? null, conflictOn: null as string | null };
      }),
    );
    return withCors(request, Response.json({ rooms: withConflicts }));
  }

  const durationMinutes = (window.end.getTime() - window.start.getTime()) / 60_000;
  const occurrences = expandOccurrences(
    { selectedAt: window.start, durationMinutes, recurrenceRule },
    [],
    window.start,
    new Date(window.start.getTime() + SERIES_WINDOW_MS),
  ).slice(0, MAX_SERIES_OCCURRENCES);

  const withConflicts = await Promise.all(
    rooms.map(async (room) => {
      if (occurrences.length === 0) return { ...room, conflict: null as string | null, conflictOn: null as string | null };
      const schedule = await getRoomSchedule(
        room.id,
        occurrences[0]!.start,
        occurrences[occurrences.length - 1]!.end,
        { excludeMeetingId },
      );
      for (const occ of occurrences) {
        const hit = schedule.find((s) => s.start < occ.end && s.end > occ.start);
        if (!hit) continue;
        const onFirst = occ.start.getTime() === occurrences[0]!.start.getTime();
        return {
          ...room,
          conflict: hit.title,
          conflictOn: onFirst
            ? null
            : occ.start.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: APPLICATION_TZ }),
        };
      }
      return { ...room, conflict: null as string | null, conflictOn: null as string | null };
    }),
  );
  return withCors(request, Response.json({ rooms: withConflicts }));
}
