import type { Route } from "./+types/api.room-display.schedule";
import { displayUnauthorized, requireRoomDisplay } from "~/lib/room-display.server";
import { resolvePhotoUrl } from "~/lib/photo";
import { currentEvent, getRoomSchedule, parseWindow, serializeScheduleItem } from "~/lib/rooms.server";

// GET /api/room-display/schedule?start=<iso>&end=<iso> — the paired room's
// schedule for the display's local day, plus the event it should be scanning
// for right now (if any). Polled by the door display.
export async function loader({ request }: Route.LoaderArgs) {
  const display = await requireRoomDisplay(request);
  if (!display) return displayUnauthorized();

  const window = parseWindow(new URL(request.url));
  if (!window) return Response.json({ error: "start and end are required" }, { status: 400 });

  const items = await getRoomSchedule(display.room.id, window.start, window.end);
  const event = currentEvent(items);
  return Response.json({
    room: display.room,
    // The door shows the current booker's photo, so the display (unlike the
    // member-facing schedule) gets a resolved, short-lived photo URL.
    items: await Promise.all(
      items.map(async (i) => {
        const item = serializeScheduleItem(i);
        return { ...item, organizer: { ...item.organizer, photoUrl: await resolvePhotoUrl(i.organizer.photoUrl) } };
      }),
    ),
    currentEvent: event ? serializeScheduleItem(event) : null,
    serverTime: new Date().toISOString(),
  });
}
