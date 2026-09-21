import { prisma } from "~/lib/db";
import {
  domainApplicationStatusInclude,
  inferDomainApplicationStatus,
} from "./domain-application-status";
import type { ApplicationCycleStatus } from "~/generated/prisma/enums";
import type { DomainApplicationStatus } from "~/types";

// An applicant's own hiring history — every cycle they've applied to, newest
// first, with the per-domain outcome resolved against that cycle's status. The
// portal home lists these; /portal/hiring stays the interactive tracker for the
// current one (interview booking, decisions).

export type HiringHistoryEntry = {
  id: string;
  cycleId: string;
  cycleName: string;
  /** Draft | Submitted | Withdrawn — the applicant's own progress, not the lab's. */
  applicationStatus: "Draft" | "Submitted" | "Withdrawn";
  submittedAt: Date | null;
  domains: { id: string; domainName: string; status: DomainApplicationStatus }[];
};

type StatusUpdate = { newStatus: string; createdAt: Date };

/**
 * An application's overall status from its update log. Withdrawn always follows
 * Submitted, so the newest entry wins over "has ever been submitted".
 */
export function overallApplicationStatus(
  updates: StatusUpdate[],
): HiringHistoryEntry["applicationStatus"] {
  const latest = updates
    .slice()
    .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())[0]?.newStatus;
  if (latest === "Withdrawn") return "Withdrawn";
  return updates.some((u) => u.newStatus === "Submitted") ? "Submitted" : "Draft";
}

export async function listMyHiringApplications(
  userId: string,
): Promise<HiringHistoryEntry[]> {
  const applications = await prisma.application.findMany({
    where: { userId },
    orderBy: { createdAt: "desc" },
    include: {
      statusUpdates: true,
      applicationCycle: {
        select: {
          id: true,
          name: true,
          statusUpdates: {
            orderBy: { createdAt: "desc" },
            take: 1,
            select: { newStatus: true },
          },
        },
      },
      domainApplications: {
        where: { selected: true },
        include: { ...domainApplicationStatusInclude, domain: true },
      },
    },
  });

  return applications.map((a) => {
    const cycleStatus = (a.applicationCycle.statusUpdates[0]?.newStatus ??
      "Draft") as ApplicationCycleStatus;
    const submitted = a.statusUpdates
      .filter((u) => u.newStatus === "Submitted")
      .sort((x, y) => x.createdAt.getTime() - y.createdAt.getTime())[0];
    return {
      id: a.id,
      cycleId: a.applicationCycle.id,
      cycleName: a.applicationCycle.name,
      applicationStatus: overallApplicationStatus(a.statusUpdates),
      submittedAt: submitted?.createdAt ?? null,
      domains: a.domainApplications.map((da) => ({
        id: da.id,
        domainName: da.domain?.name ?? "Unknown",
        status: inferDomainApplicationStatus(da, cycleStatus),
      })),
    };
  });
}
