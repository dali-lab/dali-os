import { prisma } from "~/lib/db";
import type { ApplicationCycleStatus } from "~/generated/prisma/enums";

// A cycle is "active" when its latest status is Open or UnderReview — those are
// the stages where applicants are submitting and reviewers are reading/interviewing.
// Draft and Completed are not active. By convention we enforce at most one active
// cycle at a time (see api.cycles.$cycleId.status.ts).
export const ACTIVE_STATUSES = ["Open", "UnderReview"] as const;
export type ActiveStatus = (typeof ACTIVE_STATUSES)[number];

/**
 * Find the single currently-active cycle, or null if none.
 *
 * Pure read — does not write. If an Open cycle is past its `closeDate`, the
 * returned `currentStatus` is derived as `UnderReview`; the DB row is
 * materialized separately via `autoCloseIfExpired`.
 *
 * If the invariant is somehow violated (multiple cycles active at once),
 * returns the most recently-active one.
 */
export async function getActiveCycle() {
  const recentActiveUpdate = await prisma.applicationCycleStatusUpdate.findFirst({
    where: { newStatus: { in: ACTIVE_STATUSES as unknown as ApplicationCycleStatus[] } },
    orderBy: { createdAt: "desc" },
    include: {
      applicationCycle: {
        include: {
          statusUpdates: { orderBy: { createdAt: "desc" }, take: 1 },
        },
      },
    },
  });
  if (!recentActiveUpdate) return null;

  const cycle = recentActiveUpdate.applicationCycle;
  const latest = cycle.statusUpdates[0]?.newStatus;
  // Defend against a later non-active update (e.g. Completed) on the same cycle.
  if (!latest || !(ACTIVE_STATUSES as readonly string[]).includes(latest)) {
    return null;
  }

  // Derive UnderReview when an Open cycle is past its close date. The DB write
  // is materialized lazily by autoCloseIfExpired (called from the status loader).
  if (latest === "Open" && cycle.closeDate && new Date() > cycle.closeDate) {
    return { ...cycle, currentStatus: "UnderReview" as ActiveStatus };
  }
  return { ...cycle, currentStatus: latest as ActiveStatus };
}

/**
 * Materialize the auto-close transition for a cycle whose `closeDate` has
 * passed while it was still `Open`. Idempotent — safe to call repeatedly. Uses
 * a transaction so concurrent callers can't insert duplicate UnderReview rows.
 */
export async function autoCloseIfExpired(cycleId: string): Promise<void> {
  const cycle = await prisma.applicationCycle.findUnique({
    where: { id: cycleId },
    include: { statusUpdates: { orderBy: { createdAt: "desc" }, take: 1 } },
  });
  if (!cycle) return;

  const currentStatus = cycle.statusUpdates[0]?.newStatus ?? "Draft";
  if (currentStatus !== "Open") return;
  if (!cycle.closeDate || new Date() <= cycle.closeDate) return;

  await prisma.$transaction(async (tx) => {
    const alreadyClosed = await tx.applicationCycleStatusUpdate.findFirst({
      where: { applicationCycleId: cycleId, newStatus: "UnderReview" },
    });
    if (!alreadyClosed) {
      await tx.applicationCycleStatusUpdate.create({
        data: { applicationCycleId: cycleId, newStatus: "UnderReview", userId: null },
      });
    }
  });
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

/** Map DB cycle status → reviewer-facing stage. */
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
  userId: string,
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
    where: { userId, applicationCycleId: cycleId },
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
