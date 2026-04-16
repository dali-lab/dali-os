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
      return { ...cycle, currentStatus: latest as ActiveStatus };
    }
  }
  return null;
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
