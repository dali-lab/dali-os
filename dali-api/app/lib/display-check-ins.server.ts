// Who has scanned in at a door display, for the check-in list beside the
// scanner and the lab-wide "12 of 48 checked in" counter. Reads the same
// MeetingAttendance rows markMeetingAttendance writes, so a check-in on one
// iPad shows up on every other one at their next poll.

import { prisma } from "~/lib/db";
import { resolvePhotoUrl } from "~/lib/photo";

export type DisplayCheckIn = {
  id: string;
  firstName: string;
  lastName: string;
  photoUrl: string | null;
  at: string;
};

export type DisplayCheckIns = {
  count: number;
  // Invited people plus anyone already on this occurrence's roster.
  expected: number;
  recent: DisplayCheckIn[];
};

export async function getDisplayCheckIns(
  meetingId: string,
  occurrenceStart: Date,
  limit: number,
): Promise<DisplayCheckIns> {
  const [meeting, rows] = await Promise.all([
    prisma.scheduledMeeting.findUnique({
      where: { id: meetingId },
      select: { organizerId: true, participantUserIds: true },
    }),
    prisma.meetingAttendance.findMany({
      where: { scheduledMeetingId: meetingId, occurrenceStart },
      orderBy: { markedAt: "desc" },
      select: {
        present: true,
        markedAt: true,
        user: { select: { id: true, firstName: true, lastName: true, photoUrl: true } },
      },
    }),
  ]);
  const roster = new Set([
    ...(meeting ? [meeting.organizerId, ...meeting.participantUserIds] : []),
    ...rows.map((r) => r.user.id),
  ]);
  const present = rows.filter((r) => r.present);
  return {
    count: present.length,
    expected: roster.size,
    recent: await Promise.all(
      present.slice(0, limit).map(async (r) => ({
        id: r.user.id,
        firstName: r.user.firstName,
        lastName: r.user.lastName,
        photoUrl: await resolvePhotoUrl(r.user.photoUrl),
        at: (r.markedAt ?? occurrenceStart).toISOString(),
      })),
    ),
  };
}

/** Whether `userId` is already marked present at this occurrence. */
export async function isCheckedIn(meetingId: string, occurrenceStart: Date, userId: string) {
  const row = await prisma.meetingAttendance.findFirst({
    where: { scheduledMeetingId: meetingId, occurrenceStart, userId, present: true },
    select: { id: true },
  });
  return row !== null;
}
