// Server-only loader for the Drive's "Shared with me" space: a flat list of
// pages the viewer reaches by a named share, not through workspace membership.

import { prisma } from "~/lib/db.server";
import { pageOpenHref } from "~/lib/page-href";
import { DRIVE_PAGE_KINDS } from "~/lib/drive.server";
import type { DriveItem } from "~/lib/drive.server";
import { getPageAccessBulk, PAGE_ACCESS_SELECT } from "~/lib/pageAccess.server";
import { groupIdsForUser } from "~/lib/page-sharing.server";

/** A shared Folder would open onto children this flat space never loads, so
 *  only leaf pages are listed. */
const SHARED_KINDS = DRIVE_PAGE_KINDS.filter((k) => k !== "Folder" && k !== "Form");

const MAX_ROWS = 500;

const PAGE_SELECT = {
  ...PAGE_ACCESS_SELECT,
  title: true,
  kind: true,
  iconEmoji: true,
  updatedAt: true,
} as const;

type SharedPage = {
  id: string;
  title: string;
  kind: string;
  iconEmoji: string | null;
  updatedAt: Date;
};

type DocItem = Extract<DriveItem, { type: "doc" }>;

function docItem(page: SharedPage, extra: Partial<DocItem>): DriveItem {
  return {
    type: "doc",
    isWhiteboard: page.kind === "Whiteboard",
    isSlides: page.kind === "Slides",
    id: page.id,
    title: page.title,
    parentFolderId: null,
    iconEmoji: page.iconEmoji,
    updatedAt: page.updatedAt,
    href: pageOpenHref(page.kind, page.id),
    ...extra,
  };
}

/**
 * Pages shared with the viewer by name (directly or through a group) that they
 * would not see through workspace membership or a General access link, newest
 * share first. The same list carries the pages the viewer shared with others
 * (`sharedByMe`) so the "Shared by me" chip filters client-side without a
 * refetch.
 *
 * Whether a page "would be seen anyway" is decided by the ordinary access
 * computation with named shares switched off, so public and lab-listed notes
 * drop out for the same reason they do in the personal-notes inbox, and Core
 * sees nothing for Lab or project pages (its base is already full).
 */
export async function loadSharedWithMe({
  userSub,
  request,
}: {
  userSub: string;
  request?: Request;
}): Promise<DriveItem[]> {
  const groupIds = await groupIdsForUser(userSub, request);

  const [received, granted] = await Promise.all([
    prisma.pageShare.findMany({
      where: {
        OR: [
          { principalType: "User", principalId: userSub },
          ...(groupIds.length ? [{ principalType: "Group" as const, principalId: { in: groupIds } }] : []),
        ],
        page: { archivedAt: null, kind: { in: SHARED_KINDS } },
      },
      orderBy: { createdAt: "desc" },
      take: MAX_ROWS,
      select: { pageId: true, createdAt: true, createdById: true, page: { select: PAGE_SELECT } },
    }),
    prisma.pageShare.findMany({
      where: {
        createdById: userSub,
        NOT: { principalType: "User", principalId: userSub },
        page: { archivedAt: null, kind: { in: SHARED_KINDS } },
      },
      orderBy: { createdAt: "desc" },
      take: MAX_ROWS,
      select: { pageId: true, createdAt: true, page: { select: PAGE_SELECT } },
    }),
  ]);

  // Latest share per page wins when someone is reached by more than one grant.
  const receivedByPage = new Map<string, (typeof received)[number]>();
  for (const row of received) if (!receivedByPage.has(row.pageId)) receivedByPage.set(row.pageId, row);

  const receivedPages = [...receivedByPage.values()].map((r) => r.page);
  const [baseAccess, sharerRows] = await Promise.all([
    getPageAccessBulk(userSub, receivedPages, request, { ignoreShares: true }),
    prisma.user.findMany({
      where: { id: { in: [...new Set([...receivedByPage.values()].map((r) => r.createdById))] } },
      select: { id: true, firstName: true, lastName: true },
    }),
  ]);
  const sharerName = new Map(sharerRows.map((u) => [u.id, `${u.firstName} ${u.lastName}`.trim()]));

  const items = new Map<string, { item: DriveItem; at: number }>();
  for (const row of receivedByPage.values()) {
    if (baseAccess.get(row.pageId)?.canView) continue;
    const name = sharerName.get(row.createdById);
    items.set(row.pageId, {
      at: row.createdAt.getTime(),
      item: docItem(row.page, {
        sharedBy: name ? { name } : null,
        sharedAt: row.createdAt,
        sharedWithMe: true,
      }),
    });
  }

  const grantedByPage = new Map<string, (typeof granted)[number]>();
  for (const row of granted) if (!grantedByPage.has(row.pageId)) grantedByPage.set(row.pageId, row);

  const grantedPages = [...grantedByPage.values()].map((r) => r.page);
  const ownAccess = await getPageAccessBulk(userSub, grantedPages, request);
  for (const row of grantedByPage.values()) {
    if (!ownAccess.get(row.pageId)?.canView) continue;
    const existing = items.get(row.pageId);
    if (existing) {
      (existing.item as DocItem).sharedByMe = true;
      continue;
    }
    items.set(row.pageId, {
      at: row.createdAt.getTime(),
      item: docItem(row.page, {
        sharedBy: { name: "You" },
        sharedAt: row.createdAt,
        sharedByMe: true,
      }),
    });
  }

  return [...items.values()].sort((a, b) => b.at - a.at).map((e) => e.item);
}
