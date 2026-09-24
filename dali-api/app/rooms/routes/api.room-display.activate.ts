import type { Route } from "./+types/api.room-display.activate";
import { z } from "zod";
import { prisma } from "~/lib/db";
import { parseJson } from "~/lib/validate";
import { checkRateLimit, getClientIp } from "~/lib/rate-limit";
import { redeemDisplaySetupCode } from "~/lib/room-display.server";

const BodySchema = z.object({ code: z.string().trim().min(1).max(32) });

// POST /api/room-display/activate — unauthenticated. The door iPad redeems the
// setup code Core minted at /core/rooms for its long-lived display token.
export async function action({ request }: Route.ActionArgs) {
  if (request.method !== "POST") {
    return Response.json({ error: "Method not allowed" }, { status: 405 });
  }
  // The setup code is the only secret here, so cap guessing hard.
  const limited = checkRateLimit(request, { max: 10, windowMs: 10 * 60_000 }, `room-display-activate:${getClientIp(request)}`);
  if (limited) return limited;

  const body = await parseJson(request, BodySchema);
  if (body instanceof Response) return body;

  const redeemed = await redeemDisplaySetupCode(body.code);
  if (!redeemed) {
    return Response.json({ error: "That code is invalid or has expired" }, { status: 400 });
  }
  const display = await prisma.roomDisplay.findUniqueOrThrow({
    where: { id: redeemed.displayId },
    select: { label: true, room: { select: { id: true, name: true } } },
  });
  return Response.json({ token: redeemed.token, label: display.label, room: display.room });
}
