import type { Prisma } from "~/generated/prisma/client";
import { prisma } from "~/lib/db.server";
import { fullName } from "~/lib/display";
import { decodeCursor, keysetAfter, keysetPage } from "~/lib/pagination";

export const SENT_PAGE_SIZE = 30;

export const SENT_WHERE = {
  canceledAt: null,
  sentAt: { not: null },
  lastError: null,
} satisfies Prisma.ScheduledAnnouncementWhereInput;

type AudienceRow = { allMembers: boolean; groupIds: string[]; userIds: string[] };

export function audienceLabel(r: AudienceRow, groupById: Map<string, { name: string }>): string {
  if (r.allMembers) return "Whole lab";
  const parts = r.groupIds.map((id) => groupById.get(id)?.name ?? "A group");
  if (r.userIds.length > 0) {
    parts.push(`${r.userIds.length} ${r.userIds.length === 1 ? "person" : "people"}`);
  }
  return parts.join(", ") || "No one";
}

export function countSentAnnouncements() {
  return prisma.scheduledAnnouncement.count({ where: SENT_WHERE });
}

export async function loadSentAnnouncements(
  rawCursor: string | null,
  groupById: Map<string, { name: string }>,
) {
  const rows = await prisma.scheduledAnnouncement.findMany({
    where: { AND: [SENT_WHERE, keysetAfter("sentAt", decodeCursor(rawCursor))] },
    orderBy: [{ sentAt: "desc" }, { id: "desc" }],
    take: SENT_PAGE_SIZE + 1,
  });
  const { items: page, nextCursor } = keysetPage(rows, SENT_PAGE_SIZE, (r) => ({
    at: r.sentAt!.toISOString(),
    id: r.id,
  }));
  const sentIds = page.map((r) => r.id);
  const [totals, cleared, authors] = await Promise.all([
    prisma.notification.groupBy({
      by: ["announcementId"],
      where: { announcementId: { in: sentIds } },
      _count: { _all: true },
    }),
    prisma.notification.groupBy({
      by: ["announcementId"],
      where: { announcementId: { in: sentIds }, readAt: { not: null } },
      _count: { _all: true },
    }),
    prisma.user.findMany({
      where: { id: { in: [...new Set(page.map((r) => r.createdByUserId))] } },
      select: { id: true, firstName: true, lastName: true },
    }),
  ]);
  const totalById = new Map(totals.map((t) => [t.announcementId, t._count._all]));
  const clearedById = new Map(cleared.map((t) => [t.announcementId, t._count._all]));
  const authorById = new Map(authors.map((a) => [a.id, fullName(a) || "Core"]));

  return {
    nextCursor,
    items: page.map((r) => ({
      id: r.id,
      title: r.title,
      body: r.body,
      author: authorById.get(r.createdByUserId) ?? "Core",
      audience: audienceLabel(r, groupById),
      sendAt: r.sendAt.toISOString(),
      dueAt: r.dueAt?.toISOString() ?? null,
      ccDartmouth: r.ccDartmouth,
      // Pre-tracking sends have no linked rows; fall back to the stored count.
      recipients: totalById.get(r.id) ?? r.sentCount ?? 0,
      completed: clearedById.get(r.id) ?? 0,
    })),
  };
}
