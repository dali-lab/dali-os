import type { Route } from "./+types/api.rooms.$id.bookings";
import { z } from "zod";
import { withCors, handlePreflight } from "~/lib/cors";
import { parseJson } from "~/lib/validate";
import { requireRoomBookingUser } from "~/rooms/lib/access.server";
import { createRoomBooking } from "~/lib/rooms.server";

const BodySchema = z.object({
  start: z.coerce.date(),
  end: z.coerce.date(),
  title: z.string().trim().max(200).optional(),
  source: z.enum(["Web", "App"]).default("Web"),
});

// POST /api/rooms/:id/bookings — book the room for yourself.
export async function action({ request, params }: Route.ActionArgs) {
  const preflight = handlePreflight(request);
  if (preflight) return preflight;
  if (request.method !== "POST") {
    return withCors(request, Response.json({ error: "Method not allowed" }, { status: 405 }));
  }
  const access = await requireRoomBookingUser(request);
  if (!access.ok) return access.response;

  const body = await parseJson(request, BodySchema);
  if (body instanceof Response) return withCors(request, body);

  const result = await createRoomBooking({
    roomId: params.id,
    userId: access.user.sub,
    start: body.start,
    end: body.end,
    title: body.title,
    source: body.source,
  });
  if (!result.ok) {
    return withCors(request, Response.json({ error: result.error }, { status: result.status }));
  }
  return withCors(request, Response.json({ booking: result.value }, { status: 201 }));
}
