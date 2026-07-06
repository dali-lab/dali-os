import { prisma } from "~/lib/db";
import { getUserRoles } from "~/lib/roles";
import { getActiveCycle } from "./cycles";
import { listActiveWaitlistEntries } from "./waitlist.server";

// Data for the /hiring hub: "what needs me right now", filtered by role.
// Personal cards (reviews, interviews) load for anyone with hiring access;
// delibs for domain leads; release queue / waitlists / funnel for Core.

export type HubDecisionRow = {
  domainApplicationId: string;
  stage: "Draft" | "Final" | "Released";
};

/**
 * Domain applications whose decision lineage has reached Final but not yet
 * Released — the hiring lead's release queue. Pure so the lineage rule stays
 * unit-testable: decisions are append-only, so "has a Final row and no
 * Released row" is the queue condition per domain application.
 */
export function releaseQueueCount(decisions: HubDecisionRow[]): number {
  const byDa = new Map<string, { hasFinal: boolean; hasReleased: boolean }>();
  for (const d of decisions) {
    const entry = byDa.get(d.domainApplicationId) ?? {
      hasFinal: false,
      hasReleased: false,
    };
    if (d.stage === "Final") entry.hasFinal = true;
    if (d.stage === "Released") entry.hasReleased = true;
    byDa.set(d.domainApplicationId, entry);
  }
  let count = 0;
  for (const entry of byDa.values()) {
    if (entry.hasFinal && !entry.hasReleased) count += 1;
  }
  return count;
}

export async function getHiringHubData(userId: string) {
  const roles = await getUserRoles(userId);

  // Mirrors the layout's hasHiringAccess derivation: Core/Admin/DomainLead
  // always; other lab members only if they review or interview on any cycle.
  let hasAccess = roles.isCore || roles.isDomainLead;
  if (!hasAccess && roles.isLabMember) {
    const [reviewer, interviewer] = await Promise.all([
      prisma.cycleReviewer.findFirst({ where: { userId }, select: { id: true } }),
      prisma.cycleInterviewer.findFirst({ where: { userId }, select: { id: true } }),
    ]);
    hasAccess = reviewer !== null || interviewer !== null;
  }
  if (!hasAccess) return null;

  const cycle = await getActiveCycle();
  const now = new Date();

  const [pendingReviews, upcomingAssignments] = await Promise.all([
    prisma.applicationReview.count({
      where: { cycleReviewer: { userId }, submittedAt: null },
    }),
    prisma.interviewAssignment.findMany({
      where: {
        status: "Active",
        cycleInterviewer: { userId },
        interview: { status: "Scheduled", startTime: { gte: now } },
      },
      orderBy: { interview: { startTime: "asc" } },
      take: 5,
      select: {
        interview: {
          select: {
            id: true,
            startTime: true,
            endTime: true,
            location: true,
          },
        },
      },
    }),
  ]);

  // Domain-lead lane: active delibs boards for my domains in the active cycle.
  let delibs: { id: string; type: string; domainName: string }[] = [];
  if (roles.isDomainLead && cycle) {
    const myDomains = await prisma.domainLeadAssignment.findMany({
      where: { userId },
      select: { domainId: true },
    });
    if (myDomains.length > 0) {
      const sessions = await prisma.delibsSession.findMany({
        where: {
          applicationCycleId: cycle.id,
          status: "Active",
          domainId: { in: myDomains.map((d) => d.domainId) },
        },
        select: {
          id: true,
          type: true,
          domain: { select: { displayName: true } },
        },
      });
      delibs = sessions.map((s) => ({
        id: s.id,
        type: s.type,
        domainName: s.domain.displayName,
      }));
    }
  }

  // Core lane: release queue, waitlists, and the cycle funnel.
  let core: {
    releaseQueue: number;
    waitlisted: number;
    funnel: { submitted: number; reviewsSubmitted: number; interviews: number };
  } | null = null;
  if (roles.isCore && cycle) {
    const [decisions, waitlist, submitted, reviewsSubmitted, interviews] =
      await Promise.all([
        prisma.decision.findMany({
          where: {
            stage: { in: ["Final", "Released"] },
            domainApplication: { application: { applicationCycleId: cycle.id } },
          },
          select: { domainApplicationId: true, stage: true },
        }),
        listActiveWaitlistEntries(),
        prisma.application.count({
          where: {
            applicationCycleId: cycle.id,
            statusUpdates: { some: { newStatus: "Submitted" } },
          },
        }),
        prisma.applicationReview.count({
          where: {
            submittedAt: { not: null },
            domainApplication: { application: { applicationCycleId: cycle.id } },
          },
        }),
        prisma.interview.count({ where: { applicationCycleId: cycle.id } }),
      ]);
    core = {
      releaseQueue: releaseQueueCount(decisions as HubDecisionRow[]),
      waitlisted: waitlist.length,
      funnel: { submitted, reviewsSubmitted, interviews },
    };
  }

  return {
    roles: {
      isCore: roles.isCore,
      isDomainLead: roles.isDomainLead,
      isAdmin: roles.isAdmin,
    },
    cycle: cycle
      ? {
          id: cycle.id,
          name: cycle.name,
          status: cycle.currentStatus,
          closeDate: cycle.closeDate ?? null,
        }
      : null,
    pendingReviews,
    upcomingInterviews: upcomingAssignments.map((a) => a.interview),
    delibs,
    core,
  };
}
