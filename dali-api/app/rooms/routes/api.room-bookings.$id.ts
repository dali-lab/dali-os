import type { Route } from "./+types/api.room-bookings.$id";
import { z } from "zod";
import { withCors, handlePreflight } from "~/lib/cors";
import { parseJson } from "~/lib/validate";
import { requireRoomBookingUser } from "~/rooms/lib/access.server";
import { updateRoomBookingAsMember } from "~/rooms/lib/rooms.server";

const BodySchema = z.object({
  start: z.coerce.date(),
  end: z.coerce.date(),
  roomId: z.string().min(1).optional(),
  title: z.string().trim().max(200).nullable().optional(),
  scope: z.enum(["this", "all"]).optional(),
  occurrenceStart: z.coerce.date().optional(),
});

// PATCH /api/room-bookings/:id — the booker or Core.
export async function action({ request, params }: Route.ActionArgs) {
  const preflight = handlePreflight(request);
  if (preflight) return preflight;
  if (request.method !== "PATCH") {
    return withCors(request, Response.json({ error: "Method not allowed" }, { status: 405 }));
  }
  const access = await requireRoomBookingUser(request);
  if (!access.ok) return access.response;

  const body = await parseJson(request, BodySchema);
  if (body instanceof Response) return withCors(request, body);

  const result = await updateRoomBookingAsMember(params.id, access.user.sub, body);
  if (!result.ok) {
    return withCors(request, Response.json({ error: result.error }, { status: result.status }));
  }
  return withCors(request, Response.json({ booking: result.value }));
}
