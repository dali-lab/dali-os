import type { Route } from "./+types/api.rooms.$id.schedule";
import { prisma } from "~/lib/db";
import { withCors, handlePreflight } from "~/lib/cors";
import { requireRoomBookingUser } from "~/rooms/lib/access.server";
import { getRoomSchedule, parseWindow, serializeScheduleItem } from "~/lib/rooms.server";

// GET /api/rooms/:id/schedule?start=<iso>&end=<iso> — the room's bookings and
// meetings in the window (the caller's local day, computed client-side).
export async function loader({ request, params }: Route.LoaderArgs) {
  const preflight = handlePreflight(request);
  if (preflight) return preflight;
  const access = await requireRoomBookingUser(request);
  if (!access.ok) return access.response;

  const window = parseWindow(new URL(request.url));
  if (!window) {
    return withCors(request, Response.json({ error: "start and end are required" }, { status: 400 }));
  }
  const room = await prisma.room.findUnique({
    where: { id: params.id },
    select: { id: true, name: true, description: true, capacity: true, archivedAt: true },
  });
  if (!room || room.archivedAt) {
    return withCors(request, Response.json({ error: "Not found" }, { status: 404 }));
  }

  const items = await getRoomSchedule(room.id, window.start, window.end);
  return withCors(
    request,
    Response.json({
      room: { id: room.id, name: room.name, description: room.description, capacity: room.capacity },
      items: items.map(serializeScheduleItem),
    }),
  );
}
