import { prisma } from "~/lib/db.server";
import { isManualCheckInOpen } from "~/lib/check-in-window";
import type { HiringEventKind } from "~/generated/prisma/client";

export type BroadcastEvent = {
  id: string;
  title: string;
  kind: HiringEventKind;
  startsAt: Date;
  endsAt: Date;
  location: string | null;
};

/**
 * The event every paired door display should show a check-in QR for right
 * now: broadcast switched on and check-in still open. With several on at
 * once, the one starting soonest wins.
 */
export async function getBroadcastEvent(now: Date = new Date()): Promise<BroadcastEvent | null> {
  const candidates = await prisma.hiringEvent.findMany({
    where: { broadcastAt: { not: null }, checkInOpenAt: { not: null } },
    orderBy: { startsAt: "asc" },
    select: { id: true, title: true, kind: true, startsAt: true, endsAt: true, location: true, checkInOpenAt: true },
  });
  const live = candidates.find((e) => isManualCheckInOpen(e, now));
  if (!live) return null;
  const { checkInOpenAt: _open, ...event } = live;
  return event;
}
