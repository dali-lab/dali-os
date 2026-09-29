// Lab-wide iPad attendance scanning, switched on from Attendance. While a
// DisplayScanSession is live, every door display scans wallet passes for its
// event occurrence instead of showing its room (see api.room-display.*).

import { prisma } from "~/lib/db";
import { CHECK_IN_GRACE_MIN, resolveMeetingOccurrence } from "~/lib/scheduled-meeting";

// An event with no scheduled time has no end to lapse at.
const UNSCHEDULED_TTL_MS = 12 * 60 * 60_000;

export type ActiveDisplayScan = {
  meetingId: string;
  occurrenceStart: Date;
  title: string;
  start: Date | null;
  end: Date | null;
  /** Walk-ins count only at SelfCheckIn events, as at a room's own event. */
  isEvent: boolean;
};

const MEETING_SELECT = {
  id: true,
  title: true,
  attendanceMode: true,
  selectedAt: true,
  createdAt: true,
  durationMinutes: true,
  recurrenceRule: true,
  externalEventId: true,
} as const;

export async function getActiveDisplayScan(now: Date = new Date()): Promise<ActiveDisplayScan | null> {
  const session = await prisma.displayScanSession.findFirst({
    where: { expiresAt: { gt: now } },
    orderBy: { createdAt: "desc" },
    select: { occurrenceStart: true, scheduledMeeting: { select: MEETING_SELECT } },
  });
  if (!session) return null;
  const meeting = session.scheduledMeeting;
  const occ = meeting.selectedAt ? await resolveMeetingOccurrence(meeting, session.occurrenceStart) : null;
  return {
    meetingId: meeting.id,
    occurrenceStart: session.occurrenceStart,
    title: meeting.title,
    start: occ?.start ?? null,
    end: occ?.end ?? null,
    isEvent: meeting.attendanceMode === "SelfCheckIn",
  };
}

/** Point every door display at this occurrence, replacing any other session. */
export async function startDisplayScan(meetingId: string, occurrenceStart: Date, userId: string) {
  const meeting = await prisma.scheduledMeeting.findUnique({ where: { id: meetingId }, select: MEETING_SELECT });
  if (!meeting) return null;
  const now = Date.now();
  const occ = meeting.selectedAt ? await resolveMeetingOccurrence(meeting, occurrenceStart) : null;
  const expiresAt = new Date(
    occ ? occ.end.getTime() + CHECK_IN_GRACE_MIN * 60_000 : now + UNSCHEDULED_TTL_MS,
  );
  if (expiresAt.getTime() <= now) return null;
  await prisma.$transaction([
    prisma.displayScanSession.deleteMany({}),
    prisma.displayScanSession.create({
      data: { scheduledMeetingId: meetingId, occurrenceStart, expiresAt, startedByUserId: userId },
    }),
  ]);
  return { expiresAt };
}

export async function stopDisplayScan(meetingId: string) {
  await prisma.displayScanSession.deleteMany({ where: { scheduledMeetingId: meetingId } });
}
