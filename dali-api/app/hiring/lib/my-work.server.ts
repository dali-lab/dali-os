import { prisma } from "~/lib/db";
import { getUserRoles } from "~/lib/roles";
import { getActiveCycles, type ActiveCycle } from "./cycles";
import { anonLabelMapForCycle, releasedDaIds, blindUser } from "./anonymization.server";
import { confidentialityBlock, getCycleConfidentialityState } from "./confidentiality";
import { buildColumnOrder } from "./delibs";
import { findRound, parseTimeline } from "./cycle-timeline";
import { delibsQualifier } from "./cycle-stages.server";
import { inReviewPipelineFilter } from "./application-pipeline-filter";

// Data for /hiring (My work): the viewer's own hiring work on live cycles.
// Reviews + the live delibs mirror cover every cycle they review on; interviews
// cover one cycle at a time (?cycle=<id>) since availability is per cycle.

/** Mirrors the layout's hasHiringAccess: Core/Admin/DomainLead always; other
 *  lab members only if they review or interview on any cycle. */
export async function hasHiringAccess(userId: string): Promise<boolean> {
  const roles = await getUserRoles(userId);
  if (roles.isCore || roles.isDomainLead) return true;
  if (!roles.isLabMember) return false;
  const [reviewer, interviewer] = await Promise.all([
    prisma.cycleReviewer.findFirst({ where: { userId }, select: { id: true } }),
    prisma.cycleInterviewer.findFirst({ where: { userId }, select: { id: true } }),
  ]);
  return reviewer !== null || interviewer !== null;
}

export async function getMyWorkData(userId: string, request: Request) {
  const candidates = await getActiveCycles();

  const perCycle = await Promise.all(
    candidates.map(async (cycle) => {
      const [reviewerRows, interviewerRows, confState] = await Promise.all([
        prisma.cycleReviewer.findMany({
          where: { userId, applicationCycleId: cycle.id },
          select: { id: true, domainId: true },
        }),
        prisma.cycleInterviewer.findMany({
          where: { userId, applicationCycleId: cycle.id },
          select: { id: true },
        }),
        getCycleConfidentialityState(userId, cycle.id),
      ]);
      return {
        cycle,
        reviewerRows,
        interviewerRows,
        confidentialityRequired: confidentialityBlock(confState),
      };
    }),
  );
  const reviewing = perCycle.filter((c) => c.reviewerRows.length > 0);
  const interviewing = perCycle.filter((c) => c.interviewerRows.length > 0);
  if (reviewing.length === 0 && interviewing.length === 0) {
    return { hasWork: false as const, reviews: null, interviews: null };
  }

  // Reviews and the delibs mirror span every cycle the viewer reviews on, on
  // one board; each card and board names its cycle when there's more than one.
  const reviewParts = await Promise.all(
    reviewing.map(async (c) => ({
      c,
      part: await loadReviews(c.cycle, c.reviewerRows, c.confidentialityRequired),
    })),
  );
  const reviews =
    reviewing.length > 0
      ? {
          multiCycle: reviewing.length > 1,
          myReviews: reviewParts.flatMap(({ c, part }) =>
            part.myReviews.map((r) => ({ ...r, cycleName: c.cycle.name })),
          ),
          delibsSessions: reviewParts.flatMap(({ c, part }) =>
            part.delibsSessions.map((d) => ({ ...d, cycleName: c.cycle.name })),
          ),
          delibsApplications: reviewParts.flatMap(({ part }) => part.delibsApplications),
          // Cycles whose applications stay hidden until an agreement is signed.
          blocked: reviewing
            .filter((c) => c.confidentialityRequired)
            .map((c) => ({
              cycleId: c.cycle.id,
              cycleName: c.cycle.name,
              reason: c.confidentialityRequired!,
            })),
        }
      : null;

  // Interviews show one cycle at a time, picked with ?cycle=<id>, newest by
  // default.
  const requested = new URL(request.url).searchParams.get("cycle");
  const selected =
    (requested ? interviewing.find((c) => c.cycle.id === requested) : undefined) ??
    interviewing[0];
  const interviews = selected
    ? {
        cycles: interviewing.map(({ cycle: c }) => ({ id: c.id, name: c.name })),
        cycle: { id: selected.cycle.id, name: selected.cycle.name },
        confidentialityRequired: selected.confidentialityRequired,
        ...(await loadInterviews(userId)),
      }
    : null;

  return { hasWork: true as const, reviews, interviews };
}

// Scheduling reads availability straight from the interviewer's DALI OS
// calendar; with neither a linked calendar nor working hours they can't be
// booked, so the view prompts them to set one up.
async function loadInterviews(userId: string) {
  const [calendarLink, workingHours] = await Promise.all([
    prisma.userCalendarLink.findFirst({
      where: { userId, provider: "Google", enabled: true },
      select: { id: true },
    }),
    prisma.workingHoursDay.findFirst({ where: { userId }, select: { id: true } }),
  ]);
  return { needsCalendar: !calendarLink && !workingHours };
}

async function loadReviews(
  cycle: ActiveCycle,
  reviewerRows: { id: string; domainId: string }[],
  confidentialityRequired: ReturnType<typeof confidentialityBlock>,
) {
  // Applicant names only load once the cycle's confidentiality agreement is
  // signed; the view shows a gate placeholder otherwise.
  if (confidentialityRequired) {
    return { myReviews: [] as any[], delibsSessions: [] as any[], delibsApplications: [] as any[] };
  }

  const myDomainIds = Array.from(new Set(reviewerRows.map((r) => r.domainId)));

  // Withdrawn applications stay in the DB (audit log) but drop out of the
  // active reviewer queue. Filter the parent `application` relation so the
  // ApplicationReview rows themselves remain queryable from analytics paths.
  const myReviews: any[] = await prisma.applicationReview.findMany({
    where: {
      cycleReviewerId: { in: reviewerRows.map((r) => r.id) },
      domainApplication: { application: inReviewPipelineFilter },
    },
    include: {
      domainApplication: {
        include: {
          application: {
            include: { user: { select: { firstName: true, lastName: true } } },
          },
          domain: true,
        },
      },
    },
    orderBy: { createdAt: "asc" },
  });

  // Active delibs sessions for the reviewer's domains (live mirror view).
  const delibsSessionsRaw = await prisma.delibsSession.findMany({
    where: {
      applicationCycleId: cycle.id,
      domainId: { in: myDomainIds },
      status: "Active",
    },
    include: { domain: { select: { id: true, name: true } } },
    orderBy: { createdAt: "desc" },
  });

  // Each session's board is laid out the way the domain-lead kanban does it, so
  // never-dragged apps still appear in the reviewer mirror.
  const delibsSessions: any[] = [];
  const daIdToSummary = new Map<string, any>();

  const timeline = parseTimeline(cycle.timeline);
  for (const session of delibsSessionsRaw) {
    // A board whose round was taken out of the timeline has nothing to mirror.
    const round = findRound(timeline, session.roundId);
    if (!round) continue;
    const cols = round.columns;
    const qualifyingFilter = await delibsQualifier(cycle, session.roundId, session.domainId);

    const qualifying = await prisma.domainApplication.findMany({
      where: {
        selected: true,
        domainId: session.domainId,
        application: {
          applicationCycleId: session.applicationCycleId,
          ...inReviewPipelineFilter,
        },
        ...qualifyingFilter,
      },
      include: {
        application: {
          include: { user: { select: { firstName: true, lastName: true } } },
        },
      },
    });

    for (const da of qualifying) daIdToSummary.set(da.id, da);
    const columnOrder = buildColumnOrder(
      session.columnOrder as Record<string, string[]> | null,
      qualifying.map((q) => q.id),
      cols,
      cols[0],
    );
    delibsSessions.push({
      ...session,
      columns: cols,
      columnOrder,
      roundLabel: round.label,
      isFinalRound: round.isFinal,
    });
  }

  // Blind review: on cycles with anonymizeReview on, replace applicant
  // identity with a stable "Applicant N" pseudonym on the reviewer's assigned
  // apps and the Initial-delibs mirror, until a decision is Released for that
  // applicant. Final-delibs apps (released) keep their real names.
  if (cycle.anonymizeReview) {
    const labelMap = await anonLabelMapForCycle(cycle.id);
    const released = await releasedDaIds([
      ...myReviews.map((r) => r.domainApplication.id),
      ...daIdToSummary.keys(),
    ]);
    const blind = (da: any) => {
      if (!da || released.has(da.id)) return;
      const label = labelMap.get(da.application.id);
      if (label) da.application.user = blindUser(da.application.user, label);
    };
    for (const r of myReviews) blind(r.domainApplication);
    for (const da of daIdToSummary.values()) blind(da);
  }

  return {
    myReviews,
    delibsSessions,
    delibsApplications: Array.from(daIdToSummary.values()),
  };
}
