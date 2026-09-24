import type { Route } from "./+types/api.room-display.book";
import { z } from "zod";
import { parseJson } from "~/lib/validate";
import { walletTokensConfigured } from "~/lib/wallet-token";
import { resolveScannedMember } from "~/lib/wallet-scan.server";
import { displayUnauthorized, requireRoomDisplay } from "~/lib/room-display.server";
import { createRoomBooking } from "~/lib/rooms.server";

const BodySchema = z.object({
  memberToken: z.string().min(1),
  minutes: z.number().int().min(5).max(240),
});

// POST /api/room-display/book — walk-up "Book now" at the door. The booker is
// whoever's wallet pass was scanned; the display itself has no one to book as.
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

  const member = await resolveScannedMember(body.memberToken, `room-display-book(display=${display.id})`);
  if (!member) return Response.json({ error: "Invalid or revoked pass" }, { status: 400 });

  const start = new Date();
  const result = await createRoomBooking({
    roomId: display.room.id,
    userId: member.id,
    start,
    end: new Date(start.getTime() + body.minutes * 60_000),
    source: "Display",
  });
  if (!result.ok) return Response.json({ error: result.error }, { status: result.status });
  return Response.json({ booking: result.value, member }, { status: 201 });
}
