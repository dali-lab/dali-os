import type { Route } from "./+types/api.rooms";
import { prisma } from "~/lib/db";
import { withCors, handlePreflight } from "~/lib/cors";
import { requireRoomBookingUser } from "~/rooms/lib/access.server";

// GET /api/rooms — bookable (non-archived) rooms.
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
  return withCors(request, Response.json({ rooms }));
}
