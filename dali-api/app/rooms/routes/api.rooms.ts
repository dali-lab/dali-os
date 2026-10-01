import type { Route } from "./+types/api.rooms";
import { prisma } from "~/lib/db";
import { withCors, handlePreflight } from "~/lib/cors";
import { requireRoomBookingUser } from "~/rooms/lib/access.server";
import { getRoomSchedule, parseWindow } from "~/lib/rooms.server";

// GET /api/rooms — bookable (non-archived) rooms. With ?start&end, each room
// also carries `conflict`: the title of what already holds it in that window
// (null when free). `excludeMeetingId` leaves out the meeting being edited.
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
  const withConflicts = await Promise.all(
    rooms.map(async (room) => {
      const [first] = await getRoomSchedule(room.id, window.start, window.end, { excludeMeetingId });
      return { ...room, conflict: first?.title ?? null };
    }),
  );
  return withCors(request, Response.json({ rooms: withConflicts }));
}
