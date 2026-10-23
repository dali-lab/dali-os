import type { Route } from "./+types/api.room-display.schedule";
import { displayUnauthorized, requireRoomDisplay } from "~/lib/room-display.server";
import { resolvePhotoUrl } from "~/lib/photo";
import { currentEvent, getRoomSchedule, parseWindow, serializeScheduleItem } from "~/lib/rooms.server";
import { getActiveDisplayScan } from "~/lib/display-scan.server";
import { getDisplayCheckIns } from "~/lib/display-check-ins.server";
import { getBroadcastEvent } from "~/hiring/lib/hiring-events.server";

// The room event's check-in list scrolls; the lab-wide scan shows a few.
const ROOM_EVENT_CHECK_INS = 50;
const LAB_SCAN_RECENT = 4;

// GET /api/room-display/schedule?start=<iso>&end=<iso> — each of the paired
// rooms' schedule for the display's local day, plus the event it should be
// scanning for right now (if any). Polled by the door display. `attendanceScan`
// is the lab-wide scan switched on from a meeting's page; it outranks the
// rooms' own events. The top-level room/items/currentEvent are the display's
// own room, for iPad builds from before two-room displays.
export async function loader({ request }: Route.LoaderArgs) {
  const display = await requireRoomDisplay(request);
  if (!display) return displayUnauthorized();

  const window = parseWindow(new URL(request.url));
  if (!window) return Response.json({ error: "start and end are required" }, { status: 400 });

  const [rooms, scan, broadcast] = await Promise.all([
    Promise.all(
      display.rooms.map(async (room) => {
        const raw = await getRoomSchedule(room.id, window.start, window.end);
        const event = currentEvent(raw);
        const [items, checkIns] = await Promise.all([
          // The door shows the current booker's photo, so the display (unlike
          // the member-facing schedule) gets a resolved, short-lived photo URL.
          Promise.all(
            raw.map(async (i) => {
              const item = serializeScheduleItem(i);
              return { ...item, organizer: { ...item.organizer, photoUrl: await resolvePhotoUrl(i.organizer.photoUrl) } };
            }),
          ),
          event ? getDisplayCheckIns(event.id, event.occurrenceStart, ROOM_EVENT_CHECK_INS) : null,
        ]);
        return {
          room,
          items,
          currentEvent: event && { ...serializeScheduleItem(event), checkIns },
        };
      }),
    ),
    getActiveDisplayScan(),
    getBroadcastEvent(),
  ]);
  const origin = new URL(request.url).origin;
  const own = rooms[0]!;
  return Response.json({
    room: own.room,
    items: own.items,
    currentEvent: own.currentEvent,
    rooms,
    attendanceScan: scan && {
      meetingId: scan.meetingId,
      title: scan.title,
      start: scan.start,
      end: scan.end,
      checkIns: await getDisplayCheckIns(scan.meetingId, scan.occurrenceStart, LAB_SCAN_RECENT),
    },
    applicationEvent: broadcast && {
      id: broadcast.id,
      title: broadcast.title,
      kind: broadcast.kind,
      start: broadcast.startsAt,
      end: broadcast.endsAt,
      location: broadcast.location,
      checkInUrl: `${origin}/hiring/events/check-in/${broadcast.id}`,
    },
    serverTime: new Date().toISOString(),
  });
}
