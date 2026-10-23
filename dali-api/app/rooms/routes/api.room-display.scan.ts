import type { Route } from "./+types/api.room-display.scan";
import { z } from "zod";
import { parseJson } from "~/lib/validate";
import { walletTokensConfigured } from "~/lib/wallet-token";
import { resolveScannedMember } from "~/lib/wallet-scan.server";
import { markMeetingAttendance } from "~/lib/scheduled-meeting";
import { displayRoom, displayUnauthorized, requireRoomDisplay } from "~/lib/room-display.server";
import { currentEvent, getRoomSchedule } from "~/lib/rooms.server";
import { getActiveDisplayScan } from "~/lib/display-scan.server";
import { isCheckedIn } from "~/lib/display-check-ins.server";

// `roomId` picks which of a two-room display's rooms the event is in.
const BodySchema = z.object({ memberToken: z.string().min(1), roomId: z.string().min(1).optional() });

// POST /api/room-display/scan — check a member in to the event running in the
// display's room (or its second room) right now. The display never names the
// meeting: it can only mark attendance for the SelfCheckIn event currently in
// one of its rooms' check-in window, which is exactly what the member could do themselves from
// the self-check-in QR. Any DALI member counts at an event (walk-ins welcome).
// A lab-wide scan switched on from a meeting's page outranks the room's own event.
export async function action({ request }: Route.ActionArgs) {
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
  const room = displayRoom(display, body.roomId);
  if (!room) return Response.json({ error: "This display doesn't show that room" }, { status: 404 });

  const now = new Date();
  const scan = await getActiveDisplayScan(now);
  const roomEvent = scan
    ? null
    : currentEvent(
        await getRoomSchedule(
          room.id,
          new Date(now.getTime() - 24 * 60 * 60_000),
          new Date(now.getTime() + 24 * 60 * 60_000),
        ),
        now.getTime(),
      );
  const event = scan
    ? { id: scan.meetingId, title: scan.title, occurrence: scan.occurrenceStart, isEvent: scan.isEvent }
    : roomEvent && {
        id: roomEvent.id,
        title: roomEvent.title,
        occurrence: roomEvent.occurrenceStart,
        isEvent: true,
      };
  if (!event) return Response.json({ error: "No event is checking in here right now" }, { status: 409 });

  const member = await resolveScannedMember(body.memberToken, `room-display-scan(display=${display.id})`);
  if (!member) return Response.json({ error: "Invalid or revoked pass" }, { status: 400 });

  const alreadyCheckedIn = await isCheckedIn(event.id, event.occurrence, member.id);
  // Marked by the member themselves, as with self check-in: the display is
  // just the member's proof of presence, not an operator.
  const result = await markMeetingAttendance(event.id, member.id, true, member.id, event.occurrence, {
    addIfMissing: event.isEvent && member.isDaliMember,
  });
  if (!result.ok) return Response.json({ error: result.error }, { status: result.status });

  return Response.json({ ok: true, member, alreadyCheckedIn, event: { id: event.id, title: event.title } });
}
