import type {
  DomainApplicationGetPayload,
  DomainApplicationInclude,
} from "~/generated/prisma/models/DomainApplication";
import type { ApplicationCycleStatus } from "~/generated/prisma/enums";
import type { DomainApplicationStatus } from "~/types";

// ─── Include fragment ─────────────────────────────────────────────────────────

/**
 * Prisma include fragment for a DomainApplication that loads all relations
 * required by `inferDomainApplicationStatus`. Spread this into any
 * `domainApplication.findUnique / findMany` call that needs to compute status.
 *
 * Example:
 *   const da = await prisma.domainApplication.findUniqueOrThrow({
 *     where: { id },
 *     include: domainApplicationStatusInclude,
 *   });
 *   const status = inferDomainApplicationStatus(da, cycleStatus);
 */
export const domainApplicationStatusInclude = {
  application: {
    include: {
      statusUpdates: true,
    },
  },
  // Ordered newest-first so the first Released entry we encounter is the latest.
  decisions: {
    orderBy: { createdAt: "desc" as const },
  },
  // A DomainApplication can accumulate historical Interview rows across
  // attempts. We include Scheduled, Completed, and CancelledByApplicant rows
  // so the status derivation can detect applicant withdrawals (cancelled
  // with nothing rebooked). CancelledByAdmin rows are admin-initiated and
  // don't count as withdrawal.
  interviews: {
    where: {
      status: { in: ["Scheduled", "Completed", "CancelledByApplicant"] as const },
    },
    orderBy: { createdAt: "desc" as const },
  },
} satisfies DomainApplicationInclude;

// ─── Inferred input type ──────────────────────────────────────────────────────

type DomainApplicationWithStatusRelations = DomainApplicationGetPayload<{
  include: typeof domainApplicationStatusInclude;
}>;

// ─── inferDomainApplicationStatus ────────────────────────────────────────────

/**
 * Derives a `DomainApplicationStatus` from a domain application's loaded
 * relations and the enclosing cycle's current status. No database calls are
 * made — all required data must already be loaded (use
 * `domainApplicationStatusInclude` to fetch it).
 *
 * Decision tree (evaluated in order):
 *  1. cycle Open  AND  no Submitted status update          → ApplicationOpen
 *  2. Has Submitted update AND no Released decision         → Pending
 *  3. Latest Released decision type == Rejected             → Rejected
 *  4. Latest Released decision type == InvitedToInterview
 *     AND no interview record exists                        → InvitedToInterview
 *  5. Latest Released decision type == InvitedToInterview
 *     AND interview.status == Scheduled                     → InterviewScheduled
 *  6. interview.status == Completed
 *     AND latest Released decision == InvitedToInterview    → PostInterviewPending
 *  6b. No Scheduled/Completed interview but a
 *      CancelledByApplicant interview exists                → Withdrawn
 *  7. Latest Released decision type == Accepted             → Accepted
 *  8. Latest Released decision type == Waitlisted           → Waitlisted
 */
export function inferDomainApplicationStatus(
  domainApplication: DomainApplicationWithStatusRelations,
  cycleStatus: ApplicationCycleStatus,
): DomainApplicationStatus {
  const { application, decisions, interviews } = domainApplication;

  const hasSubmitted = application.statusUpdates.some(
    (u) => u.newStatus === "Submitted",
  );

  // Step 1: cycle is open and application has not been submitted yet
  if (cycleStatus === "Open" && !hasSubmitted) {
    return "ApplicationOpen";
  }

  // Decisions are ordered desc by createdAt, so the first Released entry is the latest.
  const latestReleased = decisions.find((d) => d.stage === "Released") ?? null;

  // Step 2: submitted but no Released decision yet
  if (hasSubmitted && !latestReleased) {
    return "Pending";
  }

  // Steps 3–8 all require a Released decision. Guard against edge cases where
  // the cycle has advanced past Open but the application was never submitted.
  if (!latestReleased) {
    return "Pending";
  }

  const decisionType = latestReleased.type;

  // Step 3
  if (decisionType === "Rejected") {
    return "Rejected";
  }

  if (decisionType === "InvitedToInterview") {
    // interviews[] is pre-filtered to Scheduled|Completed|CancelledByApplicant
    // rows by the include fragment.
    const scheduled = interviews.find((i) => i.status === "Scheduled");
    const completed = interviews.find((i) => i.status === "Completed");
    const cancelledByApplicant = interviews.find((i) => i.status === "CancelledByApplicant");

    if (scheduled) {
      // Step 5: a future interview is on the calendar
      return "InterviewScheduled";
    }
    if (completed) {
      // Step 6: interview happened, decision hasn't advanced
      return "PostInterviewPending";
    }
    if (cancelledByApplicant) {
      // Step 6b: applicant cancelled — treat as withdrawal
      return "Withdrawn";
    }
    // Step 4: invited but nothing booked yet
    return "InvitedToInterview";
  }

  // Step 7
  if (decisionType === "Accepted") {
    return "Accepted";
  }

  // Step 8
  if (decisionType === "Waitlisted") {
    return "Waitlisted";
  }

  // TypeScript exhaustiveness guard — all DecisionType values are handled above
  const _exhaustive: never = decisionType;
  throw new Error(`Unhandled decision type: ${_exhaustive}`);
}
