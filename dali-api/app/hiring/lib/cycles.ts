import { prisma } from "~/lib/db.server";
import { cachedForTtl, clearTtlCache } from "~/lib/ttl-cache";
import type { ApplicationCycleStatus, CycleApplicants } from "~/generated/prisma/enums";
import { cycleCloseDate } from "./domain-windows";

// A cycle is "active" when its latest status is Open or UnderReview — those are
// the stages where applicants are submitting and reviewers are reading/interviewing.
// Draft and Completed are not active. Any number of cycles may be active at once.
export const ACTIVE_STATUSES = ["Open", "UnderReview"] as const;
export type ActiveStatus = (typeof ACTIVE_STATUSES)[number];

const withLatestStatus = {
  statusUpdates: { orderBy: { createdAt: "desc" as const }, take: 1 },
  domains: { where: { isReady: true }, select: { domainId: true, closeDate: true } },
};

type CycleWithWindows = {
  closeDate: Date | null;
  domains: { closeDate: Date | null }[];
  statusUpdates: { newStatus: string }[];
};

function isPastClose(cycle: CycleWithWindows): boolean {
  const close = cycleCloseDate(cycle.domains, cycle);
  return close !== null && new Date() > close;
}

/** The cycle's latest status, with an Open cycle past its close (its last ready domain's) read as UnderReview. */
export function derivedCycleStatus(cycle: CycleWithWindows): ApplicationCycleStatus {
  const latest = (cycle.statusUpdates[0]?.newStatus ?? "Draft") as ApplicationCycleStatus;
  return latest === "Open" && isPastClose(cycle) ? "UnderReview" : latest;
}

// The DB write for a derived UnderReview is materialized lazily by
// autoCloseIfExpired (called from the status loader).
function withCurrentStatus<C extends CycleWithWindows>(
  cycle: C,
): (C & { currentStatus: ActiveStatus }) | null {
  if (cycle.statusUpdates.length === 0) return null;
  const status = derivedCycleStatus(cycle);
  if (!(ACTIVE_STATUSES as readonly string[]).includes(status)) return null;
  return { ...cycle, currentStatus: status as ActiveStatus };
}

/**
 * Every currently-active cycle, optionally for one applicant group, newest
 * first. Pure read: an Open cycle past its `closeDate` comes back with
 * `currentStatus` UnderReview; the DB row is materialized separately via
 * `autoCloseIfExpired`.
 */
// The layout loader reads this on every navigation. Status changes go through
// `invalidateActiveCycles()`, so the only staleness is cross-machine (≤ TTL).
const ACTIVE_CYCLES_TTL_MS = 30_000;

export function invalidateActiveCycles(): void {
  clearTtlCache("hiring:activeCycles");
}

export async function getActiveCycles(filter: { applicants?: CycleApplicants } = {}) {
  const cycles = await cachedForTtl(
    `hiring:activeCycles:${filter.applicants ?? ""}`,
    ACTIVE_CYCLES_TTL_MS,
    () =>
      prisma.applicationCycle.findMany({
        where: {
          ...(filter.applicants && { applicants: filter.applicants }),
          statusUpdates: {
            some: { newStatus: { in: ACTIVE_STATUSES as unknown as ApplicationCycleStatus[] } },
          },
        },
        include: withLatestStatus,
        orderBy: { createdAt: "desc" },
      }),
  );
  return cycles.map(withCurrentStatus).filter((c) => c !== null);
}

export type ActiveCycle = Awaited<ReturnType<typeof getActiveCycles>>[number];

/** Active cycles still taking applications (Open and before their close date). */
export async function getOpenCycles(filter: { applicants?: CycleApplicants } = {}) {
  return (await getActiveCycles(filter)).filter((c) => c.currentStatus === "Open");
}

/** One cycle, if it's active, with the same derived status. */
export async function getActiveCycleById(cycleId: string): Promise<ActiveCycle | null> {
  const cycle = await prisma.applicationCycle.findUnique({
    where: { id: cycleId },
    include: withLatestStatus,
  });
  return cycle ? withCurrentStatus(cycle) : null;
}

/**
 * Materialize the auto-close transition for a cycle whose `closeDate` has
 * passed while it was still `Open`. Idempotent — safe to call repeatedly. Uses
 * a transaction so concurrent callers can't insert duplicate UnderReview rows.
 */
export async function autoCloseIfExpired(cycleId: string): Promise<void> {
  const cycle = await prisma.applicationCycle.findUnique({
    where: { id: cycleId },
    include: withLatestStatus,
  });
  if (!cycle) return;

  const currentStatus = cycle.statusUpdates[0]?.newStatus ?? "Draft";
  if (currentStatus !== "Open") return;
  if (!isPastClose(cycle)) return;

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
  invalidateActiveCycles();
}
