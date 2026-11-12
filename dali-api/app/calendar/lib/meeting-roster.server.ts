import { prisma } from "~/lib/db.server";
import { resolveOccurrence, type Occurrence, type OccurrenceMeeting } from "~/calendar/lib/meeting-occurrences";

/** A meeting's occurrence for `at` (see resolveOccurrence), reading its
 *  exceptions only when there's a series for them to retime. */
export async function resolveMeetingOccurrence(
  meeting: OccurrenceMeeting & { id: string },
  at?: Date | null,
): Promise<Occurrence> {
  const exceptions =
    at && meeting.recurrenceRule
      ? await prisma.meetingException.findMany({
          where: { scheduledMeetingId: meeting.id },
          select: { originalStart: true, overrideStart: true, overrideDurationMin: true, cancelled: true },
        })
      : [];
  return resolveOccurrence(meeting, exceptions, at);
}

/**
 * Put the meeting's roster (participants + organizer) on one occurrence's
 * attendance, defaulting to the first. Idempotent. Rows are made per occurrence
 * as each one is opened, marked or checked into rather than fanned out up
 * front — a series can be open-ended.
 */
export async function seedMeetingRoster(
  meeting: {
    id: string;
    organizerId: string;
    participantUserIds: string[];
    selectedAt: Date | null;
    createdAt: Date;
  },
  occurrenceStart: Date = meeting.selectedAt ?? meeting.createdAt,
): Promise<void> {
  const attendeeIds = Array.from(new Set([...meeting.participantUserIds, meeting.organizerId]));
  await prisma.meetingAttendance.createMany({
    data: attendeeIds.map((userId) => ({ scheduledMeetingId: meeting.id, occurrenceStart, userId })),
    skipDuplicates: true,
  });
}

/**
 * seedMeetingRoster for an occurrence being looked at, but only on a meeting
 * that tracks attendance at all (it has a roster somewhere) — opening a plain
 * event's page mustn't start one.
 */
export async function ensureOccurrenceRoster(
  meeting: Parameters<typeof seedMeetingRoster>[0],
  occurrenceStart: Date,
): Promise<void> {
  const tracked = await prisma.meetingAttendance.findFirst({
    where: { scheduledMeetingId: meeting.id },
    select: { id: true },
  });
  if (tracked) await seedMeetingRoster(meeting, occurrenceStart);
}

export type MarkMeetingAttendanceResult =
  | { ok: true }
  | { ok: false; error: string; status: number };

/**
 * Toggle whether a participant was present at one occurrence of a meeting,
 * keeping TimeEntry in sync: present -> upsert a Meeting-sourced TimeEntry for
 * that user and occurrence; not present -> delete it. Shared by the
 * organizer-facing attendance-toggle route (api.scheduled-meetings.$id.attendance.ts)
 * and the self-check-in route (api.scheduled-meetings.$id.check-in.ts) so the
 * upsert/delete logic isn't duplicated between "someone else marks you present"
 * and "you mark yourself present." Callers are responsible for their own
 * auth/permission gate before calling this — it does not re-check who
 * `markedByUserId` is.
 *
 * `occurrence` is any instant resolveOccurrence understands — the occurrence
 * the roster is showing, or "now" for check-in and scanning. Omitted = the
 * first occurrence.
 */
export async function markMeetingAttendance(
  meetingId: string,
  userId: string,
  present: boolean,
  markedByUserId: string,
  occurrence?: Date | null,
  // Walk-ins: add a roster row for someone who wasn't invited instead of
  // rejecting them. Scan stations pass this for SelfCheckIn events, where
  // any DALI member who shows up counts.
  opts: { addIfMissing?: boolean } = {},
): Promise<MarkMeetingAttendanceResult> {
  const meeting = await prisma.scheduledMeeting.findUnique({
    where: { id: meetingId },
    select: {
      id: true,
      projectId: true,
      organizerId: true,
      participantUserIds: true,
      durationMinutes: true,
      selectedAt: true,
      createdAt: true,
      recurrenceRule: true,
      externalEventId: true,
    },
  });
  if (!meeting) return { ok: false, error: "Not found", status: 404 };

  // On the roster = invited now, or on some occurrence's attendance already
  // (a tracked event's roster can hold people its Google guest list doesn't).
  const invited =
    meeting.organizerId === userId ||
    meeting.participantUserIds.includes(userId) ||
    (await prisma.meetingAttendance.findFirst({
      where: { scheduledMeetingId: meeting.id, userId },
      select: { id: true },
    })) !== null;
  if (!invited && !opts.addIfMissing) {
    return { ok: false, error: "User was not invited to this meeting", status: 400 };
  }

  const occ = await resolveMeetingOccurrence(meeting, occurrence);
  const key = { scheduledMeetingId: meeting.id, occurrenceStart: occ.originalStart, userId };
  await prisma.meetingAttendance.upsert({
    where: { scheduledMeetingId_occurrenceStart_userId: key },
    create: { ...key, present, markedByUserId, markedAt: new Date() },
    update: { present, markedByUserId, markedAt: new Date() },
  });

  if (present) {
    const hasTime = meeting.selectedAt !== null;
    const times = {
      projectId: meeting.projectId,
      date: hasTime ? occ.start : meeting.createdAt,
      hours: (occ.end.getTime() - occ.start.getTime()) / 3_600_000,
      startTime: hasTime ? occ.start : null,
      endTime: hasTime ? occ.end : null,
    };
    await prisma.timeEntry.upsert({
      where: { scheduledMeetingId_occurrenceStart_userId: key },
      create: { ...key, source: "Meeting", ...times },
      update: times,
    });
  } else {
    await prisma.timeEntry.deleteMany({ where: key });
  }

  return { ok: true };
}
