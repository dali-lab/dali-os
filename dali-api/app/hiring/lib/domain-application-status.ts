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
    include: { room: { select: { id: true, name: true } } },
  },
} satisfies DomainApplicationInclude;

// ─── Inferred input type ──────────────────────────────────────────────────────

type DomainApplicationWithStatusRelations = DomainApplicationGetPayload<{
  include: typeof domainApplicationStatusInclude;
}>;

// ─── inferDomainApplicationStatus ────────────────────────────────────────────

/**
 * Derives a `DomainApplicationStatus` from a domain application's loaded
 * relations. No database calls are made — all required data must already be
 * loaded (use `domainApplicationStatusInclude` to fetch it).
 *
 * `cycleStatus` is accepted for signature compatibility with existing callers
 * but is otherwise unused: ApplicationOpen now keys off this DA's own
 * `submittedAt` rather than the cycle's status, so a domain added after the
 * applicant's first submission (and therefore never itself submitted) reads
 * as ApplicationOpen even once the cycle has moved past Open.
 *
 * Decision tree (evaluated in order):
 *  1. Application has a Withdrawn status update              → Withdrawn
 *  2. closureReason == AcceptedElsewhere                      → AcceptedElsewhere
 *  3. This DA's submittedAt is null                           → ApplicationOpen
 *  4. submittedAt set AND no Released decision                → Pending
 *  5. Latest Released decision type == Rejected                → Rejected
 *  6. Latest Released decision type == InvitedToInterview
 *     AND no interview record exists                          → InvitedToInterview
 *  7. Latest Released decision type == InvitedToInterview
 *     AND interview.status == Scheduled                       → InterviewScheduled
 *  8. interview.status == Completed
 *     AND latest Released decision == InvitedToInterview      → PostInterviewPending
 *  8b. No Scheduled/Completed interview but a
 *      CancelledByApplicant interview exists                  → Withdrawn
 *  9. Latest Released decision type == Accepted                → Accepted
 *  10. Latest Released decision type == Waitlisted              → Waitlisted
 */
export function inferDomainApplicationStatus(
  domainApplication: DomainApplicationWithStatusRelations,
  cycleStatus: ApplicationCycleStatus,
): DomainApplicationStatus {
  const { application, decisions, interviews } = domainApplication;

  const hasWithdrawn = application.statusUpdates.some(
    (u) => u.newStatus === "Withdrawn",
  );

  // Step 1: applicant withdrew after submission. Withdrawal is terminal
  // today (see portal.application.tsx) and is the applicant's own action, so it
  // wins over every derived branch below.
  if (hasWithdrawn) {
    return "Withdrawn";
  }

  // Step 2: this DA was administratively closed because the applicant was
  // accepted into another domain in the same cycle (single placement). Only
  // ever set on DAs with no Released decision, so it never overrides a real
  // outcome — it replaces what would otherwise be a stale "Pending".
  if (domainApplication.closureReason === "AcceptedElsewhere") {
    return "AcceptedElsewhere";
  }

  // Step 3: this DA has never itself been submitted — whether because the
  // applicant hasn't submitted at all yet, or because the domain was added
  // (or reopened) after their last submission.
  if (!domainApplication.submittedAt) {
    return "ApplicationOpen";
  }

  // Decisions are ordered desc by createdAt, so the first Released entry is the latest.
  const latestReleased = decisions.find((d) => d.stage === "Released") ?? null;

  // Step 4: submitted but no Released decision yet
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
