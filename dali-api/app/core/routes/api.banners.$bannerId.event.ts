// POST /api/banners/:bannerId/event { event: "view" | "click" | "snooze" }:
// what the overlay reports back, so frequency and snooze rules hold across
// devices and the Banners list can total views, clicks and snoozes.

import { z } from "zod";
import { prisma } from "~/lib/db";
import { requireAuth } from "~/lib/auth";
import { parseJson } from "~/lib/validate";
import { recordBannerEvent } from "~/core/lib/banners.server";

const Body = z.object({ event: z.enum(["view", "click", "snooze"]) });

export async function action({ request, params }: { request: Request; params: { bannerId?: string } }) {
  if (request.method !== "POST") return Response.json({ error: "Method not allowed" }, { status: 405 });
  const auth = await requireAuth(request);
  if (!auth.ok) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const body = await parseJson(request, Body);
  if (body instanceof Response) return body;
  const bannerId = params.bannerId ?? "";
  const now = new Date();
  // Only a banner that is live right now can be seen, clicked or snoozed.
  const live = await prisma.banner.findFirst({
    where: { id: bannerId, published: true, startsAt: { lte: now }, endsAt: { gt: now } },
    select: { id: true },
  });
  if (!live) return Response.json({ error: "Not found" }, { status: 404 });
  await recordBannerEvent(bannerId, auth.user.sub, body.event, now);
  return Response.json({ ok: true });
}
