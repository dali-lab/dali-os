import { prisma } from "~/lib/db.server";
import { decodeCursor, keysetAfter, keysetPage } from "~/lib/pagination";
import type { PartnerActivity, PartnerActivityScope } from "../components/PartnerActivityFeed";

export const PARTNER_ACTIVITY_PAGE_SIZE = 30;

export interface PartnerActivityPage {
  items: PartnerActivity[];
  nextCursor: string | null;
  actorNames: Record<string, string>;
}

export async function loadPartnerActivityPage(
  scope: PartnerActivityScope,
  cursor: string | null = null,
): Promise<PartnerActivityPage> {
  const rows = await prisma.partnerActivity.findMany({
    where: { AND: [scope, keysetAfter("createdAt", decodeCursor(cursor))] },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: PARTNER_ACTIVITY_PAGE_SIZE + 1,
    select: {
      id: true,
      createdAt: true,
      applicationId: true,
      actorUserId: true,
      type: true,
      body: true,
      metadata: true,
    },
  });
  const page = keysetPage(rows, PARTNER_ACTIVITY_PAGE_SIZE, (r) => ({
    at: r.createdAt.toISOString(),
    id: r.id,
  }));

  const actorIds = [...new Set(page.items.map((r) => r.actorUserId).filter(Boolean))] as string[];
  let actorNames: Record<string, string> = {};
  if (actorIds.length > 0) {
    const users = await prisma.user.findMany({
      where: { id: { in: actorIds } },
      select: { id: true, firstName: true, lastName: true, daliEmail: true },
    });
    actorNames = Object.fromEntries(
      users.map((u) => [
        u.id,
        [u.firstName, u.lastName].filter(Boolean).join(" ") || u.daliEmail || u.id,
      ]),
    );
  }

  return {
    items: page.items.map((r) => ({
      id: r.id,
      createdAt: r.createdAt.toISOString(),
      applicationId: r.applicationId,
      actorUserId: r.actorUserId,
      type: r.type,
      body: r.body,
      metadata: (r.metadata ?? null) as Record<string, unknown> | null,
    })),
    nextCursor: page.nextCursor,
    actorNames,
  };
}
