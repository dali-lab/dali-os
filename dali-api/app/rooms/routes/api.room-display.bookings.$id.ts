import type { Route } from "./+types/api.room-display.bookings.$id";
import { z } from "zod";
import { prisma } from "~/lib/db.server";
import { isCore } from "~/lib/roles";
import { parseJson } from "~/lib/validate";
import { walletTokensConfigured } from "~/lib/wallet-token";
import { resolveScannedMember } from "~/lib/wallet-scan.server";
import { displayRoom, displayUnauthorized, requireRoomDisplay } from "~/lib/room-display.server";
import { cancelRoomBooking, extendRoomBooking, getRoomSchedule } from "~/lib/rooms.server";

const EXTEND_MINUTES = 15;

const BodySchema = z.object({
  memberToken: z.string().min(1),
  change: z.enum(["end", "extend"]),
});

// POST /api/room-display/bookings/:id — End early or Extend 15 min on the
// booking underway in one of the display's rooms. The scanned pass has to be
// the booker's (or Core's), so a passerby can't end someone else's booking.
// Meetings and hiring holds aren't changed from the door.
export async function action({ request, params }: Route.ActionArgs) {
  if (request.method !== "POST") {
    return Response.json({ error: "Method not allowed" }, { status: 405 });
  }
  const display = await requireRoomDisplay(request);
  if (!display) return displayUnauthorized();
  if (!walletTokensConfigured()) {
    return Response.json({ error: "Wallet passes aren't enabled" }, { status: 503 });
  }

  const body = await parseJson(request, BodySchema);
  if (body instanceof Response) return body;

  const booking = await prisma.roomBooking.findUnique({
    where: { id: params.id },
    select: { roomId: true, userId: true, source: true, cancelledAt: true },
  });
  if (!booking || booking.cancelledAt || !displayRoom(display, booking.roomId)) {
    return Response.json({ error: "Booking not found" }, { status: 404 });
  }
  if (booking.source === "Interview" || booking.source === "InterviewHold") {
    return Response.json({ error: "Interview holds can't be changed here" }, { status: 409 });
  }

  const member = await resolveScannedMember(body.memberToken, `room-display-booking(display=${display.id})`);
  if (!member) return Response.json({ error: "Invalid or revoked pass" }, { status: 400 });
  if (booking.userId !== member.id && !(await isCore(member.id))) {
    return Response.json({ error: "Only the person who booked the room can change it" }, { status: 403 });
  }

  const now = new Date();
  const underway = (await getRoomSchedule(booking.roomId, now, new Date(now.getTime() + 1))).find(
    (i) => i.kind === "booking" && i.id === params.id && i.start <= now && i.end > now,
  );
  if (!underway) return Response.json({ error: "This booking isn't underway" }, { status: 409 });

  if (body.change === "end") {
    const result = await cancelRoomBooking(params.id, member.id, {
      scope: "this",
      occurrenceStart: underway.occurrenceStart,
    });
    if (!result.ok) return Response.json({ error: result.error }, { status: result.status });
    return Response.json({ ok: true, member, booking: { start: underway.start, end: now } });
  }

  const result = await extendRoomBooking(params.id, underway.occurrenceStart, EXTEND_MINUTES);
  if (!result.ok) return Response.json({ error: result.error }, { status: result.status });
  return Response.json({ ok: true, member, booking: result.value });
}
