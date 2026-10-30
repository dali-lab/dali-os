import { prisma } from "~/lib/db";
import { fullName } from "~/lib/display";
import { decodeCursor, keysetPage } from "~/lib/pagination";

export const OLDER_PAGE_SIZE = 30;
const CURRENT_WINDOW_MS = 24 * 60 * 60_000;

export interface AttendanceCard {
  id: string;
  meetingId: string;
  occurrenceStart: string;
  title: string;
  typeLabel: string;
  scope: string;
  startsAt: string | null;
  isPast: boolean;
  organizerName: string;
  invited: number;
  checkedIn: number;
  viewerPresent: boolean;
  canManage: boolean;
  canEdit: boolean;
  attendees: {
    id: string;
    name: string;
    present: boolean;
    markedAt: string | null;
    absenceNote: string | null;
  }[];
}

interface Viewer {
  userId: string;
  core: boolean;
}

type OccurrenceKey = { scheduledMeetingId: string; occurrenceStart: Date };

function meetingWhere(userId: string, q: string) {
  const contains = { contains: q, mode: "insensitive" as const };
  const person = [{ firstName: contains }, { lastName: contains }, { daliEmail: contains }];
  return {
    status: { not: "Cancelled" as const },
    AND: [
      { OR: [{ organizerId: userId }, { participantUserIds: { has: userId } }] },
      { attendance: { some: {} } },
      ...(q
        ? [
            {
              OR: [
                { title: contains },
                { meetingTypeLabel: contains },
                { project: { name: contains } },
                { organizer: { OR: person } },
                { attendance: { some: { user: { OR: person } } } },
              ],
            },
          ]
        : []),
    ],
  };
}

async function buildCards(
  meetingIds: string[],
  attendanceWhere: object,
  viewer: Viewer,
): Promise<AttendanceCard[]> {
  if (meetingIds.length === 0) return [];
  const { userId, core } = viewer;
  const [meetings, assignments] = await Promise.all([
    prisma.scheduledMeeting.findMany({
      where: { id: { in: meetingIds } },
      select: {
        id: true,
        title: true,
        selectedAt: true,
        durationMinutes: true,
        meetingType: true,
        meetingTypeLabel: true,
        isCoreMeeting: true,
        organizerId: true,
        project: { select: { id: true, name: true } },
        organizer: { select: { firstName: true, lastName: true, daliEmail: true } },
        exceptions: { select: { originalStart: true, overrideStart: true, cancelled: true } },
        attendance: {
          where: attendanceWhere,
          orderBy: { user: { lastName: "asc" } },
          select: {
            occurrenceStart: true,
            present: true,
            markedAt: true,
            absenceNote: true,
            userId: true,
            user: { select: { id: true, firstName: true, lastName: true, daliEmail: true } },
          },
        },
      },
    }),
    prisma.projectAssignment.findMany({ where: { userId }, select: { projectId: true } }),
  ]);
  const memberProjectIds = new Set(assignments.map((a) => a.projectId));

  const now = Date.now();
  return meetings.flatMap((m) => {
    const canManage =
      m.organizerId === userId ||
      core ||
      (m.project !== null && memberProjectIds.has(m.project.id));
    const canEdit = m.organizerId === userId || core;
    const scope = m.project ? m.project.name : m.isCoreMeeting ? "Core" : "General";
    const typeLabel =
      m.meetingType === "Other" ? m.meetingTypeLabel || "Meeting" : (m.meetingType ?? "Meeting");
    const byOccurrence = new Map<number, typeof m.attendance>();
    for (const a of m.attendance) {
      const key = a.occurrenceStart.getTime();
      byOccurrence.set(key, [...(byOccurrence.get(key) ?? []), a]);
    }
    const exceptions = new Map(m.exceptions.map((e) => [e.originalStart.getTime(), e]));
    return [...byOccurrence].flatMap(([key, rows]) => {
      const exception = exceptions.get(key);
      if (exception?.cancelled) return [];
      const start = m.selectedAt ? (exception?.overrideStart ?? new Date(key)) : null;
      const end = start ? start.getTime() + m.durationMinutes * 60_000 : null;
      return [
        {
          id: `${m.id}:${key}`,
          meetingId: m.id,
          occurrenceStart: new Date(key).toISOString(),
          title: m.title,
          typeLabel,
          scope,
          startsAt: start?.toISOString() ?? null,
          isPast: end !== null && end < now,
          organizerName: fullName(m.organizer) || m.organizer.daliEmail || "—",
          invited: rows.length,
          checkedIn: rows.filter((a) => a.present).length,
          viewerPresent: rows.find((a) => a.userId === userId)?.present ?? false,
          canManage,
          canEdit,
          attendees: rows.map((a) => ({
            id: a.user.id,
            name: fullName(a.user) || a.user.daliEmail || a.user.id,
            present: a.present,
            markedAt: a.markedAt?.toISOString() ?? null,
            absenceNote: canManage ? a.absenceNote : null,
          })),
        },
      ];
    });
  });
}

// Occurrences that stay in the first response: recent or upcoming ones,
// unscheduled meetings, and rescheduled occurrences whose new time is recent.
function splitWhere(ids: string[], cutoff: Date, rescheduled: OccurrenceKey[]) {
  const base = { scheduledMeetingId: { in: ids } };
  const rescheduledKeys = rescheduled.map((k) => ({
    scheduledMeetingId: k.scheduledMeetingId,
    occurrenceStart: k.occurrenceStart,
  }));
  return {
    current: {
      ...base,
      OR: [
        { occurrenceStart: { gte: cutoff } },
        { meeting: { selectedAt: null } },
        ...rescheduledKeys,
      ],
    },
    older: {
      ...base,
      occurrenceStart: { lt: cutoff },
      meeting: { selectedAt: { not: null } },
      ...(rescheduledKeys.length ? { NOT: { OR: rescheduledKeys } } : {}),
    },
  };
}

async function olderPage(
  where: object,
  cursorRaw: string | null,
  viewer: Viewer,
): Promise<{ items: AttendanceCard[]; nextCursor: string | null }> {
  const cursor = decodeCursor(cursorRaw);
  const after = cursor
    ? (() => {
        const at = new Date(cursor.at);
        return {
          OR: [
            { occurrenceStart: { lt: at } },
            { occurrenceStart: at, scheduledMeetingId: { lt: cursor.id } },
          ],
        };
      })()
    : {};
  const keys = await prisma.meetingAttendance.groupBy({
    by: ["scheduledMeetingId", "occurrenceStart"],
    where: { AND: [where, after] },
    orderBy: [{ occurrenceStart: "desc" }, { scheduledMeetingId: "desc" }],
    take: OLDER_PAGE_SIZE + 1,
  });
  const page = keysetPage(keys, OLDER_PAGE_SIZE, (k) => ({
    at: k.occurrenceStart.toISOString(),
    id: k.scheduledMeetingId,
  }));
  const pairs = page.items.map((k) => ({
    scheduledMeetingId: k.scheduledMeetingId,
    occurrenceStart: k.occurrenceStart,
  }));
  const items = await buildCards(
    [...new Set(pairs.map((p) => p.scheduledMeetingId))],
    { OR: pairs },
    viewer,
  );
  const wanted = new Set(pairs.map((p) => `${p.scheduledMeetingId}:${p.occurrenceStart.getTime()}`));
  return {
    items: items
      .filter((c) => wanted.has(c.id))
      .sort(
        (a, b) =>
          b.occurrenceStart.localeCompare(a.occurrenceStart) || b.meetingId.localeCompare(a.meetingId),
      ),
    nextCursor: page.nextCursor,
  };
}

export async function loadAttendanceFeed(
  viewer: Viewer,
  opts: { q?: string; cursor?: string | null },
): Promise<{ items: AttendanceCard[]; nextCursor: string | null }> {
  const q = (opts.q ?? "").trim();
  const visible = await prisma.scheduledMeeting.findMany({
    where: meetingWhere(viewer.userId, q),
    select: { id: true },
  });
  const ids = visible.map((m) => m.id);
  if (ids.length === 0) return { items: [], nextCursor: null };

  const cutoff = new Date(Date.now() - CURRENT_WINDOW_MS);
  const rescheduled = await prisma.meetingException.findMany({
    where: { scheduledMeetingId: { in: ids }, overrideStart: { gte: cutoff } },
    select: { scheduledMeetingId: true, originalStart: true },
  });
  const where = splitWhere(
    ids,
    cutoff,
    rescheduled.map((e) => ({
      scheduledMeetingId: e.scheduledMeetingId,
      occurrenceStart: e.originalStart,
    })),
  );

  if (typeof opts.cursor === "string") return olderPage(where.older, opts.cursor, viewer);

  const currentMeetings = await prisma.meetingAttendance.groupBy({
    by: ["scheduledMeetingId"],
    where: where.current,
  });
  const [current, older] = await Promise.all([
    buildCards(currentMeetings.map((m) => m.scheduledMeetingId), where.current, viewer),
    olderPage(where.older, null, viewer),
  ]);
  return { items: [...current, ...older.items], nextCursor: older.nextCursor };
}
