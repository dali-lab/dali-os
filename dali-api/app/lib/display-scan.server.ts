// Lab-wide iPad attendance scanning, switched on from a meeting's page. While a
// DisplayScanSession is live, every door display scans wallet passes for its
// event occurrence instead of showing its room (see api.room-display.*).

import { prisma } from "~/lib/db";
import { fullName } from "~/lib/display";
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
  startedBy: string | null;
  expiresAt: Date;
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
    select: {
      occurrenceStart: true,
      expiresAt: true,
      startedByUserId: true,
      scheduledMeeting: { select: MEETING_SELECT },
    },
  });
  if (!session) return null;
  const meeting = session.scheduledMeeting;
  const [occ, starter] = await Promise.all([
    meeting.selectedAt ? resolveMeetingOccurrence(meeting, session.occurrenceStart) : null,
    session.startedByUserId
      ? prisma.user.findUnique({
          where: { id: session.startedByUserId },
          select: { firstName: true, lastName: true },
        })
      : null,
  ]);
  return {
    meetingId: meeting.id,
    occurrenceStart: session.occurrenceStart,
    title: meeting.title,
    start: occ?.start ?? null,
    end: occ?.end ?? null,
    isEvent: meeting.attendanceMode === "SelfCheckIn",
    startedBy: starter ? fullName(starter) || null : null,
    expiresAt: session.expiresAt,
  };
}

export type StartDisplayScanResult =
  | { ok: true; expiresAt: Date; displaced: string | null }
  | { ok: false; error: string; status: number };

/** Point every door display at this occurrence. Refused while another event
 *  has the iPads unless `takeOver` is set, which stops that event's scan in
 *  the same transaction and reports its title as `displaced`. */
export async function startDisplayScan(
  meetingId: string,
  occurrenceStart: Date,
  userId: string,
  { takeOver = false }: { takeOver?: boolean } = {},
): Promise<StartDisplayScanResult> {
  const meeting = await prisma.scheduledMeeting.findUnique({ where: { id: meetingId }, select: MEETING_SELECT });
  if (!meeting) return { ok: false, error: "Not found", status: 404 };
  const now = new Date();
  const occ = meeting.selectedAt ? await resolveMeetingOccurrence(meeting, occurrenceStart) : null;
  const expiresAt = new Date(
    occ ? occ.end.getTime() + CHECK_IN_GRACE_MIN * 60_000 : now.getTime() + UNSCHEDULED_TTL_MS,
  );
  if (expiresAt <= now) return { ok: false, error: "This event has already ended", status: 409 };

  return prisma.$transaction(async (tx) => {
    // Serializes concurrent starts so two events can't both claim the iPads.
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('display-scan'))`;
    const active = await tx.displayScanSession.findFirst({
      where: { expiresAt: { gt: now } },
      select: { scheduledMeetingId: true, occurrenceStart: true, scheduledMeeting: { select: { title: true } } },
    });
    if (active) {
      const same =
        active.scheduledMeetingId === meetingId && active.occurrenceStart.getTime() === occurrenceStart.getTime();
      if (same) return { ok: true as const, expiresAt, displaced: null };
      if (!takeOver) {
        return {
          ok: false as const,
          error: `iPads are already tracking "${active.scheduledMeeting.title}"`,
          status: 409,
        };
      }
    }
    // Lapsed sessions, or the one being taken over: clear them out.
    await tx.displayScanSession.deleteMany({});
    await tx.displayScanSession.create({
      data: { scheduledMeetingId: meetingId, occurrenceStart, expiresAt, startedByUserId: userId },
    });
    return { ok: true as const, expiresAt, displaced: active?.scheduledMeeting.title ?? null };
  });
}

/** Turn the iPads back into room displays. Scoped to one meeting from its
 *  page; with no meeting (Core ▸ Rooms) it stops whatever is live. */
export async function stopDisplayScan(meetingId?: string) {
  await prisma.displayScanSession.deleteMany({ where: meetingId ? { scheduledMeetingId: meetingId } : {} });
}
