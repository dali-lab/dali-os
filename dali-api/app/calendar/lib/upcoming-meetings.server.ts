import { prisma } from "~/lib/db.server";
import { getPageAccessBulk, PAGE_ACCESS_SELECT } from "~/lib/pageAccess.server";
import { expandOccurrences, type Occurrence } from "~/calendar/lib/meeting-occurrences";
import { pageOpenHref } from "~/drive/lib/page-href";
import type { Prisma } from "~/generated/prisma/client";

export const UPCOMING_LIMIT = 3;
export const UPCOMING_WINDOW_DAYS = 7;
// An exception can move an occurrence across the window edge, so scan wider than what is kept.
const GUARD_MS = 24 * 60 * 60_000;

/** A meeting the viewer is in, opening onto its notes. */
export type UpcomingMeeting = {
  meetingId: string;
  title: string;
  /** ISO start of the series' running or next occurrence. */
  startsAt: string;
  endsAt: string;
  href: string;
};

const NOTEBOOK_SELECT = { ...PAGE_ACCESS_SELECT, kind: true } as const;

type NotebookRow = Prisma.PageGetPayload<{ select: typeof NOTEBOOK_SELECT }>;

export async function loadUpcomingMeetings(viewerId: string, request?: Request): Promise<UpcomingMeeting[]> {
  const now = new Date();
  const windowEnd = new Date(now.getTime() + UPCOMING_WINDOW_DAYS * 24 * 60 * 60_000);
  const series = soonestPerSeries(await upcomingMeetings(viewerId, now, windowEnd), now, windowEnd);

  const notebooks = new Map<string, NotebookRow>();
  for (const { notebook } of series) notebooks.set(notebook.id, notebook);
  const access = await getPageAccessBulk(viewerId, [...notebooks.values()], request);

  return series
    .filter(({ notebook }) => access.get(notebook.id)?.canView === true)
    .slice(0, UPCOMING_LIMIT)
    .map(({ meetingId, title, next, notebook }) => ({
      meetingId,
      title,
      startsAt: next.start.toISOString(),
      endsAt: next.end.toISOString(),
      href: pageOpenHref(notebook.kind, notebook.id),
    }));
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
      notebook: { select: NOTEBOOK_SELECT },
    },
  });
}

/** One entry per meeting series: its earliest occurrence still running or starting by windowEnd, soonest first. */
function soonestPerSeries(meetings: MeetingRow[], now: Date, windowEnd: Date) {
  const scanFrom = new Date(now.getTime() - GUARD_MS);
  const scanTo = new Date(windowEnd.getTime() + GUARD_MS);
  const rows: { meetingId: string; title: string; next: Occurrence; notebook: NotebookRow }[] = [];
  for (const meeting of meetings) {
    if (!meeting.notebook) continue;
    let next: Occurrence | null = null;
    for (const occ of expandOccurrences(meeting, meeting.exceptions, scanFrom, scanTo)) {
      if (occ.end <= now || occ.start > windowEnd) continue;
      if (!next || occ.start < next.start) next = occ;
    }
    if (next) rows.push({ meetingId: meeting.id, title: meeting.title, next, notebook: meeting.notebook });
  }
  return rows.sort((a, b) => a.next.start.getTime() - b.next.start.getTime());
}
