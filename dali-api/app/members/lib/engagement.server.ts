import { prisma } from "~/lib/db";
import { commencementDate } from "~/lib/membership-status";
import { LAB_MEMBER_WHERE } from "~/lib/prisma-shapes";
import { resolvePhotoUrl } from "~/lib/photo";
import { fullName } from "~/lib/display";
import {
  countEngagement,
  engagementScore,
  rankLeaderboard,
  type EngagementEvent,
  type LeaderboardEntry,
} from "./engagement";

/** The top alumni by engagement since each one graduated. */
export async function loadAlumniLeaderboard(limit = 10): Promise<LeaderboardEntry[]> {
  const alumni = await prisma.user.findMany({
    where: { ...LAB_MEMBER_WHERE, membershipStatus: "Alumni" },
    select: { id: true, firstName: true, lastName: true, photoUrl: true, classYear: true, graduatedAt: true },
  });
  if (alumni.length === 0) return [];
  const ids = alumni.map((a) => a.id);
  const userId = { in: ids };

  const [taught, chats, sessions, meetings] = await Promise.all([
    prisma.instructorAssignment.findMany({
      where: { userId },
      select: { userId: true, term: { select: { endDate: true } } },
    }),
    prisma.coffeeChatInvite.findMany({
      where: { status: "Accepted", OR: [{ senderId: userId }, { recipientId: userId }] },
      select: { senderId: true, recipientId: true, respondedAt: true, createdAt: true },
    }),
    prisma.educationAttendance.findMany({
      where: { status: "Present", application: { applicantUserId: userId } },
      select: { application: { select: { applicantUserId: true } }, session: { select: { datetime: true } } },
    }),
    prisma.meetingAttendance.findMany({
      where: { userId, present: true },
      select: { userId: true, occurrenceStart: true },
    }),
  ]);

  const events: EngagementEvent[] = [
    // A term taught counts if it ended after graduation.
    ...taught.map((t) => ({ userId: t.userId, kind: "taught" as const, at: t.term.endDate })),
    // Both people in an accepted chat get the points.
    ...chats.flatMap((c) =>
      [c.senderId, c.recipientId].map((id) => ({
        userId: id,
        kind: "coffeeChats" as const,
        at: c.respondedAt ?? c.createdAt,
      })),
    ),
    ...sessions.map((s) => ({
      userId: s.application.applicantUserId,
      kind: "sessions" as const,
      at: s.session.datetime,
    })),
    ...meetings.map((m) => ({ userId: m.userId, kind: "meetings" as const, at: m.occurrenceStart })),
  ];

  const counts = countEngagement(
    alumni.map((a) => ({
      id: a.id,
      alumSince: a.graduatedAt ?? (a.classYear ? commencementDate(a.classYear) : null),
    })),
    events,
  );

  const top = rankLeaderboard(
    alumni.map((a) => {
      const c = counts.get(a.id)!;
      return { alum: a, name: fullName(a) || "Alum", counts: c, score: engagementScore(c) };
    }),
    limit,
  );
  return Promise.all(
    top.map(async ({ alum, name, counts: c, score }) => ({
      id: alum.id,
      name,
      photoUrl: await resolvePhotoUrl(alum.photoUrl),
      classYear: alum.classYear,
      score,
      counts: c,
    })),
  );
}
