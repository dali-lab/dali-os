import type { Route } from "./+types/api.room-display.scan";
import { z } from "zod";
import { parseJson } from "~/lib/validate";
import { walletTokensConfigured } from "~/lib/wallet-token";
import { resolveScannedMember } from "~/lib/wallet-scan.server";
import { markMeetingAttendance } from "~/lib/scheduled-meeting";
import { displayUnauthorized, requireRoomDisplay } from "~/lib/room-display.server";
import { currentEvent, getRoomSchedule } from "~/lib/rooms.server";

const BodySchema = z.object({ memberToken: z.string().min(1) });

// POST /api/room-display/scan — check a member in to the event running in the
// display's room right now. The display never names the meeting: it can only
// mark attendance for the SelfCheckIn event currently in its own room's
// check-in window, which is exactly what the member could do themselves from
// the self-check-in QR. Any DALI member counts at an event (walk-ins welcome).
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

  const now = new Date();
  const event = currentEvent(
    await getRoomSchedule(
      display.room.id,
      new Date(now.getTime() - 24 * 60 * 60_000),
      new Date(now.getTime() + 24 * 60 * 60_000),
    ),
    now.getTime(),
  );
  if (!event) return Response.json({ error: "No event is checking in here right now" }, { status: 409 });

  const member = await resolveScannedMember(body.memberToken, `room-display-scan(display=${display.id})`);
  if (!member) return Response.json({ error: "Invalid or revoked pass" }, { status: 400 });

  // Marked by the member themselves, as with self check-in: the display is
  // just the member's proof of presence, not an operator.
  const result = await markMeetingAttendance(event.id, member.id, true, member.id, {
    addIfMissing: member.isDaliMember,
  });
  if (!result.ok) return Response.json({ error: result.error }, { status: result.status });

  return Response.json({ ok: true, member, event: { id: event.id, title: event.title } });
}
