import { prisma } from "~/lib/db";

// A user's upcoming education sessions, drawn from the offerings they're
// approved into. Shared by the calendar (member) and the portal home
// (Dartmouth students) so both surface "when's my next class" from one query.
// Enrollment is the gate — the same Approved-application predicate the hub uses
// — so this works identically for members and portal users.

export type UpcomingSession = {
  id: string;
  offeringId: string;
  offeringTitle: string;
  sequence: number;
  datetime: Date;
  location: string | null;
};

export async function listUpcomingSessionsForUser(
  userId: string,
  opts: { from?: Date; to?: Date; limit?: number } = {},
): Promise<UpcomingSession[]> {
  const from = opts.from ?? new Date();
  const sessions = await prisma.educationSession.findMany({
    where: {
      datetime: { gte: from, ...(opts.to ? { lte: opts.to } : {}) },
      offering: {
        status: "Published",
        applications: { some: { applicantUserId: userId, status: "Approved" } },
      },
    },
    orderBy: { datetime: "asc" },
    ...(opts.limit ? { take: opts.limit } : {}),
    select: {
      id: true,
      sequence: true,
      datetime: true,
      location: true,
      offering: { select: { id: true, title: true } },
    },
  });
  return sessions.map((s) => ({
    id: s.id,
    offeringId: s.offering.id,
    offeringTitle: s.offering.title,
    sequence: s.sequence,
    datetime: s.datetime,
    location: s.location,
  }));
}
