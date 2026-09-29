import type { Route } from "./+types/api.room-bookings.$id.cancel";
import { prisma } from "~/lib/db";
import { forbidden } from "~/lib/auth";
import { isCore } from "~/lib/roles";
import { withCors, handlePreflight } from "~/lib/cors";
import { requireRoomBookingUser } from "~/rooms/lib/access.server";
import { cancelRoomBooking } from "~/lib/rooms.server";

// POST /api/room-bookings/:id/cancel — the booker or Core. A booking already
// underway ends now instead, freeing the rest of the slot.
export async function action({ request, params }: Route.ActionArgs) {
  const preflight = handlePreflight(request);
  if (preflight) return preflight;
  if (request.method !== "POST") {
    return withCors(request, Response.json({ error: "Method not allowed" }, { status: 405 }));
  }
  const access = await requireRoomBookingUser(request);
  if (!access.ok) return access.response;

  const booking = await prisma.roomBooking.findUnique({
    where: { id: params.id },
    select: { userId: true },
  });
  if (!booking) return withCors(request, Response.json({ error: "Not found" }, { status: 404 }));
  if (booking.userId !== access.user.sub && !(await isCore(access.user.sub))) {
    return forbidden(request);
  }

  await cancelRoomBooking(params.id, access.user.sub);
  return withCors(request, Response.json({ ok: true }));
}
