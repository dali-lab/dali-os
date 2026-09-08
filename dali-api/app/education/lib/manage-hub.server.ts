import { prisma } from "~/lib/db";
import { getAttendanceMatrix } from "./attendance.server";
import { certificateEligibility } from "./certificates.server";

/**
 * The journey band's "current stop" pick, mirrored server-side so the hub
 * loader can default the mark-by-hand roster to it: in-progress session, else
 * next upcoming, else the last one.
 */
export function currentJourneySessionId(
  sessions: { id: string; datetime: Date | string; endsAt: Date | string | null }[],
): string | null {
  const now = Date.now();
  const inProgress = sessions.find((s) => {
    const start = new Date(s.datetime).getTime();
    const end = s.endsAt ? new Date(s.endsAt).getTime() : start;
    return now >= start && now <= end;
  });
  if (inProgress) return inProgress.id;
  const upcoming = sessions
    .filter((s) => new Date(s.datetime).getTime() > now)
    .sort((a, b) => new Date(a.datetime).getTime() - new Date(b.datetime).getTime())[0];
  return upcoming?.id ?? sessions[sessions.length - 1]?.id ?? null;
}

/**
 * Everything the course page adds when a manager views it in Editing mode:
 * journey-band rollups (per-session present counts, "N will earn it") and the
 * header badges (pending applications, offering status). Kept separate from
 * getHubData so the student path never pays for it.
 */
export async function getInstructorHubExtras(offeringId: string) {
  const [offering, matrix, applicationStatusCounts] = await Promise.all([
    prisma.educationOffering.findUnique({
      where: { id: offeringId },
      select: {
        id: true,
        type: true,
        status: true,
        closedOutAt: true,
        completionThreshold: true,
        capacity: true,
      },
    }),
    getAttendanceMatrix(offeringId),
    prisma.educationApplication.groupBy({
      by: ["status"],
      where: { offeringId },
      _count: { _all: true },
    }),
  ]);
  if (!offering) return null;

  const presentBySession: Record<string, number> = {};
  for (const session of matrix.sessions) {
    presentBySession[session.id] = matrix.students.filter(
      (st) => st.marks[session.id] === "Present",
    ).length;
  }

  const willEarnCount = matrix.students.filter((st) => {
    const values = Object.values(st.marks);
    return certificateEligibility({
      type: offering.type as "Miniseries" | "Workshop",
      totalSessions: matrix.sessions.length,
      present: values.filter((m) => m === "Present").length,
      excused: values.filter((m) => m === "Excused").length,
      threshold: offering.completionThreshold,
    });
  }).length;

  const countsByStatus = Object.fromEntries(
    applicationStatusCounts.map((row) => [row.status, row._count._all]),
  ) as Record<string, number>;

  return {
    offeringStatus: offering.status,
    closedOutAt: offering.closedOutAt,
    capacity: offering.capacity,
    approvedCount: matrix.students.length,
    presentBySession,
    willEarnCount,
    applicationCounts: {
      submitted: countsByStatus.Submitted ?? 0,
      approved: countsByStatus.Approved ?? 0,
      waitlisted: countsByStatus.Waitlisted ?? 0,
      rejected: countsByStatus.Rejected ?? 0,
      withdrawn: countsByStatus.Withdrawn ?? 0,
    },
  };
}
