import type { Route } from "./+types/api.room-bookings.$id.cancel";
import { z } from "zod";
import { prisma } from "~/lib/db";
import { forbidden } from "~/lib/auth";
import { isCore } from "~/lib/roles";
import { withCors, handlePreflight } from "~/lib/cors";
import { parseJson } from "~/lib/validate";
import { requireRoomBookingUser } from "~/rooms/lib/access.server";
import { cancelRoomBooking } from "~/lib/rooms.server";

const BodySchema = z.object({
  scope: z.enum(["this", "following", "all"]).optional(),
  occurrenceStart: z.coerce.date().optional(),
});

// POST /api/room-bookings/:id/cancel — the booker or Core. A booking already
// underway ends now instead, freeing the rest of the slot. For a repeating
// booking, an optional JSON body scopes the cancel to "this" occurrence,
// "following" ones, or "all" (default).
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
    select: { userId: true, source: true },
  });
  if (!booking) return withCors(request, Response.json({ error: "Not found" }, { status: 404 }));
  if (booking.userId !== access.user.sub && !(await isCore(access.user.sub))) {
    return forbidden(request);
  }
  // Interview bookings follow the interview; holds follow the cycle's config.
  if (booking.source === "Interview" || booking.source === "InterviewHold") {
    return withCors(
      request,
      Response.json({ error: "This booking is managed by hiring. Change it from the cycle page." }, { status: 409 }),
    );
  }

  let scope: "this" | "following" | "all" | undefined;
  let occurrenceStart: Date | undefined;
  if ((request.headers.get("content-type") ?? "").includes("application/json")) {
    const body = await parseJson(request, BodySchema);
    if (body instanceof Response) return withCors(request, body);
    scope = body.scope;
    occurrenceStart = body.occurrenceStart;
  }

  const result = await cancelRoomBooking(params.id, access.user.sub, { scope, occurrenceStart });
  if (!result.ok) {
    return withCors(request, Response.json({ error: result.error }, { status: result.status }));
  }
  return withCors(request, Response.json({ ok: true }));
}
