import { prisma } from "~/lib/db";
import type { Prisma, EduApplicationStatus } from "~/generated/prisma/client";
import { logAuditEvent } from "~/lib/audit";
import { lockOffering, approvedCount, nextWaitlistRank } from "./apply.server";
import { notifyApplicationStatus } from "./notifications.server";

export type DecisionResult =
  | { ok: true; status: EduApplicationStatus; promotedApplicationId: string | null }
  | { error: string; status: number };

const DECIDABLE: EduApplicationStatus[] = [
  "Approved",
  "Rejected",
  "Waitlisted",
  "Withdrawn",
];

/**
 * Move an application to a new status. One transition path for managers
 * (any target status) and applicant self-withdrawal (Withdrawn only —
 * enforced by the callers). Frees seats trigger FIFO waitlist promotion in
 * the same transaction; notifications go out after commit.
 */
export async function decideApplication(args: {
  applicationId: string;
  // Scopes the decision to a single offering so a manager of offering A can
  // never act on an application belonging to offering B. Self-scoped here (not
  // just at the route) to match updateAssignment/saveAttendance.
  offeringId: string;
  status: EduApplicationStatus;
  actorId: string;
}): Promise<DecisionResult> {
  if (!DECIDABLE.includes(args.status)) {
    return { error: "Invalid decision.", status: 400 };
  }
  const application = await prisma.educationApplication.findUnique({
    where: { id: args.applicationId },
    select: {
      id: true,
      status: true,
      waitlistRank: true,
      offeringId: true,
      offering: { select: { capacity: true } },
    },
  });
  if (!application || application.offeringId !== args.offeringId) {
    return { error: "Application not found.", status: 404 };
  }
  if (application.status === args.status) {
    return { ok: true, status: args.status, promotedApplicationId: null };
  }

  let promotedApplicationId: string | null = null;
  try {
    promotedApplicationId = await prisma.$transaction(async (tx) => {
      await lockOffering(tx, application.offeringId);

      const previous = application.status;
      const previousRank = application.waitlistRank;

      let waitlistRank: number | null = null;
      if (args.status === "Approved") {
        const approved = await approvedCount(tx, application.offeringId);
        if (approved >= application.offering.capacity) {
          throw new DecisionError(
            "This offering is at capacity — raise the capacity or waitlist instead.",
          );
        }
      } else if (args.status === "Waitlisted") {
        waitlistRank = await nextWaitlistRank(tx, application.offeringId);
      }

      await tx.educationApplication.update({
        where: { id: application.id },
        data: {
          status: args.status,
          waitlistRank,
          reviewedAt: new Date(),
          reviewedBy: args.actorId,
        },
      });

      // Leaving the waitlist compacts the FIFO ranks behind the departure.
      if (previous === "Waitlisted" && previousRank != null) {
        await decrementRanksAbove(tx, application.offeringId, previousRank);
      }

      // Any move off an approved seat frees it — pull the front of the waitlist
      // in, atomically. That covers Rejected/Withdrawn and a demotion back to
      // Waitlisted. On a demotion we exclude the just-demoted applicant (who was
      // appended to the back above) so they can't immediately bounce into the
      // seat they were moved out of; the person who's been waiting longest
      // takes it instead. If they're the only one waiting, nobody is promoted.
      if (previous === "Approved" && args.status !== "Approved") {
        return promoteFromWaitlist(
          tx,
          application.offeringId,
          application.offering.capacity,
          application.id,
        );
      }
      return null;
    });
  } catch (err) {
    if (err instanceof DecisionError) return { error: err.message, status: 400 };
    throw err;
  }

  await logAuditEvent({
    action: "education.application.decision",
    userId: args.actorId,
    targetId: args.applicationId,
    metadata: { status: args.status, offeringId: application.offeringId },
  });
  await notifyApplicationStatus(args.applicationId);
  if (promotedApplicationId) {
    await logAuditEvent({
      action: "education.waitlist.promote",
      userId: args.actorId,
      targetId: promotedApplicationId,
      metadata: { offeringId: application.offeringId },
    });
    await notifyApplicationStatus(promotedApplicationId, { promoted: true });
  }
  return { ok: true, status: args.status, promotedApplicationId };
}

/**
 * Approve every Submitted application in FIFO order until capacity is reached.
 * Each goes through decideApplication (atomic capacity guard), so this stops
 * cleanly at the seat limit and leaves the rest Submitted.
 */
export async function approveAllPending(args: {
  offeringId: string;
  actorId: string;
}): Promise<{ approved: number; skipped: number }> {
  const pending = await prisma.educationApplication.findMany({
    where: { offeringId: args.offeringId, status: "Submitted" },
    orderBy: { submittedAt: "asc" },
    select: { id: true },
  });
  let approved = 0;
  for (const p of pending) {
    const result = await decideApplication({
      applicationId: p.id,
      offeringId: args.offeringId,
      status: "Approved",
      actorId: args.actorId,
    });
    if ("ok" in result) approved += 1;
    else break; // at capacity (or error) — leave the remainder for review
  }
  return { approved, skipped: pending.length - approved };
}

class DecisionError extends Error {}

async function decrementRanksAbove(
  tx: Prisma.TransactionClient,
  offeringId: string,
  rank: number,
): Promise<void> {
  await tx.educationApplication.updateMany({
    where: {
      offeringId,
      status: "Waitlisted",
      waitlistRank: { gt: rank },
    },
    data: { waitlistRank: { decrement: 1 } },
  });
}

/**
 * Promote the front of the waitlist into a freed seat. Caller must hold the
 * offering row lock. `excludeApplicationId` skips a specific application — used
 * on a demotion so the just-demoted applicant isn't re-promoted into the seat
 * they were moved out of. Returns the promoted application id, or null when the
 * waitlist is empty (after the exclusion) or the offering is still full.
 */
export async function promoteFromWaitlist(
  tx: Prisma.TransactionClient,
  offeringId: string,
  capacity: number,
  excludeApplicationId?: string,
): Promise<string | null> {
  if ((await approvedCount(tx, offeringId)) >= capacity) return null;
  const next = await tx.educationApplication.findFirst({
    where: {
      offeringId,
      status: "Waitlisted",
      ...(excludeApplicationId ? { id: { not: excludeApplicationId } } : {}),
    },
    orderBy: [{ waitlistRank: "asc" }, { submittedAt: "asc" }],
    select: { id: true, waitlistRank: true },
  });
  if (!next) return null;
  await tx.educationApplication.update({
    where: { id: next.id },
    data: { status: "Approved", waitlistRank: null },
  });
  if (next.waitlistRank != null) {
    await decrementRanksAbove(tx, offeringId, next.waitlistRank);
  }
  return next.id;
}

/**
 * Manually reorder the waitlist by swapping an application with its neighbour
 * in the given direction. Auto-promotion always pulls the lowest rank first, so
 * moving someone up means they're enrolled sooner when a seat frees. A no-op
 * (still ok) at the ends of the list. Not a status change — no notification.
 */
export async function moveWaitlistEntry(args: {
  applicationId: string;
  offeringId: string;
  direction: "up" | "down";
  actorId: string;
}): Promise<DecisionResult> {
  const application = await prisma.educationApplication.findUnique({
    where: { id: args.applicationId },
    select: { id: true, status: true, offeringId: true },
  });
  if (!application || application.offeringId !== args.offeringId) {
    return { error: "Application not found.", status: 404 };
  }
  if (application.status !== "Waitlisted") {
    return { error: "Only waitlisted applicants can be reordered.", status: 400 };
  }

  await prisma.$transaction(async (tx) => {
    await lockOffering(tx, args.offeringId);
    // Re-read the rank under the lock — it shifts as others are promoted/removed.
    const self = await tx.educationApplication.findUnique({
      where: { id: application.id },
      select: { status: true, waitlistRank: true },
    });
    if (!self || self.status !== "Waitlisted" || self.waitlistRank == null) return;

    const neighbour = await tx.educationApplication.findFirst({
      where: {
        offeringId: args.offeringId,
        status: "Waitlisted",
        waitlistRank:
          args.direction === "up"
            ? { lt: self.waitlistRank }
            : { gt: self.waitlistRank },
      },
      orderBy: { waitlistRank: args.direction === "up" ? "desc" : "asc" },
      select: { id: true, waitlistRank: true },
    });
    if (!neighbour || neighbour.waitlistRank == null) return; // already at the end

    // Swap the two ranks. No unique constraint on waitlistRank, so the direct
    // two-step swap needs no scratch value.
    await tx.educationApplication.update({
      where: { id: application.id },
      data: { waitlistRank: neighbour.waitlistRank },
    });
    await tx.educationApplication.update({
      where: { id: neighbour.id },
      data: { waitlistRank: self.waitlistRank },
    });
  });

  await logAuditEvent({
    action: "education.waitlist.reorder",
    userId: args.actorId,
    targetId: args.applicationId,
    metadata: { offeringId: args.offeringId, direction: args.direction },
  });
  return { ok: true, status: "Waitlisted", promotedApplicationId: null };
}

/** Applicant self-withdrawal — the only decision an applicant may make. */
export async function withdrawApplication(args: {
  userId: string;
  offeringId: string;
}): Promise<DecisionResult> {
  const application = await prisma.educationApplication.findUnique({
    where: {
      applicantUserId_offeringId: {
        applicantUserId: args.userId,
        offeringId: args.offeringId,
      },
    },
    select: { id: true, status: true },
  });
  if (!application) return { error: "No application to withdraw.", status: 404 };
  if (application.status === "Withdrawn" || application.status === "Rejected") {
    return { error: "This application is already closed.", status: 400 };
  }
  const result = await decideApplication({
    applicationId: application.id,
    offeringId: args.offeringId,
    status: "Withdrawn",
    actorId: args.userId,
  });
  if ("ok" in result) {
    await logAuditEvent({
      action: "education.application.withdraw",
      userId: args.userId,
      targetId: application.id,
      metadata: { offeringId: args.offeringId },
    });
  }
  return result;
}
