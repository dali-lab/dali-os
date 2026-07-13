import { prisma } from "~/lib/db";
import { getUserRoles } from "~/lib/roles";
import { getActiveCycle } from "./cycles";
import { getCycleConfidentialityState } from "./confidentiality";
import { listActiveWaitlistEntries } from "./waitlist.server";

// Data for the /hiring hub: "what needs me right now", filtered by role.
// Personal cards (reviews, interviews, confidentiality) load for anyone with
// hiring access; delibs for domain leads; release queue / waitlists / cycle
// health for Core. Every Core number means work remaining, not volume — the
// full pipeline view is the hub's embedded pipeline section (pipeline.server).

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

  // Personal cards carry the actual work items (deep links to the specific
  // review/interview), not counts — the pill row already links the sections.
  const applicantName = {
    application: {
      select: { user: { select: { firstName: true, lastName: true } } },
    },
  } as const;
  const [pendingReviewCount, pendingReviewRows, upcomingAssignments] =
    await Promise.all([
      prisma.applicationReview.count({
        where: { cycleReviewer: { userId }, submittedAt: null },
      }),
      prisma.applicationReview.findMany({
        where: { cycleReviewer: { userId }, submittedAt: null },
        orderBy: { createdAt: "asc" },
        take: 5,
        select: {
          id: true,
          domainApplication: {
            select: {
              applicationId: true,
              domain: { select: { displayName: true } },
              ...applicantName,
            },
          },
        },
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
              domainApplication: { select: applicantName },
            },
          },
        },
      }),
    ]);

  const displayName = (p: { firstName: string | null; lastName: string | null }) =>
    `${p.firstName ?? ""} ${p.lastName ?? ""}`.trim() || "Unknown";

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

  // Personal lane: an unsigned confidentiality agreement blocks reviewing —
  // surface it before anything else. "no_agreement" cycles need nothing.
  let needsConfidentialitySignature: string | null = null;
  if (cycle) {
    const conf = await getCycleConfidentialityState(userId, cycle.id);
    if (conf.status === "unsigned") needsConfidentialitySignature = cycle.id;
  }

  // Core lane: release queue, waitlists, and cycle health (work remaining).
  let core: {
    releaseQueue: number;
    waitlisted: number;
    health: {
      submitted: number;
      unreviewedApps: number;
      reviewsOutstanding: number;
      outstandingByDomain: { domainName: string; count: number }[];
      activeDelibs: number;
    };
  } | null = null;
  if (roles.isCore && cycle) {
    const submittedApplication = {
      applicationCycleId: cycle.id,
      statusUpdates: { some: { newStatus: "Submitted" as const } },
    };
    const [decisions, waitlist, submitted, unreviewedApps, outstandingRows, activeDelibs] =
      await Promise.all([
        prisma.decision.findMany({
          where: {
            stage: { in: ["Final", "Released"] },
            domainApplication: { application: { applicationCycleId: cycle.id } },
          },
          select: { domainApplicationId: true, stage: true },
        }),
        listActiveWaitlistEntries(),
        prisma.application.count({ where: submittedApplication }),
        // Submitted domain applications nobody has reviewed yet — the "is
        // anything slipping through" number.
        prisma.domainApplication.count({
          where: {
            selected: true,
            application: submittedApplication,
            reviews: { none: { submittedAt: { not: null } } },
          },
        }),
        // Assigned-but-unsubmitted reviews, kept as rows so the card can
        // break the backlog down by domain.
        prisma.applicationReview.findMany({
          where: {
            submittedAt: null,
            domainApplication: { application: { applicationCycleId: cycle.id } },
          },
          select: {
            domainApplication: {
              select: { domain: { select: { displayName: true } } },
            },
          },
        }),
        prisma.delibsSession.count({
          where: { applicationCycleId: cycle.id, status: "Active" },
        }),
      ]);

    const byDomain = new Map<string, number>();
    for (const row of outstandingRows) {
      const name = row.domainApplication.domain.displayName;
      byDomain.set(name, (byDomain.get(name) ?? 0) + 1);
    }
    core = {
      releaseQueue: releaseQueueCount(decisions as HubDecisionRow[]),
      waitlisted: waitlist.length,
      health: {
        submitted,
        unreviewedApps,
        reviewsOutstanding: outstandingRows.length,
        outstandingByDomain: [...byDomain.entries()]
          .map(([domainName, count]) => ({ domainName, count }))
          .sort((a, b) => b.count - a.count),
        activeDelibs,
      },
    };
  }

  return {
    needsConfidentialitySignature,
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
    pendingReviews: {
      count: pendingReviewCount,
      items: pendingReviewRows.map((r) => ({
        reviewId: r.id,
        applicationId: r.domainApplication.applicationId,
        applicantName: displayName(r.domainApplication.application.user),
        domainName: r.domainApplication.domain.displayName,
      })),
    },
    upcomingInterviews: upcomingAssignments.map((a) => ({
      id: a.interview.id,
      startTime: a.interview.startTime,
      endTime: a.interview.endTime,
      location: a.interview.location,
      applicantName: displayName(
        a.interview.domainApplication.application.user,
      ),
    })),
    delibs,
    core,
  };
}
