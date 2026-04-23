import { prisma } from "~/lib/db";

// A cycle is "active" when its latest status is Open or UnderReview — those are
// the stages where applicants are submitting and reviewers are reading/interviewing.
// Draft and Completed are not active. By convention we enforce at most one active
// cycle at a time (see api.cycles.$cycleId.status.ts).
export const ACTIVE_STATUSES = ["Open", "UnderReview"] as const;
export type ActiveStatus = (typeof ACTIVE_STATUSES)[number];

/**
 * Find the single currently-active cycle, or null if none.
 *
 * If the invariant is somehow violated (multiple cycles active at once),
 * returns the most recently created one and the caller can ignore the rest.
 */
export async function getActiveCycle() {
  const cycles = await prisma.applicationCycle.findMany({
    include: {
      statusUpdates: { orderBy: { createdAt: "desc" }, take: 1 },
    },
    orderBy: { createdAt: "desc" },
  });

  for (const cycle of cycles) {
    const latest = cycle.statusUpdates[0]?.newStatus;
    if (latest && (ACTIVE_STATUSES as readonly string[]).includes(latest)) {
      // Auto-close: if cycle is Open and past its close date, transition to UnderReview
      if (latest === "Open" && cycle.closeDate && new Date() > cycle.closeDate) {
        const alreadyClosed = await prisma.applicationCycleStatusUpdate.findFirst({
          where: { applicationCycleId: cycle.id, newStatus: "UnderReview" },
        });
        if (!alreadyClosed) {
          await prisma.applicationCycleStatusUpdate.create({
            data: { applicationCycleId: cycle.id, newStatus: "UnderReview" },
          });
        }
        return { ...cycle, currentStatus: "UnderReview" as ActiveStatus };
      }
      return { ...cycle, currentStatus: latest as ActiveStatus };
    }
  }
  return null;
}

export type CycleStage =
  | 'challengeSetup'
  | 'challengesReady'
  | 'applicationsOpen'
  | 'readingApplications'
  | 'writtenDelibs'
  | 'collectingAvailability'
  | 'interviews'
  | 'finalDelibs'

/** Map DB cycle status → mentor-facing stage. */
export function cycleStatusToStage(status: string): CycleStage {
  switch (status) {
    case 'Open': return 'applicationsOpen'
    case 'UnderReview': return 'readingApplications' // refined by inferUnderReviewStage
    default: return 'challengeSetup'
  }
}

/**
 * Infer the sub-stage within UnderReview from actual data.
 * `reviewerIds` are the CycleReviewer IDs for this member in this cycle.
 */
export async function inferUnderReviewStage(
  cycleId: string,
  memberId: string,
  reviewerIds: string[],
): Promise<CycleStage> {
  const invitedDecisions = await prisma.decision.count({
    where: {
      stage: "Released",
      type: "InvitedToInterview",
      domainApplication: { application: { applicationCycleId: cycleId } },
    },
  });

  if (invitedDecisions === 0) {
    return 'readingApplications';
  }

  // Even after some applicants are invited, reviewers with assigned reviews
  // should still see the reviews stage so they can access their review work.
  if (reviewerIds.length > 0) {
    const hasReviews = await prisma.applicationReview.count({
      where: { cycleReviewerId: { in: reviewerIds } },
    });
    if (hasReviews > 0) return 'readingApplications';
  }

  const completedInterviews = await prisma.interview.count({
    where: { applicationCycleId: cycleId, status: "Completed" },
  });

  const terminalDecisions = await prisma.decision.count({
    where: {
      stage: "Released",
      type: { in: ["Accepted", "Rejected", "Waitlisted"] },
      domainApplication: { application: { applicationCycleId: cycleId } },
    },
  });

  if (terminalDecisions > 0) return 'finalDelibs';
  if (completedInterviews > 0) return 'finalDelibs';

  const myInterviewerRecords = await prisma.cycleInterviewer.findMany({
    where: { daliMemberId: memberId, applicationCycleId: cycleId },
    select: { id: true },
  });

  if (myInterviewerRecords.length > 0) {
    const interviewerIds = myInterviewerRecords.map(r => r.id);
    const scheduledInterviews = await prisma.interviewAssignment.count({
      where: { cycleInterviewerId: { in: interviewerIds }, status: "Active" },
    });
    if (scheduledInterviews > 0) return 'interviews';
  }

  return 'collectingAvailability';
}

/**
 * Returns the id of any *other* cycle (i.e. not `excludingCycleId`) that is
 * currently active, or null if none. Used to enforce single-active-cycle when
 * advancing a cycle into Open.
 */
export async function findOtherActiveCycleId(
  excludingCycleId: string,
): Promise<string | null> {
  const active = await getActiveCycle();
  if (!active || active.id === excludingCycleId) return null;
  return active.id;
}
