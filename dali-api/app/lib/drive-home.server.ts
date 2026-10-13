import { prisma } from "~/lib/db";
import { getPageAccessBulk, PAGE_ACCESS_SELECT } from "~/lib/pageAccess.server";
import { isCore } from "~/lib/roles";
import { expandOccurrences } from "~/lib/meeting-occurrences";
import { pageRowToDriveItem } from "~/lib/drive.server";
import type { DriveItem } from "~/lib/drive.server";
import type { PageKind, Prisma } from "~/generated/prisma/client";

export const HOME_LIMIT = 8;
export const UPCOMING_WINDOW_DAYS = 7;
// Rows read per section before the access filter drops the ones the viewer can no longer open.
const READ_MULTIPLIER = 3;
// An exception can move an occurrence across the window edge, so scan wider than what is kept.
const GUARD_MS = 24 * 60 * 60_000;
const HOME_PAGE_KINDS: PageKind[] = ["Folder", "FreeForm", "Structured", "Whiteboard", "Notebook"];

export type HomePageItem = Extract<DriveItem, { type: "folder" | "doc" }> & { visitedAt: Date | null };

export type HomeUpcoming = {
  item: Extract<DriveItem, { type: "doc" }>;
  nextAt: Date;
  meetingTitle: string;
};

export type DriveHomeData = {
  recent: HomePageItem[];
  starred: HomePageItem[];
  upcoming: HomeUpcoming[];
};

const PAGE_SELECT = {
  ...PAGE_ACCESS_SELECT,
  partnerVisible: true,
  title: true,
  kind: true,
  iconEmoji: true,
  folderType: true,
  updatedAt: true,
} as const;

type PageRow = Prisma.PageGetPayload<{ select: typeof PAGE_SELECT }>;

export async function loadDriveHome(viewerId: string, request?: Request): Promise<DriveHomeData> {
  const now = new Date();
  const windowEnd = new Date(now.getTime() + UPCOMING_WINDOW_DAYS * 24 * 60 * 60_000);
  const pageFilter = { is: { archivedAt: null, kind: { in: HOME_PAGE_KINDS } } };

  const [recentRows, starredRows, meetings] = await Promise.all([
    prisma.userFavorite.findMany({
      where: { userId: viewerId, pageId: { not: null }, visitedAt: { not: null }, page: pageFilter },
      orderBy: { visitedAt: "desc" },
      take: HOME_LIMIT * READ_MULTIPLIER,
      select: { visitedAt: true, page: { select: PAGE_SELECT } },
    }),
    prisma.userFavorite.findMany({
      where: { userId: viewerId, pageId: { not: null }, favoritedAt: { not: null }, page: pageFilter },
      orderBy: { favoritedAt: "desc" },
      take: HOME_LIMIT * READ_MULTIPLIER,
      select: { visitedAt: true, page: { select: PAGE_SELECT } },
    }),
    isCore(viewerId, request).then((core) => upcomingMeetings(viewerId, core, now, windowEnd)),
  ]);

  const upcomingByNotebook = soonestPerNotebook(meetings, now, windowEnd);
  const pages = new Map<string, PageRow>();
  for (const row of [...recentRows, ...starredRows]) if (row.page) pages.set(row.page.id, row.page);
  for (const { notebook } of upcomingByNotebook) pages.set(notebook.id, notebook);

  const access = await getPageAccessBulk(viewerId, [...pages.values()], request);
  const viewable = (id: string) => access.get(id)?.canView === true;

  const toItems = (rows: typeof recentRows, favorited: boolean): HomePageItem[] =>
    rows
      .filter((r) => r.page && viewable(r.page.id))
      .slice(0, HOME_LIMIT)
      .map((r) => ({ ...pageRowToDriveItem(r.page!), favorited, visitedAt: r.visitedAt }));

  const upcoming = upcomingByNotebook
    .filter(({ notebook }) => viewable(notebook.id))
    .slice(0, HOME_LIMIT)
    .map(({ notebook, nextAt, meetingTitle }): HomeUpcoming => ({
      item: pageRowToDriveItem(notebook) as HomeUpcoming["item"],
      nextAt,
      meetingTitle,
    }));

  return {
    recent: toItems(recentRows, false),
    starred: toItems(starredRows, true),
    upcoming,
  };
}

type MeetingRow = Awaited<ReturnType<typeof upcomingMeetings>>[number];

function upcomingMeetings(viewerId: string, viewerIsCore: boolean, now: Date, windowEnd: Date) {
  return prisma.scheduledMeeting.findMany({
    where: {
      notebookId: { not: null },
      status: "Confirmed",
      selectedAt: { not: null, lte: windowEnd },
      OR: [{ recurrenceRule: { not: null } }, { selectedAt: { gte: new Date(now.getTime() - GUARD_MS) } }],
      ...(viewerIsCore ? {} : { AND: [{ OR: [{ organizerId: viewerId }, { participantUserIds: { has: viewerId } }] }] }),
    },
    select: {
      title: true,
      selectedAt: true,
      durationMinutes: true,
      recurrenceRule: true,
      exceptions: {
        select: { originalStart: true, overrideStart: true, overrideDurationMin: true, cancelled: true },
      },
      notebook: { select: PAGE_SELECT },
    },
  });
}

/** One entry per notebook: its earliest occurrence starting inside [now, windowEnd], soonest first. */
function soonestPerNotebook(meetings: MeetingRow[], now: Date, windowEnd: Date) {
  const best = new Map<string, { notebook: PageRow; nextAt: Date; meetingTitle: string }>();
  for (const meeting of meetings) {
    if (!meeting.notebook) continue;
    const scanFrom = new Date(now.getTime() - GUARD_MS);
    const scanTo = new Date(windowEnd.getTime() + GUARD_MS);
    for (const occ of expandOccurrences(meeting, meeting.exceptions, scanFrom, scanTo)) {
      if (occ.start < now || occ.start > windowEnd) continue;
      const current = best.get(meeting.notebook.id);
      if (!current || occ.start < current.nextAt) {
        best.set(meeting.notebook.id, { notebook: meeting.notebook, nextAt: occ.start, meetingTitle: meeting.title });
      }
    }
  }
  return [...best.values()].sort((a, b) => a.nextAt.getTime() - b.nextAt.getTime());
}
