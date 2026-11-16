import type { Route } from "./+types/api.rooms";
import { withCors, handlePreflight } from "~/lib/cors";
import { requireRoomBookingUser } from "~/rooms/lib/access.server";
import { listBookableRooms, listRoomAvailability, parseWindow } from "~/rooms/lib/rooms.server";

// GET /api/rooms — bookable rooms. With ?start&end (and optionally
// recurrenceRule, excludeMeetingId), each carries its conflict in that window.
export async function loader({ request }: Route.LoaderArgs) {
  const preflight = handlePreflight(request);
  if (preflight) return preflight;
  const access = await requireRoomBookingUser(request);
  if (!access.ok) return access.response;

  const url = new URL(request.url);
  const window = parseWindow(url);
  if (!window) return withCors(request, Response.json({ rooms: await listBookableRooms() }));

  const rooms = await listRoomAvailability(window, {
    recurrenceRule: url.searchParams.get("recurrenceRule") || null,
    excludeMeetingId: url.searchParams.get("excludeMeetingId") ?? undefined,
  });
  return withCors(request, Response.json({ rooms }));
}
