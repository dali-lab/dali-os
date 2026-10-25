import { prisma } from "~/lib/db";
import { getPageAccessBulk, PAGE_ACCESS_SELECT } from "~/lib/pageAccess.server";
import { expandOccurrences } from "~/lib/meeting-occurrences";
import { formsUsePageAccess } from "~/forms/lib/form-access.server";
import { formRowToDriveItem, pageRowToDriveItem } from "~/lib/drive.server";
import type { DriveItem } from "~/lib/drive.server";
import type { PageKind, Prisma } from "~/generated/prisma/client";

export const HOME_LIMIT = 4;
export const UPCOMING_WINDOW_DAYS = 7;
// Rows read per section before the access filter drops the ones the viewer can no longer open.
const READ_MULTIPLIER = 3;
// An exception can move an occurrence across the window edge, so scan wider than what is kept.
const GUARD_MS = 24 * 60 * 60_000;
const HOME_PAGE_KINDS: PageKind[] = ["Folder", "FreeForm", "Structured", "Whiteboard", "Notebook", "Slides"];

export type HomePageItem = Extract<DriveItem, { type: "folder" | "doc" | "form" }> & { visitedAt: Date | null };

export type HomeUpcoming = {
  meetingId: string;
  meetingTitle: string;
  nextAt: Date;
  item: Extract<DriveItem, { type: "doc" }>;
};

export type DriveHomeData = {
  recent: HomePageItem[];
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
  const homeKinds: PageKind[] = (await formsUsePageAccess(request)) ? [...HOME_PAGE_KINDS, "Form"] : HOME_PAGE_KINDS;
  const pageFilter = { is: { archivedAt: null, kind: { in: homeKinds } } };

  const [recentRows, meetings] = await Promise.all([
    prisma.userFavorite.findMany({
      where: { userId: viewerId, pageId: { not: null }, visitedAt: { not: null }, page: pageFilter },
      orderBy: { visitedAt: "desc" },
      take: HOME_LIMIT * READ_MULTIPLIER,
      select: { visitedAt: true, page: { select: PAGE_SELECT } },
    }),
    upcomingMeetings(viewerId, now, windowEnd),
  ]);

  const upcomingBySeries = soonestPerSeries(meetings, now, windowEnd);
  const pages = new Map<string, PageRow>();
  for (const row of recentRows) if (row.page) pages.set(row.page.id, row.page);
  for (const { notebook } of upcomingBySeries) pages.set(notebook.id, notebook);

  const access = await getPageAccessBulk(viewerId, [...pages.values()], request);
  const viewable = (id: string) => access.get(id)?.canView === true;

  const recent = recentRows
    .filter((r) => r.page && viewable(r.page.id))
    .slice(0, HOME_LIMIT)
    .map((r): HomePageItem => ({ ...homeItem(r.page!), favorited: false, visitedAt: r.visitedAt }));

  const upcoming = upcomingBySeries
    .filter(({ notebook }) => viewable(notebook.id))
    .slice(0, HOME_LIMIT)
    .map(({ meetingId, meetingTitle, nextAt, notebook }): HomeUpcoming => ({
      meetingId,
      meetingTitle,
      nextAt,
      item: pageRowToDriveItem(notebook) as HomeUpcoming["item"],
    }));

  return { recent, upcoming };
}

function homeItem(row: PageRow): Extract<DriveItem, { type: "folder" | "doc" | "form" }> {
  return row.kind === "Form" ? formRowToDriveItem(row, row.parentPageId, undefined, undefined) : pageRowToDriveItem(row);
}

type MeetingRow = Awaited<ReturnType<typeof upcomingMeetings>>[number];

function upcomingMeetings(viewerId: string, now: Date, windowEnd: Date) {
  return prisma.scheduledMeeting.findMany({
    where: {
      notebookId: { not: null },
      status: "Confirmed",
      selectedAt: { not: null, lte: windowEnd },
      OR: [{ recurrenceRule: { not: null } }, { selectedAt: { gte: new Date(now.getTime() - GUARD_MS) } }],
      AND: [{ OR: [{ organizerId: viewerId }, { participantUserIds: { has: viewerId } }] }],
    },
    select: {
      id: true,
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

/** One entry per meeting series: its earliest occurrence starting inside [now, windowEnd], soonest first. */
function soonestPerSeries(meetings: MeetingRow[], now: Date, windowEnd: Date) {
  const scanFrom = new Date(now.getTime() - GUARD_MS);
  const scanTo = new Date(windowEnd.getTime() + GUARD_MS);
  const rows: { meetingId: string; meetingTitle: string; nextAt: Date; notebook: PageRow }[] = [];
  for (const meeting of meetings) {
    if (!meeting.notebook) continue;
    let nextAt: Date | null = null;
    for (const occ of expandOccurrences(meeting, meeting.exceptions, scanFrom, scanTo)) {
      if (occ.start < now || occ.start > windowEnd) continue;
      if (!nextAt || occ.start < nextAt) nextAt = occ.start;
    }
    if (nextAt) rows.push({ meetingId: meeting.id, meetingTitle: meeting.title, nextAt, notebook: meeting.notebook });
  }
  return rows.sort((a, b) => a.nextAt.getTime() - b.nextAt.getTime());
}
